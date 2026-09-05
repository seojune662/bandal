import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
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
import { AgentUnavailableError, type BinaryLocator } from '../binaryLocator'
import { attachJsonlStream, createStderrRing } from '../jsonlStream'
import { augmentedPathEnv, killProcessTree, spawnClaude } from '../platform'
import { createGeminiBinaryLocator } from './binaryLocator'
import type { GeminiMcpServerSettings } from './settingsFile'
import {
  GEMINI_MCP_TOKEN_ENV_VAR,
  GEMINI_SYSTEM_SETTINGS_ENV_VAR,
  writeGeminiSettings
} from './settingsFile'
import { createGeminiStreamMapper } from './streamMapper'

const FORCE_KILL_DELAY_MS = 3000
const liveProcessGroups = new Set<number>()

const GEMINI_CAPABILITIES: AgentCapabilities = {
  interactivePermissions: false,
  streamingInput: false,
  partialText: true,
  cancel: true
}

interface GeminiStartOptions extends AgentStartSessionOptions {
  geminiMcpServers?: Record<string, GeminiMcpServerSettings>
}

export interface GeminiAdapterDeps {
  userDataPath: string
  locator?: BinaryLocator
  spawnImpl?: typeof spawnClaude
}

interface GeminiArgsOptions {
  prompt: string
  sessionId: string
  resume: boolean
  model?: string
}

export function buildGeminiArgs(options: GeminiArgsOptions): string[] {
  const args = ['-p', options.prompt, '-o', 'stream-json']
  args.push(options.resume ? '--resume' : '--session-id', options.sessionId)
  if (
    options.model !== undefined &&
    options.model !== ''
  ) {
    args.push('-m', options.model)
  }
  return args
}

export function killAllGeminiProcessesSync(): void {
  for (const pid of liveProcessGroups) {
    killProcessTree(pid, 'SIGKILL')
  }
  liveProcessGroups.clear()
}

function childEnv(
  binaryPath: string,
  loginPath: string | null,
  settingsPath: string,
  options: GeminiStartOptions
): NodeJS.ProcessEnv {
  const env = {
    ...augmentedPathEnv(binaryPath, loginPath),
    ...(options.mcpExtraEnv ?? {})
  }
  env[GEMINI_SYSTEM_SETTINGS_ENV_VAR] = settingsPath
  if (options.mcpHttp !== undefined) {
    env[GEMINI_MCP_TOKEN_ENV_VAR] = options.mcpHttp.token
  }
  return env
}

function attachmentNotice(
  content: string,
  attachments: readonly ChatAttachment[]
): string {
  if (attachments.length === 0) return content
  // ponytail: Gemini 이미지 첨부는 v1에서 텍스트 안내만, 추후 @path 물질화로 확장.
  return `${content}\n\n[첨부 이미지 ${attachments.length}개는 이 제공자에서 지원되지 않음]`
}

