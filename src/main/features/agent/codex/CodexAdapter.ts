/**
 * Codex CLI adapter.
 *
 * Unlike Claude Code's long-lived stdin process, a Codex session is a logical
 * thread backed by one short-lived `codex exec` process per turn. The first
 * turn starts a thread; later turns spawn `codex exec ... resume <thread_id>`.
 *
 * Every child uses `stdio: ['ignore', 'pipe', 'pipe']`. This is deliberate:
 * in a non-TTY process Codex otherwise announces "Reading additional input
 * from stdin..." and can wait forever for EOF even when the prompt is argv.
 */

import { type ChildProcess } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentSession,
  AgentStartSessionOptions,
  PermissionResponse,
  Unsubscribe
} from '../../../../shared/types/agent-events'
import type { ChatAttachment } from '../../../../shared/types/chat'
import { attachJsonlStream, createStderrRing } from '../jsonlStream'
import { AgentUnavailableError, type BinaryLocator } from '../binaryLocator'
import { killProcessTree, spawnClaude } from '../platform'
import { createCodexBinaryLocator } from './binaryLocator'
import { createCodexStreamMapper } from './streamMapper'

const FORCE_KILL_DELAY_MS = 3000

export const CODEX_CAPABILITIES: AgentCapabilities = {
  interactivePermissions: false,
  streamingInput: false,
  partialText: true,
  cancel: true
}

/** Root pids of active per-turn processes, for app shutdown. */
const liveProcessGroups = new Set<number>()

export function killAllCodexProcessesSync(): void {
  for (const pid of liveProcessGroups) {
    killProcessTree(pid, 'SIGKILL')
  }
  liveProcessGroups.clear()
}

export interface CodexAdapterDeps {
  locator?: BinaryLocator
  /** Platform-aware spawn seam. Tests assert stdin is `ignore`. */
  spawnImpl?: typeof spawnClaude
}

/** Env var carrying the in-app MCP bearer token — env, never argv. */
export const CODEX_MCP_TOKEN_ENV_VAR = 'BANDAL_MCP_TOKEN'

export interface BuildCodexArgsOptions {
  cwd: string
  prompt: string
  model?: string
  resumeCliSessionId?: string
  imagePaths?: readonly string[]
  /** Bandal's in-app MCP server endpoint (token travels via env). */
  mcpUrl?: string
}

export function buildCodexArgs(opts: BuildCodexArgsOptions): string[] {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-C',
    opts.cwd,
    // Fixed safety boundary: generated commands may write only within the
    // course workspace (plus Codex's own temporary allowances). Never widen
    // this to danger-full-access; Bandal does not request live permissions.
    '-s',
    'workspace-write'
  ]
  if (opts.mcpUrl !== undefined && opts.mcpUrl !== '') {
    // Codex takes MCP config as TOML overrides, not a JSON --mcp-config file.
    // The bearer token is referenced by env var name so it never hits argv
    // (argv is visible to every process on the machine via ps).
    args.push(
      '-c',
      `mcp_servers.bandal.url=${JSON.stringify(opts.mcpUrl)}`,
      '-c',
      `mcp_servers.bandal.bearer_token_env_var=${JSON.stringify(CODEX_MCP_TOKEN_ENV_VAR)}`
    )
  }
  if (opts.model !== undefined && opts.model !== '' && opts.model !== 'default') {
    args.push('-m', opts.model)
  }
  for (const imagePath of opts.imagePaths ?? []) {
    args.push('-i', imagePath)
  }
  if (
    opts.resumeCliSessionId !== undefined &&
    opts.resumeCliSessionId !== ''
  ) {
    // Top-level safety/cwd flags stay before the resume subcommand so the same
    // workspace-write boundary applies to every process in the logical thread.
    args.push('resume', opts.resumeCliSessionId)
  }
  args.push(opts.prompt)
  return args
}

function buildChildEnv(
  loginPath: string | null,
  mcpToken?: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Bandal may itself have been launched from a Codex terminal. A nested turn
  // must receive the child thread id, not inherit its parent's identity.
  delete env['CODEX_THREAD_ID']
  delete env['CODEX_CI']
  if (loginPath !== null) {
    env['PATH'] = loginPath
  }
  if (mcpToken !== undefined) {
    env[CODEX_MCP_TOKEN_ENV_VAR] = mcpToken
  }
  return env
}

function extensionFor(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'png'
  }
}

function materializeAttachments(attachments: readonly ChatAttachment[]): {
  dir: string | null
  paths: string[]
} {
  if (attachments.length === 0) {
    return { dir: null, paths: [] }
  }
  const dir = mkdtempSync(join(tmpdir(), 'bandal-codex-images-'))
  const paths = attachments.map((attachment, index) => {
    const path = join(dir, `attachment-${index}.${extensionFor(attachment.mediaType)}`)
    writeFileSync(path, Buffer.from(attachment.dataBase64, 'base64'), {
      mode: 0o600
    })
    return path
  })
  return { dir, paths }
}

