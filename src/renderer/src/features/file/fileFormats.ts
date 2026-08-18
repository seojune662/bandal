export type FileViewerKind = 'docx' | 'sheet' | 'text' | 'video'

const DOCX_EXTENSIONS = ['.docx'] as const
const SHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv'] as const
/** materialsRepo.kindForFile 의 VIDEO_EXTENSIONS 와 같은 목록이어야 한다. */
const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.webm'] as const

/**
 * Plain-text formats returned as UTF-8 by the material IPC, plus common
 * source-code and configuration formats that are still useful as text when
 * the main process returns them as base64.
 */
const TEXT_EXTENSIONS = [
  '.txt',
  '.json',
  '.yml',
  '.yaml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.tex',
  '.log',
  '.srt',
  '.vtt',
  '.md',
  '.markdown',
  '.py',
  '.pyw',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hh',
  '.hxx',
  '.cs',
  '.go',
  '.rs',
  '.swift',
  '.kt',
  '.kts',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.rb',
  '.php',
  '.pl',
  '.pm',
  '.r',
  '.sql',
  '.lua',
  '.dart',
  '.scala',
  '.groovy',
  '.gradle',
  '.vue',
  '.svelte',
  '.astro',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.env',
  '.gitignore',
  '.gitattributes',
  '.editorconfig'
] as const

const DOCX_EXTENSION_SET: ReadonlySet<string> = new Set(DOCX_EXTENSIONS)
const SHEET_EXTENSION_SET: ReadonlySet<string> = new Set(SHEET_EXTENSIONS)
const TEXT_EXTENSION_SET: ReadonlySet<string> = new Set(TEXT_EXTENSIONS)
const VIDEO_EXTENSION_SET: ReadonlySet<string> = new Set(VIDEO_EXTENSIONS)

export const VIEWABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...DOCX_EXTENSIONS,
  ...SHEET_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...VIDEO_EXTENSIONS
])

function extensionFor(relPath: string): string {
  const fileName = relPath.split('/').at(-1) ?? relPath
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

export function viewerKindFor(relPath: string): FileViewerKind | null {
  const extension = extensionFor(relPath)
  if (DOCX_EXTENSION_SET.has(extension)) return 'docx'
  if (SHEET_EXTENSION_SET.has(extension)) return 'sheet'
  if (TEXT_EXTENSION_SET.has(extension)) return 'text'
  if (VIDEO_EXTENSION_SET.has(extension)) return 'video'
  return null
}

export function isViewableFile(relPath: string): boolean {
  return VIEWABLE_EXTENSIONS.has(extensionFor(relPath))
}
