// agent feature (main process) — Claude Code CLI runtime [M4-H].
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
export { probeModels, FALLBACK_MODELS, type CliModel } from './claude/modelProbe'
export { getAgentModels } from './agentModels'
export { createEventBatcher, type EventBatcher } from './eventBatcher'
export { createChatRepo, type ChatRepo } from './chatRepo'
export {
  createSessionManager,
  buildStudyPrompt,
  type SessionManager
} from './SessionManager'
