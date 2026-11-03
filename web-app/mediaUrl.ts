/**
 * Replaces the renderer's `bandal-media://` URLs in the web app build.
 * `scripts/build-web-app.mjs` resolves `features/materials/mediaUrl` here.
 * `web-app/public/media-sw.js` serves these same-origin paths from bytes the
 * page downloads from Google Drive.
 */
export function mediaUrlFor(courseId: string, relPath: string): string {
  const segments = relPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `${import.meta.env.BASE_URL}media/${encodeURIComponent(courseId)}/${segments}`
}

/** The inverse of mediaUrlFor for the path after `media/`; null when it is not one. */
export function parseMediaPath(path: string): { courseId: string; relPath: string } | null {
  const [course, ...rest] = path.split('/')
  if (!course || rest.length === 0) return null
  try {
    const relPath = rest.map(segment => decodeURIComponent(segment)).join('/')
    return { courseId: decodeURIComponent(course), relPath }
  } catch {
    return null
  }
}
