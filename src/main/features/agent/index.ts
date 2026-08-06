// agent feature (main process) — Claude Code + Codex CLI runtimes.
export {
  createBinaryLocator,
  AgentUnavailableError,
  type BinaryLocator
} from './binaryLocator'
export {
  createClaudeCodeAdapter,
  killAllClaudeProcessesSync,
  type ClaudeCodeSession
} from './claude/ClaudeCodeAdapter'
export { createStreamMapper } from './claude/streamMapper'
export {
  createCodexAdapter,
  buildCodexArgs,
  killAllCodexProcessesSync,
  CODEX_CAPABILITIES,
  type CodexAdapterDeps
} from './codex/CodexAdapter'
export {
  createCodexBinaryLocator,
  type CodexBinaryLocatorDeps
} from './codex/binaryLocator'
export {
  createCodexStreamMapper,
  type CodexStreamMapper
} from './codex/streamMapper'
export {
  createAgentInstaller,
  CLAUDE_INSTALL_COMMAND,
  CODEX_INSTALL_COMMAND,
  AGENT_INSTALL_TIMEOUT_MS
} from './installer'
export { probeModels, FALLBACK_MODELS, type CliModel } from './claude/modelProbe'
export { getAgentModels } from './agentModels'
export { createEventBatcher, type EventBatcher } from './eventBatcher'
export { createChatRepo, type ChatRepo } from './chatRepo'
export {
  createSessionManager,
  buildStudyPrompt,
  type SessionManager
} from './SessionManager'
