/** The real PDF viewer uses HTTP/Blob URLs here instead of Electron's custom protocol. */
export function mediaUrlFor(_courseId: string, relPath: string): string {
  if (relPath.endsWith('.pdf')) return `${import.meta.env.BASE_URL}sample.pdf`
  return ''
}
