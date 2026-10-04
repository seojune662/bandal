import { rename } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

const RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const
interface RenameRetryOptions {
  platform?: NodeJS.Platform
  rename?: typeof rename
  wait?: (milliseconds: number) => Promise<void>
}

/** Windows can briefly refuse a rename while a scanner holds a directory handle. */
export async function renameWithRetry(
  sourcePath: string,
  destinationPath: string,
  beforeAttempt: () => void | Promise<void>,
  options: RenameRetryOptions = {}
): Promise<void> {
  const operation = options.rename ?? rename
  const wait = options.wait ?? ((milliseconds: number) => setTimeout(milliseconds))
  const windows = (options.platform ?? process.platform) === 'win32'
  for (let attempt = 0; ; attempt += 1) {
    // An external change during the wait must not bypass path/collision guards.
    await beforeAttempt()
    try {
      await operation(sourcePath, destinationPath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const delay = RETRY_DELAYS_MS[attempt]
      if (!windows || (code !== 'EPERM' && code !== 'EBUSY') || delay === undefined) throw error
      // Yield the event loop so our own asynchronous reads can close handles too.
      await wait(delay)
    }
  }
}
