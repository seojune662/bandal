export type BrowserAuthReason = 'insecure-browser' | 'disallowed-useragent'

/** A provider refusal observed in one browser document; never an account identity. */
export interface BrowserAuthStatus {
  status: 'blocked' | 'clear'
  documentId: string
  reason?: BrowserAuthReason
  restartUrl?: string
  origin: string
  path: string
}