function removeAttachmentDir(dir: string | null): void {
  if (dir === null) {
    return
  }
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Best effort: these are private temp copies, never course originals.
  }
}

export function createCodexAdapter(
  deps: CodexAdapterDeps = {}
): AgentAdapter {
  const locator = deps.locator ?? createCodexBinaryLocator()
  const spawnImpl = deps.spawnImpl ?? spawnClaude

  async function startSession(
    opts: AgentStartSessionOptions
  ): Promise<AgentSession> {
    const binary = await locator.locate()
    const loginPath = await locator.loginShellPath()
    return createSession(binary.path, loginPath, opts)
  }

  function createSession(
    binaryPath: string,
    loginPath: string | null,
    opts: AgentStartSessionOptions
  ): AgentSession {
    const mapper = createCodexStreamMapper()
    const subscribers = new Set<(event: AgentEvent) => void>()
    const iteratorQueues = new Set<{
      buffer: AgentEvent[]
      wake: (() => void) | null
    }>()

    let disposed = false
    let terminal = false
    let currentChild: ChildProcess | null = null
    let currentAttachmentDir: string | null = null
    let currentCancelled = false
    let threadId = opts.resumeCliSessionId ?? null
    let sentSystemPrompt = threadId !== null
    let resolveSessionId!: (id: string) => void
    let rejectSessionId!: (error: Error) => void
    const sessionId = new Promise<string>((resolve, reject) => {
      resolveSessionId = resolve
      rejectSessionId = reject
    })
    sessionId.catch(() => undefined)

    function emit(event: AgentEvent): void {
      let mapped = event
      if (event.type === 'session-started') {
        threadId = event.sessionId
        resolveSessionId(event.sessionId)
        if (event.model === 'codex' && opts.model !== undefined && opts.model !== '') {
          mapped = { ...event, model: opts.model }
        }
      }
      for (const subscriber of subscribers) {
        subscriber(mapped)
      }
      for (const queue of iteratorQueues) {
        queue.buffer.push(mapped)
        queue.wake?.()
      }
    }

    function endIterators(): void {
      for (const queue of iteratorQueues) {
        queue.wake?.()
      }
    }

    function fatal(code: 'spawn-failed' | 'process-crashed' | 'malformed-output', message: string): void {
      if (terminal || disposed) {
        return
      }
      terminal = true
      rejectSessionId(new AgentUnavailableError(code, message))
      emit({ type: 'error', code, message, fatal: true })
      endIterators()
    }

    function stopChild(child: ChildProcess, force = false): void {
      if (child.pid === undefined) {
        return
      }
      killProcessTree(child.pid, force ? 'SIGKILL' : 'SIGTERM')
      if (!force) {
        const timer = setTimeout(() => {
          if (currentChild === child) {
            killProcessTree(child.pid as number, 'SIGKILL')
          }
        }, FORCE_KILL_DELAY_MS)
        timer.unref()
      }
    }

    function promptFor(content: string): string {
      if (
        sentSystemPrompt ||
        opts.systemPromptAppend === undefined ||
        opts.systemPromptAppend === ''
      ) {
        return content
      }
      sentSystemPrompt = true
      return `${opts.systemPromptAppend}\n\n학생의 요청:\n${content}`
    }

    function sendMessage(
      content: string,
      attachments: readonly ChatAttachment[] = []
    ): void {
      if (disposed || terminal) {
        return
      }
      if (currentChild !== null) {
        emit({
          type: 'error',
          code: 'unknown',
          message: 'Codex가 이전 답변을 마칠 때까지 기다려 주세요.',
          fatal: false
        })
        return
      }

      let materialized: { dir: string | null; paths: string[] }
      try {
        materialized = materializeAttachments(attachments)
      } catch (error) {
        emit({
          type: 'error',
          code: 'unknown',
          message: `이미지 첨부를 준비하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
          fatal: false
        })
        materialized = { dir: null, paths: [] }
      }

      const args = buildCodexArgs({
        cwd: opts.cwd,
        prompt: promptFor(content),
        ...(opts.model === undefined ? {} : { model: opts.model }),
        ...(threadId === null ? {} : { resumeCliSessionId: threadId }),
        ...(opts.mcpHttp === undefined ? {} : { mcpUrl: opts.mcpHttp.url }),
        imagePaths: materialized.paths
      })
      const stderrRing = createStderrRing()
      currentCancelled = false
      currentAttachmentDir = materialized.dir

      let child: ChildProcess
      try {
        child = spawnImpl(binaryPath, args, {
          cwd: opts.cwd,
          env: buildChildEnv(loginPath, opts.mcpHttp?.token),
          // Critical EOF contract — see the file header.
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        removeAttachmentDir(currentAttachmentDir)
        currentAttachmentDir = null
        fatal(
          'spawn-failed',
          `Codex를 시작하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
        )
        return
      }
      currentChild = child
      const pgid = child.pid
      if (pgid !== undefined) {
        liveProcessGroups.add(pgid)
      }

      let childSettled = false
      const jsonl =
        child.stdout === null
          ? null
          : attachJsonlStream(child.stdout, {
              onJson(value) {
                for (const event of mapper.map(value)) {
                  emit(event)
                  if (event.type === 'error' && event.fatal) {
                    terminal = true
                    rejectSessionId(
                      new AgentUnavailableError(event.code, event.message)
                    )
                    endIterators()
                    stopChild(child, true)
                  }
                }
              },
              onMalformedLimit(detail) {
                fatal(
                  'malformed-output',
                  `Codex가 읽을 수 없는 출력을 보냈습니다: ${detail}`
                )
                stopChild(child, true)
              }
            })

      child.stderr?.on('data', (chunk: Buffer) => stderrRing.push(chunk))

      child.on('error', (error) => {
        if (childSettled) {
          return
        }
        childSettled = true
        if (pgid !== undefined) {
          liveProcessGroups.delete(pgid)
        }
        currentChild = null
        jsonl?.dispose()
        removeAttachmentDir(currentAttachmentDir)
        currentAttachmentDir = null
        fatal('spawn-failed', `Codex를 시작하지 못했습니다: ${error.message}`)
      })

      // `close`, not `exit`: stdout/stderr are fully drained first, so the
      // terminal JSONL line cannot be discarded on a fast process shutdown.
      child.on('close', (code, signal) => {
        if (childSettled) {
          return
        }
        childSettled = true
        jsonl?.dispose()
        if (pgid !== undefined) {
          liveProcessGroups.delete(pgid)
        }
        currentChild = null
        removeAttachmentDir(currentAttachmentDir)
        currentAttachmentDir = null

        if (disposed) {
          endIterators()
          return
        }
        if (currentCancelled) {
          for (const event of mapper.finishProcess(true)) {
            emit(event)
          }
          return
        }
        if (code === 0) {
          if (mapper.cliSessionId === null) {
            fatal(
              'process-crashed',
              'Codex가 세션 ID를 보내지 않고 종료했습니다.'
            )
            return
          }
          for (const event of mapper.finishProcess(false)) {
            emit(event)
          }
          return
        }
        const tail = stderrRing.tail()
        fatal(
          'process-crashed',
          `Codex가 비정상 종료했습니다 (코드 ${code ?? '없음'}, 신호 ${signal ?? '없음'}).` +
            (tail === '' ? '' : `\n${tail.split('\n').slice(-10).join('\n')}`)
        )
      })
    }

    const events: AsyncIterable<AgentEvent> = {
      [Symbol.asyncIterator]() {
        const queue = {
          buffer: [] as AgentEvent[],
          wake: null as (() => void) | null
        }
        iteratorQueues.add(queue)
        return {
          async next(): Promise<IteratorResult<AgentEvent>> {
            for (;;) {
              const event = queue.buffer.shift()
              if (event !== undefined) {
                return { value: event, done: false }
              }
              if (disposed || terminal) {
                iteratorQueues.delete(queue)
                return { value: undefined, done: true }
              }
              await new Promise<void>((resolve) => {
                queue.wake = resolve
              })
              queue.wake = null
            }
          },
          async return(): Promise<IteratorResult<AgentEvent>> {
            iteratorQueues.delete(queue)
            return { value: undefined, done: true }
          }
        }
      }
    }

    function dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      if (currentChild !== null) {
        stopChild(currentChild)
      } else {
        removeAttachmentDir(currentAttachmentDir)
        currentAttachmentDir = null
      }
      endIterators()
    }

    return {
      sessionId,
      events,
      on(cb): Unsubscribe {
        subscribers.add(cb)
        return () => subscribers.delete(cb)
      },
      sendMessage,
      // Codex permissions are pre-decided by the fixed workspace-write
      // sandbox, so no permission request can be answered interactively.
      respondPermission(_requestId: string, _response: PermissionResponse) {},
      cancel() {
        if (currentChild === null) {
          return
        }
        currentCancelled = true
        stopChild(currentChild)
      },
      dispose
    }
  }

  return {
    provider: 'codex',
    capabilities: CODEX_CAPABILITIES,
    checkAvailability: () => locator.availability(),
    startSession
  }
}
