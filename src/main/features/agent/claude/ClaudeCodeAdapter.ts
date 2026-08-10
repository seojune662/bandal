/**
 * Claude Code adapter: one long-lived headless CLI process per session,
 * speaking stream-json on stdio (see ../SPIKE-NOTES.md for the verified wire).
 *
 * Interactive permissions run over the stdio control protocol
 * (`--permission-prompt-tool stdio` → can_use_tool control_requests), cancel
 * uses the interrupt control_request, and teardown kills the whole process
 * tree (the CLI spawns helpers). Spawning and killing go through
 * ../platform.ts, which is where the POSIX/Windows differences live.
 */

import { type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { killProcessTree, spawnClaude } from '../platform'
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentSession,
  AgentStartSessionOptions,
  PermissionResponse,
  Unsubscribe
} from '../../../../shared/types/agent-events'
import { attachJsonlStream, createStderrRing } from '../jsonlStream'
import { AgentUnavailableError, type BinaryLocator } from '../binaryLocator'
import { createStreamMapper } from './streamMapper'

const SIGKILL_DELAY_MS = 3000

/**
 * Permission rules handed to `--allowedTools` — these are *rules*, not bare
 * tool names.
 *
 * `Edit`/`Write` are **scoped to the CLI's working directory** (the course
 * folder) with the cwd-relative glob `./**`. In-course edits proceed silently;
 * anything outside falls through to a `can_use_tool` control_request, i.e. the
 * permission card the renderer already implements.
 *
 * This matters because `Read`, `WebFetch` and `WebSearch` are blanket-allowed
 * and the tutor reads third-party lecture PDFs, so a blanket `Edit`/`Write`
 * rule completed a prompt-injection → arbitrary-write chain. Verified against
 * claude 2.1.222 — see ../SPIKE-NOTES.md §Spike 5, including that an absolute
 * path in a rule does NOT work (a single leading `/` is read as
 * project-relative) and that this glob covers nested subdirectories.
 */
export const CLAUDE_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Edit(./**)',
  'Write(./**)',
  'WebSearch',
  'WebFetch',
  'TodoWrite'
] as const

export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  interactivePermissions: true, // verified: can_use_tool works in -p mode
  streamingInput: false, // one turn at a time; queueing handled upstream
  partialText: true,
  cancel: true
}

/** Root pids of live sessions, for the synchronous exit-time sweep. */
const liveProcessGroups = new Set<number>()

/**
 * Kill every live CLI process tree. Safe to call from `process.on('exit')`.
 *
 * Also called before an auto-update restart: on Windows a surviving CLI child
 * holds file handles that make the NSIS updater fail to replace the install.
 */
export function killAllClaudeProcessesSync(): void {
  for (const pid of liveProcessGroups) {
    killProcessTree(pid, 'SIGKILL')
  }
  liveProcessGroups.clear()
}

/**
 * `~/.claude/projects/<slug>/` — CLI's transcript dir naming rule. The CLI
 * slugifies the REAL path of its cwd (macOS /var/folders → /private/var/...),
 * so resolve symlinks first.
 */
export function transcriptDirFor(cwd: string): string {
  let realCwd = cwd
  try {
    realCwd = realpathSync(cwd)
  } catch {
    // keep the given path if it cannot be resolved
  }
  const slug = realCwd.replace(/[^a-zA-Z0-9-]/g, '-')
  return join(homedir(), '.claude', 'projects', slug)
}

export function buildClaudeArgs(opts: {
  resumeCliSessionId?: string
  model?: string
  systemPromptAppend?: string
  /** Bandal's own in-app MCP server; see features/agentTools. */
  mcpConfigPath?: string
  /** Extra allow rules, e.g. `mcp__bandal__create_course`. */
  extraAllowedTools?: readonly string[]
}): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    // `default`, not `acceptEdits`: the allowlist above is what grants routine
    // in-course edits, so if a rule ever stops matching we fail *closed* (the
    // student sees a permission card) instead of silently auto-approving.
    '--permission-mode',
    'default',
    '--permission-prompt-tool',
    'stdio',
    // One comma-joined value rather than 8 argv items: if a future CLI stops
    // accepting the splatted form, the extras would silently become positional
    // arguments in `-p` mode and the allowlist would collapse.
    '--allowedTools',
    [...CLAUDE_ALLOWED_TOOLS, ...(opts.extraAllowedTools ?? [])].join(','),
    '--disallowedTools',
    'Bash',
    '--disable-slash-commands',
    '--setting-sources',
    'user'
  ]
  if (opts.mcpConfigPath !== undefined && opts.mcpConfigPath !== '') {
    // `--strict-mcp-config` is not optional here. Without it the CLI also
    // loads whatever MCP servers the student configured in ~/.claude, which
    // has been handing the tutor dozens of unrelated tools (backlog P1).
    args.push('--mcp-config', opts.mcpConfigPath, '--strict-mcp-config')
  }
  if (opts.systemPromptAppend !== undefined && opts.systemPromptAppend !== '') {
    args.push('--append-system-prompt', opts.systemPromptAppend)
  }
  if (opts.model !== undefined && opts.model !== '') {
    args.push('--model', opts.model)
  }
  if (opts.resumeCliSessionId !== undefined && opts.resumeCliSessionId !== '') {
    args.push('--resume', opts.resumeCliSessionId)
  }
  return args
}

