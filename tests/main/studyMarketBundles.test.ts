import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createStudyMarketBundles, validateMarketPath } from '../../src/main/features/studyMarket/bundles'
import { markdownImageDependencies, rewriteMarketMarkdown } from '../../src/main/features/studyMarket/markdown'
import { createPdfExporter } from '../../src/main/features/pdf/exportPdf'
import { createPdfPageNoteMarkdown } from '../../src/shared/pdfPageNote'
import type { Annotation } from '../../src/shared/types/annotation'
import type { StudyMarketFile } from '../../src/shared/types/studyMarket'
import { STUDY_MARKET_LIMITS } from '../../src/shared/types/studyMarket'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1kAAAAASUVORK5CYII=', 'base64')
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
function downloadFile(path: string, bytes: Buffer | string): StudyMarketFile & { url: string } {
  const content = Buffer.from(bytes)
  return { id: path, path, bytes: content.length, sha256: sha(content), mime: path.endsWith('.md') ? 'text/markdown' : path.endsWith('.png') ? 'image/png' : 'application/pdf', url: `https://storage.example.test/${encodeURIComponent(path)}` }
}

describe('study market snapshots and downloads', () => {
  let folder: string
  let notes: Annotation[]
  let bundles: ReturnType<typeof createStudyMarketBundles>
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'bandal-market-test-'))
    notes = []
    fetcher = vi.fn<typeof fetch>()
    const exporter = createPdfExporter({ getCourseFolder: () => folder, listAnnotations: () => notes, listDrawings: () => [] })
    bundles = createStudyMarketBundles({ getCourseFolder: () => folder, exportAnnotated: exporter.exportAnnotated, listAnnotations: () => notes, tempRoot: folder, fetch: fetcher, sanitizePreview: bytes => bytes })
  })
  afterEach(async () => { await bundles.dispose(); await rm(folder, { recursive: true, force: true }) })

  test('freezes annotated PDF, preserves written comments, and previews one page only', async () => {
    const document = await PDFDocument.create(); document.addPage([400, 400]); document.addPage([400, 400])
    const original = Buffer.from(await document.save()); await writeFile(join(folder, '강의.pdf'), original)
    notes = [{ id: 'annotation', courseId: 'course', relPath: '강의.pdf', page: 2, color: 'yellow', rects: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.1 }], anchor: { quote: '중요한 정의', prefix: '', suffix: '' }, comment: '시험 전에 외우기', createdAt: '', updatedAt: '' }]
    const bundle = await bundles.prepare({ courseId: 'course', relPaths: ['강의.pdf'] })
    const files = await bundles.getUploadFiles(bundle.id)
    const pdf = files.find(file => file.path === '강의.pdf')!
    expect(await readFile(join(folder, '강의.pdf'))).toEqual(original)
    expect(pdf.sha256).not.toBe(sha(original))
    const comments = await readFile(files.find(file => file.path.endsWith('.md'))!.absolutePath, 'utf8')
    expect(comments).toContain('시험 전에 외우기'); expect(comments).toContain('중요한 정의'); expect(comments).toContain('page=2')
    await writeFile(join(folder, '강의.pdf'), 'edited after preparation')
    expect((await bundles.getUploadFiles(bundle.id))[0]!.sha256).toBe(pdf.sha256)
    const preview = await bundles.previewSource({ bundleId: bundle.id, fileId: pdf.id, page: 2 })
    expect((await PDFDocument.load(Buffer.from(preview.base64!, 'base64'))).getPageCount()).toBe(1)
    await expect(bundles.previewSource({ bundleId: bundle.id, fileId: pdf.id, page: 3 })).rejects.toThrow('페이지')
  })

  test('includes only referenced image dependencies and detaches page note metadata', async () => {
    await mkdir(join(folder, 'assets')); await writeFile(join(folder, 'assets/photo.png'), png); await writeFile(join(folder, 'assets/private.png'), png)
    const content = createPdfPageNoteMarkdown('공부', '원본.pdf', 'old', [{ width: 1, height: 1 }], ['![사진](assets/photo.png)'])
    await writeFile(join(folder, '공부.md'), content)
    const bundle = await bundles.prepare({ courseId: 'course', relPaths: ['공부.md'] })
    expect(bundle.files.map(file => file.path).sort()).toEqual(['assets/photo.png', '공부.md'])
    expect(bundle.warnings).toHaveLength(1)
    const uploaded = await bundles.getUploadFiles(bundle.id)
    const markdown = await readFile(uploaded.find(file => file.path === '공부.md')!.absolutePath, 'utf8')
    expect(markdown).toContain('## PDF 1쪽 필기'); expect(markdown).not.toContain('bandal:pdf-page-note')
    expect(await readFile(join(folder, '공부.md'), 'utf8')).toBe(content)
  })

  test('refuses symlinked files and directories, traversal and oversized files', async () => {
    await writeFile(join(folder, 'note.md'), 'note'); await mkdir(join(folder, 'real')); await writeFile(join(folder, 'real/note.md'), 'note')
    await symlink(join(folder, 'note.md'), join(folder, 'linked.md')); await symlink(join(folder, 'real'), join(folder, 'linked'))
    await expect(bundles.prepare({ courseId: 'course', relPaths: ['linked.md'] })).rejects.toThrow('심볼릭')
    await expect(bundles.prepare({ courseId: 'course', relPaths: ['linked/note.md'] })).rejects.toThrow('심볼릭')
    await expect(bundles.prepare({ courseId: 'course', relPaths: ['../note.md'] })).rejects.toThrow()
    await writeFile(join(folder, 'huge.md'), ''); await truncate(join(folder, 'huge.md'), STUDY_MARKET_LIMITS.fileBytes + 1)
    await expect(bundles.prepare({ courseId: 'course', relPaths: ['huge.md'] })).rejects.toThrow('50MB')
  })

  test('rejects mutated staged artifacts before upload', async () => {
    await writeFile(join(folder, 'note.md'), 'original')
    const bundle = await bundles.prepare({ courseId: 'course', relPaths: ['note.md'] }); const [file] = await bundles.getUploadFiles(bundle.id)
    await writeFile(file!.absolutePath, 'tampered')
    await expect(bundles.getUploadFiles(bundle.id)).rejects.toThrow('변경')
  })

  test('public preview is a bounded PNG, never the source document', async () => {
    await writeFile(join(folder, 'note.md'), '본문')
    const bundle = await bundles.prepare({ courseId: 'course', relPaths: ['note.md'] }); const fileId = bundle.files[0]!.id
    await expect(bundles.preview({ bundleId: bundle.id, fileId, dataUrl: 'data:text/html;base64,PGh0bWw+' })).rejects.toThrow('PNG')
    const result = await bundles.preview({ bundleId: bundle.id, fileId, dataUrl: `data:image/png;base64,${png.toString('base64')}` })
    expect(result.file.preview).toBe(true); expect(result.file.mime).toBe('image/png')
    expect((await bundles.getUploadFiles(bundle.id)).map(file => file.preview)).toEqual([undefined, true])
    await expect(bundles.discardPreview(bundle.id, fileId)).rejects.toThrow('미리보기')
    for (let index = 0; index < 2; index += 1) await bundles.preview({ bundleId: bundle.id, fileId, dataUrl: result.dataUrl })
    await expect(bundles.preview({ bundleId: bundle.id, fileId, dataUrl: result.dataUrl })).rejects.toThrow('3개')
    await bundles.discardPreview(bundle.id, result.file.id)
    await bundles.preview({ bundleId: bundle.id, fileId, dataUrl: result.dataUrl })
    await bundles.discardPreview(bundle.id, (await bundles.getUploadFiles(bundle.id)).find(file => file.preview)!.id)
    const tooLarge = Buffer.from(png); tooLarge.writeUInt32BE(2049, 16)
    await expect(bundles.preview({ bundleId: bundle.id, fileId, dataUrl: `data:image/png;base64,${tooLarge.toString('base64')}` })).rejects.toThrow('2048')
    await bundles.discardBundle(bundle.id)
    await expect(bundles.getUploadFiles(bundle.id)).rejects.toThrow('다시 선택')
  })

  test('imports one complete fresh directory and preserves existing notes and image links', async () => {
    await mkdir(join(folder, '구매 자료/시험 정리'), { recursive: true }); await writeFile(join(folder, '구매 자료/시험 정리/mine.md'), 'keep')
    const markdown = '![사진](assets/photo.png)\n[원문](bandal://material?path=slides.pdf&page=2&annotationId=old)\n[[slides.pdf|자료]]'
    const contents = new Map([['note.md', Buffer.from(markdown)], ['assets/photo.png', png], ['slides.pdf', Buffer.from('%PDF')]])
    fetcher.mockImplementation(async url => new Response(contents.get(decodeURIComponent(new URL(String(url)).pathname.slice(1)))!))
    const files = [...contents].map(([path, bytes]) => downloadFile(path, bytes))
    const result = await bundles.importDownload({ courseId: 'course', title: '시험 정리', files })
    expect(result.relPath).toBe('구매 자료/시험 정리 (2)')
    expect(await readFile(join(folder, '구매 자료/시험 정리/mine.md'), 'utf8')).toBe('keep')
    const imported = await readFile(join(folder, result.relPath, 'note.md'), 'utf8')
    expect(imported).toContain('assets/photo.png'); expect(imported).toContain(encodeURI(result.relPath).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    expect(imported).not.toContain('annotationId'); expect(imported).toContain(`[[${result.relPath}/slides.pdf|자료]]`)
    expect((await readdir(join(folder, '구매 자료'))).sort()).toEqual(['시험 정리', '시험 정리 (2)'])
  })

  test('a corrupt or oversized streamed response leaves no imported bundle', async () => {
    const files = [downloadFile('note.md', 'expected')]
    fetcher.mockResolvedValueOnce(new Response('corrupte'))
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files })).rejects.toThrow('무결성')
    expect(await readdir(join(folder, '구매 자료'))).toEqual([])
    fetcher.mockResolvedValueOnce(new Response('too long to be valid'))
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files })).rejects.toThrow('크기')
    expect(await readdir(join(folder, '구매 자료'))).toEqual([])
  })

  test('renews a grant that expires after an earlier file without restarting the bundle', async () => {
    const files = [downloadFile('first.md', 'first'), downloadFile('second.md', 'second')]
    const renewed = 'https://storage.example.test/second.md?fresh=1'
    fetcher.mockResolvedValueOnce(new Response('first')).mockResolvedValueOnce(new Response('expired', { status: 403 })).mockResolvedValueOnce(new Response('second'))
    const refreshUrl = vi.fn(async (file: StudyMarketFile) => {
      expect(file).toMatchObject({ id: 'second.md', sha256: sha('second'), bytes: 6 })
      const [stage] = (await readdir(join(folder, '구매 자료'))).filter(path => path.startsWith('.bandal-market-'))
      expect(await readFile(join(folder, '구매 자료', stage!, 'first.md'), 'utf8')).toBe('first')
      return renewed
    })
    const result = await bundles.importDownload({ courseId: 'course', title: 'purchase', files, refreshUrl })
    expect(refreshUrl).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([files[0]!.url, files[1]!.url, renewed])
    expect(fetcher.mock.calls.every(call => call[1]?.redirect === 'error')).toBe(true)
    expect(await readFile(join(folder, result.relPath, 'first.md'), 'utf8')).toBe('first')
    expect(await readFile(join(folder, result.relPath, 'second.md'), 'utf8')).toBe('second')
  })

  test.each(['forbidden', 'corrupt'])('a renewed %s response cannot change the manifest or loop indefinitely', async failure => {
    fetcher.mockResolvedValueOnce(new Response('expired', { status: 403 })).mockResolvedValueOnce(new Response(failure === 'corrupt' ? 'edited' : 'expired', { status: failure === 'forbidden' ? 403 : 200 }))
    const refreshUrl = vi.fn(async () => 'https://storage.example.test/note.md?fresh=1')
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files: [downloadFile('note.md', 'source')], refreshUrl })).rejects.toThrow()
    expect(refreshUrl).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readdir(join(folder, '구매 자료'))).toEqual([])
  })

  test.each([
    [400, { code: 'InvalidJWT', message: 'jwt expired' }],
    [401, { code: 'InvalidJWT', message: 'Invalid JWT' }],
    [400, { code: 'ExpiredToken', message: 'The provided token has expired' }],
    [401, { error: 'ExpiredToken', message: 'The provided token has expired' }],
    [400, { statusCode: '400', error: 'Error', message: 'jwt expired' }]
  ])('renews recognized Supabase expiry response %s %j', async (status, error) => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(error), { status: Number(status) })).mockResolvedValueOnce(new Response('source'))
    const refreshUrl = vi.fn(async () => 'https://storage.example.test/note.md?fresh=1')
    const result = await bundles.importDownload({ courseId: 'course', title: 'purchase', files: [downloadFile('note.md', 'source')], refreshUrl })
    expect(refreshUrl).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readFile(join(folder, result.relPath, 'note.md'), 'utf8')).toBe('source')
  })

  test.each([
    [400, JSON.stringify({ code: 'InvalidRequest', message: 'Invalid request' })],
    [401, JSON.stringify({ error: 'Unauthorized' })],
    [400, JSON.stringify({ code: 'ExpiredToken', message: 'x'.repeat(4096) })]
  ])('does not renew unrelated or oversized error response %s', async (status, body) => {
    fetcher.mockResolvedValueOnce(new Response(body, { status }))
    const refreshUrl = vi.fn(async () => 'https://storage.example.test/note.md?fresh=1')
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files: [downloadFile('note.md', 'source')], refreshUrl })).rejects.toThrow('내려받지')
    expect(refreshUrl).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1)
    expect(await readdir(join(folder, '구매 자료'))).toEqual([])
  })

  test('rejects colliding manifests and aggregate limits before networking', async () => {
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files: [downloadFile('A.md', 'a'), downloadFile('a.md', 'b')] })).rejects.toThrow('이름')
    const huge = Array.from({ length: 5 }, (_, i) => ({ ...downloadFile(`${i}.md`, 'a'), bytes: STUDY_MARKET_LIMITS.fileBytes }))
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files: huge })).rejects.toThrow('200MB')
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('concurrent imports of the same product keep distinct complete directories', async () => {
    fetcher.mockImplementation(async () => new Response('note'))
    const files = [downloadFile('note.md', 'note')]
    const results = await Promise.all([
      bundles.importDownload({ courseId: 'course', title: 'purchase', files }),
      bundles.importDownload({ courseId: 'course', title: 'purchase', files })
    ])
    expect(results.map(result => result.relPath).sort()).toEqual(['구매 자료/purchase', '구매 자료/purchase (2)'])
    for (const result of results) expect(await readFile(join(folder, result.relPath, 'note.md'), 'utf8')).toBe('note')
  })

  test('does not import through a symlinked purchase directory', async () => {
    await mkdir(join(folder, 'other')); await symlink(join(folder, 'other'), join(folder, '구매 자료'))
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files: [downloadFile('note.md', 'note')] })).rejects.toThrow('폴더')
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('cancelling a download cleans staging without touching existing files', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(bundles.importDownload({ courseId: 'course', title: 'purchase', files: [downloadFile('note.md', 'note')], signal: controller.signal })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled(); expect(await readdir(join(folder, '구매 자료'))).toEqual([])
  })
})

