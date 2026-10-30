export interface SubscriptionSource {
  provider: 'paddle' | 'apple'; environment: string; active: boolean
  plan: 'monthly' | 'annual' | null; status: string; validUntil: string | null
  cancelAtPeriodEnd: boolean; canManage: boolean
}
export interface SubscriptionStatus {
  active: boolean; sources: SubscriptionSource[]; validUntil: string | null
  duplicateSubscription: boolean; storageLimitBytes: number
}
export interface SyncAccessStatus {
  writeAllowed: boolean; accessSource?: string | null; storageUsedBytes: number; storageLimitBytes: number
  quotaExceeded?: boolean; reason?: string | null
}
export interface BillingState {
  provider: 'apple' | 'paddle'; subscription: SubscriptionStatus; sync: SyncAccessStatus
  products?: Array<{id:string;plan?:'monthly'|'annual';displayName:string;displayPrice:string}>
  ok?: boolean; status?: 'purchased' | 'pending' | 'cancelled' | 'restored'
}
export interface RuntimeSyncState {
  phase: string; enabled: boolean; pending: number; conflicts: number
  writeAllowed?: boolean; blockedReason?: string | null; retryAt?: string | null
  lastSyncedAt?: string | null; storageUsedBytes?: number; storageLimitBytes?: number
  message?: string; error?: string | null
  /** false once the retired Supabase account sync is switched off (the default). */
  available?: boolean
}
export interface SyncConflictVersion {
  exists: boolean; deleted: boolean; title?: string; updatedAt?: string
  revision?: number | string; page?: number; objects?: number; text?: string
}
export interface RuntimeSyncConflict {
  id: string; recordID?: string; label?: string; createdAt?: string; message?: string; reason?: string
  variants?: { local: SyncConflictVersion; remote: SyncConflictVersion }
  [key:string]: unknown
}
