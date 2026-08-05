// group feature (main process) — Phase-2 community runtime [P2-C].
//
// Everything here is lazily constructed by `createGroupRuntime`; importing
// this barrel does NOT touch the network, the session file or Supabase.
export { readSupabaseConfig, isConfigured, type SupabaseConfig } from './config'
export {
  createGroupRuntime,
  type GroupRuntime,
  type GroupRuntimeDeps
} from './groupRuntime'
export {
  createGroupService,
  NotSignedInError,
  RateLimitedError,
  TAIL_PAGE_SIZE,
  type GroupService
} from './GroupService'
export {
  createGroupRepo,
  MAX_OUTBOX_ATTEMPTS,
  MESSAGE_CACHE_LIMIT,
  type GroupRepo
} from './groupRepo'
export {
  backoffMs,
  createOutboxUploader,
  nextOutboxState,
  type OutboxUploader,
  type SendOutcome
} from './OutboxUploader'
export {
  createGroupRealtimeManager,
  BLUR_UNSUBSCRIBE_MS,
  DEGRADED_POLL_MS,
  MAX_LIVE_CHANNELS,
  SOFT_CLOSE_MS,
  type GroupRealtimeManager
} from './GroupRealtimeManager'
export {
  createGroupEventBatcher,
  GROUP_BATCH_DEBOUNCE_MS,
  GROUP_BATCH_MAX_WAIT_MS,
  type GroupEventBatcher
} from './groupEventBatcher'
export {
  createRateGuard,
  RATE_RULES,
  type RateGuard,
  type RateRule
} from './rateGuard'
export { createAuthService, isValidNickname, type AuthService } from './authService'