describe('portable market Markdown', () => {
  test('finds inline, reference and wiki images without reading code examples', () => {
    const input = '![one](assets/a.png)\n![two][p]\n[p]: assets/b.png\n![[c.png]]\n`![ignored](private.png)`\n```md\n![ignored](secret.png)\n```'
    expect(markdownImageDependencies(input, ['c.png'])).toEqual(['assets/a.png', 'assets/b.png', 'c.png'])
  })
  test('remaps selected links, removes omitted targets and preserves code and external links', () => {
    const input = '[kept](bandal://material?path=slides.pdf&page=3&annotationId=old)\n[missing](bandal://material?path=private.pdf)\n[[private.pdf|private]]\n[[note|label]]\n[site](https://example.test)\n[local](file:///private/data.txt)\n`[[note]]`'
    const output = rewriteMarketMarkdown(input, { coursePaths: ['slides.pdf', 'private.pdf', 'note.md'], includedPaths: ['slides.pdf', 'note.md'], prefix: '구매 자료/bundle' })
    expect(output).toContain('page=3'); expect(output).not.toContain('annotationId'); expect(output).not.toContain('path=private')
    expect(output).toContain('[[구매 자료/bundle/note.md|label]]'); expect(output).toContain('`[[note]]`'); expect(output).toContain('https://example.test'); expect(output).not.toContain('file:///')
  })
  test('preserves encoded hash filenames and removes excluded reference definitions', () => {
    const input = '![image](assets/a%23b.png)\n[omitted][ref]\n[ref]: private.md'
    expect(markdownImageDependencies(input, [])).toEqual(['assets/a#b.png'])
    const output = rewriteMarketMarkdown(input, { coursePaths: ['assets/a#b.png', 'private.md'], includedPaths: ['assets/a#b.png'], prefix: 'purchase' })
    expect(output).toContain('purchase/assets/a%23b.png'); expect(output).not.toContain('private.md'); expect(output).toContain('omitted')
  })
  test.each(['../secret.md', '/root.md', 'a\\b.md', 'a/./b.md', 'CON.md', '.private/key.md', 'a./b.md'])('rejects nonportable package path %s', path => {
    expect(() => validateMarketPath(path)).toThrow()
  })
})
