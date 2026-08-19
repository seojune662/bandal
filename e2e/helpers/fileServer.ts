/**
 * A throwaway localhost server for download tests.
 *
 * `will-download` only fires against a real HTTP response, so exercising the
 * download path end-to-end needs a server. This one serves exactly one file
 * with `Content-Disposition: attachment`, which is what a school LMS sends for
 * a lecture handout.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FileServer {
  /** e.g. http://127.0.0.1:54321 */
  origin: string
  close: () => Promise<void>
}

export async function startFileServer(files: {
  [path: string]: {
    fileName: string
    body: string
    contentType?: string
    /** Set false to serve inline, so the page renders instead of downloading. */
    attachment?: boolean
  }
}): Promise<FileServer> {
  const server: Server = createServer((request, response) => {
    const file = files[request.url ?? '']
    if (file === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': file.contentType ?? 'application/octet-stream',
      ...(file.attachment === false
        ? {}
        : {
            // RFC 5987 form — Korean file names arrive this way in practice.
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
              file.fileName
            )}`
          }),
      'content-length': Buffer.byteLength(file.body)
    })
    response.end(file.body)
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
  }
}