function buildChildEnv(loginPath: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Bandal itself may run inside a Claude Code session — never leak that.
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE_ENTRYPOINT']
  delete env['CLAUDE_CODE_SSE_PORT']
  if (loginPath !== null) {
    env['PATH'] = loginPath
  }
  return env
}

/** AgentSession plus adapter-internal extras used by the SessionManager. */
export interface ClaudeCodeSession extends AgentSession {
  /** Computed transcript JSONL path (best effort), once the session id is known. */
  readonly transcriptPath: string | null
  /** Launch configuration persisted for resume. */
  readonly launchConfig: { args: string[]; cwd: string; binaryPath: string }
}

export interface ClaudeCodeAdapterDeps {
  locator: BinaryLocator
  /** Injectable for tests. Defaults to the platform-aware spawn. */
  spawnImpl?: typeof spawnClaude
}

export function createClaudeCodeAdapter(
  deps: ClaudeCodeAdapterDeps
): AgentAdapter & { startSession(opts: AgentStartSessionOptions): Promise<ClaudeCodeSession> } {
  const spawnImpl = deps.spawnImpl ?? spawnClaude

  async function startSession(
    opts: AgentStartSessionOptions
  ): Promise<ClaudeCodeSession> {
    const binary = await deps.locator.locate()
    const loginPath = await deps.locator.loginShellPath()
    const args = buildClaudeArgs(opts)

    let child: ChildProcess
    try {
      child = spawnImpl(binary.path, args, {
        cwd: opts.cwd,
        env: buildChildEnv(loginPath)
      })
    } catch (error) {
      throw new AgentUnavailableError(
        'spawn-failed',
        `Failed to spawn Claude Code: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    return wireSession(child, binary.path, args, opts.cwd)
  }

  function wireSession(
    child: ChildProcess,
    binaryPath: string,
    args: string[],
    cwd: string
  ): ClaudeCodeSession {
    const mapper = createStreamMapper()
    const stderrRing = createStderrRing()
    const subscribers = new Set<(event: AgentEvent) => void>()
    const pendingPermissionInputs = new Map<string, unknown>()
    const iteratorQueues = new Set<{
      buffer: AgentEvent[]
      wake: (() => void) | null
    }>()

    let disposed = false
    let exited = false
    let transcriptPath: string | null = null
    let resolveSessionId!: (id: string) => void
    let rejectSessionId!: (error: Error) => void
    const sessionIdPromise = new Promise<string>((resolve, reject) => {
      resolveSessionId = resolve
      rejectSessionId = reject
    })
    // A crashed spawn rejects sessionId; avoid unhandled rejection noise when
    // callers only consume the event stream.
    sessionIdPromise.catch(() => undefined)

    const pgid = child.pid
    if (pgid !== undefined) {
      liveProcessGroups.add(pgid)
    }

    function emit(event: AgentEvent): void {
      if (event.type === 'session-started') {
        // Computed from the CLI's naming rule; the file may flush lazily.
        transcriptPath = join(transcriptDirFor(cwd), `${event.sessionId}.jsonl`)
        resolveSessionId(event.sessionId)
      }
      if (event.type === 'permission-request') {
        pendingPermissionInputs.set(event.requestId, event.input)
      }
      for (const subscriber of subscribers) {
        subscriber(event)
      }
      for (const queue of iteratorQueues) {
        queue.buffer.push(event)
        queue.wake?.()
      }
    }

    function endIterators(): void {
      for (const queue of iteratorQueues) {
        queue.wake?.()
      }
    }

    function writeLine(value: unknown): void {
      if (disposed || exited || child.stdin === null) {
        return
      }
      child.stdin.write(`${JSON.stringify(value)}\n`)
    }

    const jsonl =
      child.stdout === null
        ? null
        : attachJsonlStream(child.stdout, {
            onJson: (value) => {
              for (const event of mapper.map(value)) {
                emit(event)
              }
            },
            onMalformedLimit: (detail) => {
              emit({
                type: 'error',
                code: 'malformed-output',
                message: `Claude Code produced unreadable output: ${detail}`,
                fatal: true
              })
              disposeInternal()
            }
          })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrRing.push(chunk)
    })

    child.on('error', (error) => {
      exited = true
      rejectSessionId(
        new AgentUnavailableError('spawn-failed', error.message)
      )
      emit({
        type: 'error',
        code: 'spawn-failed',
        message: `Claude Code failed to start: ${error.message}`,
        fatal: true
      })
      endIterators()
    })

    child.on('exit', (code, signal) => {
      exited = true
      if (pgid !== undefined) {
        liveProcessGroups.delete(pgid)
      }
      rejectSessionId(
        new AgentUnavailableError(
          'process-crashed',
          `Claude Code exited before reporting a session id (code ${code ?? 'null'})`
        )
      )
      if (!disposed) {
        const tail = stderrRing.tail()
        emit({
          type: 'error',
          code: 'process-crashed',
          message:
            `Claude Code exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'})` +
            (tail === '' ? '' : `\n${tail.split('\n').slice(-10).join('\n')}`),
          fatal: true
        })
      }
      endIterators()
    })

    function disposeInternal(): void {
      if (disposed) {
        return
      }
      disposed = true
      jsonl?.dispose()
      try {
        child.stdin?.end()
      } catch {
        // stream already destroyed
      }
      if (pgid !== undefined && !exited) {
        // On Windows this is already a forced tree kill (`taskkill /T /F`), so
        // the escalation timer below is a POSIX-only no-op there.
        killProcessTree(pgid, 'SIGTERM')
        const killTimer = setTimeout(() => {
          killProcessTree(pgid, 'SIGKILL')
        }, SIGKILL_DELAY_MS)
        killTimer.unref()
      }
      endIterators()
    }

    const events: AsyncIterable<AgentEvent> = {
      [Symbol.asyncIterator]: () => {
        const queue = { buffer: [] as AgentEvent[], wake: null as (() => void) | null }
        iteratorQueues.add(queue)
        return {
          next: async (): Promise<IteratorResult<AgentEvent>> => {
            for (;;) {
              const event = queue.buffer.shift()
              if (event !== undefined) {
                return { value: event, done: false }
              }
              if (disposed || exited) {
                iteratorQueues.delete(queue)
                return { value: undefined, done: true }
              }
              await new Promise<void>((resolve) => {
                queue.wake = resolve
              })
              queue.wake = null
            }
          },
          return: async (): Promise<IteratorResult<AgentEvent>> => {
            iteratorQueues.delete(queue)
            return { value: undefined, done: true }
          }
        }
      }
    }

    return {
      sessionId: sessionIdPromise,
      events,
      get transcriptPath() {
        return transcriptPath
      },
      launchConfig: { args, cwd, binaryPath },
      on: (cb): Unsubscribe => {
        subscribers.add(cb)
        return () => subscribers.delete(cb)
      },
      sendMessage: (content, attachments = []) => {
        const messageContent: Array<Record<string, unknown>> = attachments.map(
          (attachment) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mediaType,
              data: attachment.dataBase64
            }
          })
        )
        messageContent.push({ type: 'text', text: content })
        writeLine({
          type: 'user',
          message: { role: 'user', content: messageContent }
        })
      },
      respondPermission: (requestId: string, res: PermissionResponse) => {
        const input = pendingPermissionInputs.get(requestId)
        pendingPermissionInputs.delete(requestId)
        const response =
          res.behavior === 'allow'
            ? { behavior: 'allow', updatedInput: input ?? {} }
            : { behavior: 'deny', message: 'User denied this action' }
        writeLine({
          type: 'control_response',
          response: { subtype: 'success', request_id: requestId, response }
        })
      },
      cancel: () => {
        mapper.markInterrupted()
        writeLine({
          type: 'control_request',
          request_id: `interrupt-${randomUUID()}`,
          request: { subtype: 'interrupt' }
        })
      },
      dispose: disposeInternal
    }
  }

  return {
    provider: 'claude-code',
    capabilities: CLAUDE_CAPABILITIES,
    checkAvailability: () => deps.locator.availability(),
    startSession
  }
}
