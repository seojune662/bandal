import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** The native API resolves App Group locations; do not assume ~/Library paths. */
export function createShareRootResolver(input: { resourcesPath: string; packaged: boolean; platform: string; env: NodeJS.ProcessEnv }): () => string | null {
  let resolved: string | null | undefined
  return () => {
    if (resolved !== undefined) return resolved
    if (input.env.BANDAL_USER_DATA_DIR && input.env.BANDAL_SHARE_INBOX_DIR) return (resolved = input.env.BANDAL_SHARE_INBOX_DIR)
    if (input.platform !== 'darwin' || !input.packaged) return (resolved = null)
    try {
      const output = execFileSync(join(input.resourcesPath, 'share', 'bandal-share-inbox'), [], { timeout: 5000, encoding: 'utf8' }).trim()
      if (!output.startsWith('/')) throw new Error('Invalid share container')
      return (resolved = output)
    } catch (error) {
      console.warn('[share] App Group unavailable', error)
      // No persistent negative cache: a later permission grant can recover.
      return null
    }
  }
}