export function createGeminiAdapter(deps: GeminiAdapterDeps): AgentAdapter {
  const locator = deps.locator ?? createGeminiBinaryLocator()
  const spawnImpl = deps.spawnImpl ?? spawnClaude

  async function startSession(
    baseOptions: AgentStartSessionOptions
  ): Promise<AgentSession> {
    const binary = await locator.locate()
    const loginPath = await locator.loginShellPath()
    return createSession(binary.path, loginPath, baseOptions as GeminiStartOptions)
  }

  function createSession(
    binaryPath: string,
    loginPath: string | null,
    options: GeminiStartOptions
  ): AgentSession {
    const mapper = createGeminiStreamMapper()
    const subscribers = new Set<(event: AgentEvent) => void>()
    const iteratorQueues = new Set<{
      buffer: AgentEvent[]
      wake: (() => void) | null
    }>()
    let disposed = false
    let terminal = false
    let child: ChildProcess | null = null
    let cancelled = false
    let cliSessionId = options.resumeCliSessionId ?? randomUUID()
    let canResume = options.resumeCliSessionId !== undefined
    let sentSystemPrompt = canResume
    let resolveSessionId!: (id: string) => void
    let rejectSessionId!: (error: Error) => void
    const sessionId = new Promise<string>((resolve, reject) => {
      resolveSessionId = resolve
      rejectSessionId = reject
    })
    sessionId.catch(() => undefined)

    function emit(event: AgentEvent): void {
      if (event.type === 'session-started') {
        // The CLI normally echoes Bandal's UUID. If it substitutes one, that
        // actual id becomes the resume key from this point forward.
        cliSessionId = event.sessionId
        canResume = true
        resolveSessionId(event.sessionId)
      }
      for (const subscriber of subscribers) subscriber(event)
      for (const queue of iteratorQueues) {
        queue.buffer.push(event)
        queue.wake?.()
      }
    }

    function endIterators(): void {
      for (const queue of iteratorQueues) queue.wake?.()
    }

    function fail(error: AgentUnavailableError): void {
      if (terminal || disposed) return
      terminal = true
      rejectSessionId(error)
      emit({ type: 'error', code: error.code, message: error.message, fatal: true })
      endIterators()
    }

    function stop(target: ChildProcess, force = false): void {
      if (target.pid === undefined) return
      killProcessTree(target.pid, force ? 'SIGKILL' : 'SIGTERM')
      if (force) return
      const timer = setTimeout(() => {
        if (child === target) killProcessTree(target.pid as number, 'SIGKILL')
      }, FORCE_KILL_DELAY_MS)
      timer.unref()
    }

    function promptFor(content: string): string {
      if (
        sentSystemPrompt ||
        options.systemPromptAppend === undefined ||
        options.systemPromptAppend === ''
      ) {
        return content
      }
      sentSystemPrompt = true
      return `${options.systemPromptAppend}\n\n학생의 요청:\n${content}`
    }

    function handleMapped(target: ChildProcess, event: AgentEvent): void {
      emit(event)
      if (event.type !== 'error' || !event.fatal) return
      terminal = true
      rejectSessionId(new AgentUnavailableError(event.code, event.message))
      endIterators()
      stop(target, true)
    }

    function sendMessage(
      content: string,
      attachments: readonly ChatAttachment[] = []
    ): void {
      if (disposed || terminal) return
      if (child !== null) {
        emit({
          type: 'error',
          code: 'unknown',
          message: 'Gemini가 이전 답변을 마칠 때까지 기다려 주세요.',
          fatal: false
        })
        return
      }

      let settingsPath: string
      try {
        settingsPath = writeGeminiSettings({
          userDataPath: deps.userDataPath,
          ...(options.mcpHttp === undefined ? {} : { mcpHttp: options.mcpHttp }),
          ...(options.geminiMcpServers === undefined
            ? {}
            : { externalServers: options.geminiMcpServers })
        })
      } catch (error) {
        fail(new AgentUnavailableError(
          'spawn-failed',
          `Gemini 설정을 준비하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
        ))
        return
      }

      const args = buildGeminiArgs({
        prompt: attachmentNotice(promptFor(content), attachments),
        sessionId: cliSessionId,
        resume: canResume,
        ...(options.model === undefined ? {} : { model: options.model })
      })
      const stderr = createStderrRing()
      mapper.beginTurn()
      cancelled = false

      let spawned: ChildProcess
      try {
        spawned = spawnImpl(binaryPath, args, {
          cwd: options.cwd,
          env: childEnv(binaryPath, loginPath, settingsPath, options),
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        fail(new AgentUnavailableError(
          'spawn-failed',
          `Gemini를 시작하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
        ))
        return
      }
      child = spawned
      const pid = spawned.pid
      if (pid !== undefined) liveProcessGroups.add(pid)
      let settled = false
      const jsonl = spawned.stdout === null
        ? null
        : attachJsonlStream(spawned.stdout, {
            onJson(value) {
              for (const event of mapper.map(value)) handleMapped(spawned, event)
            },
            onMalformedLimit(detail) {
              fail(new AgentUnavailableError(
                'malformed-output',
                `Gemini가 읽을 수 없는 출력을 보냈습니다: ${detail}`
              ))
              stop(spawned, true)
            }
          })
      spawned.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

      spawned.on('error', (error) => {
        if (settled) return
        settled = true
        if (pid !== undefined) liveProcessGroups.delete(pid)
        child = null
        jsonl?.dispose()
        fail(new AgentUnavailableError(
          'spawn-failed',
          `Gemini를 시작하지 못했습니다: ${error.message}`
        ))
      })
      spawned.on('close', (code) => {
        if (settled) return
        settled = true
        if (pid !== undefined) liveProcessGroups.delete(pid)
        child = null
        jsonl?.dispose()
        if (disposed) {
          endIterators()
          return
        }
        if (code === 0 && mapper.cliSessionId === null) {
          fail(new AgentUnavailableError(
            'process-crashed',
            'Gemini가 세션 ID를 보내지 않고 종료했습니다.'
          ))
          return
        }
        const events = mapper.finishProcess(cancelled, code, stderr.tail())
        for (const event of events) handleMapped(spawned, event)
      })
    }

    const events: AsyncIterable<AgentEvent> = {
      [Symbol.asyncIterator]() {
        const queue = { buffer: [] as AgentEvent[], wake: null as (() => void) | null }
        iteratorQueues.add(queue)
        return {
          async next(): Promise<IteratorResult<AgentEvent>> {
            for (;;) {
              const event = queue.buffer.shift()
              if (event !== undefined) return { value: event, done: false }
              if (disposed || terminal) {
                iteratorQueues.delete(queue)
                return { value: undefined, done: true }
              }
              await new Promise<void>((resolve) => { queue.wake = resolve })
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

    return {
      sessionId,
      events,
      on(callback): Unsubscribe {
        subscribers.add(callback)
        return () => subscribers.delete(callback)
      },
      sendMessage,
      respondPermission(_requestId: string, _response: PermissionResponse) {},
      cancel() {
        if (child === null) return
        cancelled = true
        stop(child)
      },
      dispose() {
        if (disposed) return
        disposed = true
        if (child !== null) stop(child)
        endIterators()
      }
    }
  }

  return {
    provider: 'gemini',
    capabilities: GEMINI_CAPABILITIES,
    checkAvailability: () => locator.availability(),
    startSession
  }
}
