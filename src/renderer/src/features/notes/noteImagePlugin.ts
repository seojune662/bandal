import type { Node as ProseNode } from '@milkdown/prose/model'
import { Fragment } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import type {
  EditorView,
  NodeView,
  NodeViewConstructor
} from '@milkdown/prose/view'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { mediaUrlFor } from '../materials/mediaUrl'

const ASSETS_DIRECTORY = 'assets'
const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp'
])

const MIME_EXTENSION: Readonly<Record<string, string>> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp'
}

interface PendingImageRange {
  from: number
  to: number
}

type PendingImageState = ReadonlyMap<string, PendingImageRange>

type PendingImageMeta =
  | { type: 'add'; id: string; range: PendingImageRange }
  | { type: 'remove'; id: string }

interface SavedImage {
  relPath: string
  alt: string
}

interface SaveImagesResult {
  images: SavedImage[]
  failures: unknown[]
}

export const noteImageInsertKey = new PluginKey<PendingImageState>(
  'note-image-insert'
)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fileExtension(file: File): string {
  const fromMime = MIME_EXTENSION[file.type.toLocaleLowerCase()]
  if (fromMime !== undefined) return fromMime
  const fromName = /\.([a-z0-9]+)$/iu.exec(file.name)?.[1]?.toLocaleLowerCase()
  return fromName !== undefined && IMAGE_EXTENSIONS.has(fromName)
    ? fromName
    : 'png'
}

function fileLabel(file: File): string {
  const label = file.name.replace(/\.[^.]+$/u, '').trim()
  return label.length > 0 ? label : '붙여넣은 이미지'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `붙여넣은 이미지 2026-08-18 22.04.05.png` */
export function pastedNoteImageFileName(file: File, now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`
  return `붙여넣은 이미지 ${date} ${time}.${fileExtension(file)}`
}

export function isNoteImageFile(file: File): boolean {
  if (file.type.toLocaleLowerCase().startsWith('image/')) return true
  const extension = /\.([a-z0-9]+)$/iu.exec(file.name)?.[1]?.toLocaleLowerCase()
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension)
}

function imageFiles(dataTransfer: DataTransfer | null): File[] {
  if (dataTransfer === null) return []
  const files = [...dataTransfer.files]
  const candidates =
    files.length > 0
      ? files
      : [...dataTransfer.items]
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null)
  return candidates.filter(isNoteImageFile)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () =>
      reject(reader.error ?? new Error('이미지를 읽지 못했습니다.'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('이미지를 읽지 못했습니다.'))
        return
      }
      const comma = reader.result.indexOf(',')
      if (comma < 0) {
        reject(new Error('이미지 인코딩이 올바르지 않습니다.'))
        return
      }
      resolve(reader.result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

async function ensureAssetsDirectory(courseId: string): Promise<void> {
  try {
    await invoke('materials:createFolder', {
      courseId,
      dirRelPath: '',
      name: ASSETS_DIRECTORY
    })
  } catch (error) {
    // The shared assets directory normally already exists. Any other failure
    // must remain visible instead of being mistaken for that expected race.
    if (!errorMessage(error).includes('[conflict]')) throw error
  }
}

async function saveImages(
  courseId: string,
  files: readonly File[]
): Promise<SaveImagesResult> {
  await ensureAssetsDirectory(courseId)
  const timestamp = new Date()
  const images: SavedImage[] = []
  const failures: unknown[] = []

  for (const file of files) {
    try {
      const result = await invoke('materials:writeFile', {
        courseId,
        dirRelPath: ASSETS_DIRECTORY,
        fileName: pastedNoteImageFileName(file, timestamp),
        encoding: 'base64',
        data: await fileToBase64(file)
      })
      images.push({ relPath: result.relPath, alt: fileLabel(file) })
    } catch (error) {
      failures.push(error)
    }
  }
  return { images, failures }
}

function addPendingRange(view: EditorView, range: PendingImageRange): string {
  const id = crypto.randomUUID()
  view.dispatch(
    view.state.tr.setMeta(noteImageInsertKey, {
      type: 'add',
      id,
      range
    } satisfies PendingImageMeta)
  )
  return id
}

function removePendingRange(view: EditorView, id: string): void {
  view.dispatch(
    view.state.tr.setMeta(noteImageInsertKey, {
      type: 'remove',
      id
    } satisfies PendingImageMeta)
  )
}

/**
 * Saves image files under the course's assets/ directory, then inserts image
 * nodes whose src stays portable (`assets/...`) in serialized Markdown.
 */
export async function insertNoteImageFiles(
  view: EditorView,
  courseId: string,
  inputFiles: readonly File[],
  range: PendingImageRange = {
    from: view.state.selection.from,
    to: view.state.selection.to
  }
): Promise<void> {
  const files = inputFiles.filter(isNoteImageFile)
  if (files.length === 0) return

  const requestId = addPendingRange(view, range)
  try {
    const { images, failures } = await saveImages(courseId, files)
    if (images.length === 0) {
      throw failures[0] ?? new Error('이미지를 저장하지 못했습니다.')
    }
    const pendingRange = noteImageInsertKey.getState(view.state)?.get(requestId)
    if (pendingRange === undefined) return
    const imageType = view.state.schema.nodes['image']
    if (imageType === undefined) throw new Error('이미지 노드를 만들 수 없습니다.')

    const nodes = images.map(({ relPath, alt }) =>
      imageType.create({ src: relPath, alt, title: '' })
    )
    const transaction = view.state.tr
      .replaceWith(
        pendingRange.from,
        pendingRange.to,
        Fragment.fromArray(nodes)
      )
      .setMeta(noteImageInsertKey, {
        type: 'remove',
        id: requestId
      } satisfies PendingImageMeta)
      .scrollIntoView()
    view.dispatch(transaction)
    view.focus()
    if (failures.length > 0) {
      showToast(
        `${failures.length}개 이미지를 삽입하지 못했습니다: ${errorMessage(failures[0])}`,
        'danger'
      )
    }
  } catch (error) {
    removePendingRange(view, requestId)
    showToast(errorMessage(error) || '이미지를 삽입하지 못했습니다.', 'danger')
  }
}

function noteAssetRelPath(source: string): string | null {
  const normalized = source.replace(/^\.\//u, '')
  if (!normalized.startsWith(`${ASSETS_DIRECTORY}/`)) return null
  try {
    // remark-stringify escapes spaces as %20. Decode that portable Markdown
    // URL before mediaUrlFor encodes each filesystem path segment.
    return decodeURI(normalized)
  } catch {
    return normalized
  }
}

export function noteImageSource(courseId: string, source: string): string {
  const relPath = noteAssetRelPath(source)
  return relPath === null ? source : mediaUrlFor(courseId, relPath)
}

/** Renders local portable paths without mutating the node attrs/serializer. */
export function createNoteImageView(courseId: string): NodeViewConstructor {
  return (initialNode): NodeView => {
    let currentNode: ProseNode = initialNode
    const image = document.createElement('img')
    image.draggable = true

    const render = (): void => {
      const source = String(currentNode.attrs['src'] ?? '')
      const alt = String(currentNode.attrs['alt'] ?? '')
      const title = String(currentNode.attrs['title'] ?? '')
      image.src = noteImageSource(courseId, source)
      image.alt = alt
      if (title.length > 0) image.title = title
      else image.removeAttribute('title')
      const relPath = noteAssetRelPath(source)
      if (relPath !== null) {
        image.dataset.materialRelPath = relPath
      } else {
        delete image.dataset.materialRelPath
      }
    }

    render()
    return {
      dom: image,
      update: (node) => {
        if (node.type !== currentNode.type) return false
        currentNode = node
        render()
        return true
      },
      selectNode: () => image.classList.add('ProseMirror-selectednode'),
      deselectNode: () => image.classList.remove('ProseMirror-selectednode'),
      ignoreMutation: (mutation) =>
        mutation.type === 'attributes' && mutation.target === image
    }
  }
}

export function createNoteImagePlugin(
  courseId: string
): Plugin<PendingImageState> {
  return new Plugin<PendingImageState>({
    key: noteImageInsertKey,
    state: {
      init: () => new Map(),
      apply: (transaction, previous) => {
        const next = new Map<string, PendingImageRange>()
        for (const [id, range] of previous) {
          next.set(id, {
            from: transaction.mapping.map(range.from, -1),
            to: transaction.mapping.map(range.to, 1)
          })
        }

        const meta = transaction.getMeta(noteImageInsertKey) as
          | PendingImageMeta
          | undefined
        if (meta?.type === 'add') next.set(meta.id, meta.range)
        if (meta?.type === 'remove') next.delete(meta.id)
        return next
      }
    },
    props: {
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData)
        if (files.length === 0) return false
        event.preventDefault()
        event.stopPropagation()
        void insertNoteImageFiles(view, courseId, files)
        return true
      },
      handleDrop: (view, event) => {
        const files = imageFiles(event.dataTransfer)
        if (files.length === 0) return false
        event.preventDefault()
        event.stopPropagation()
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY
        })?.pos
        const insertAt = position ?? view.state.selection.from
        void insertNoteImageFiles(view, courseId, files, {
          from: insertAt,
          to: insertAt
        })
        return true
      }
    }
  })
}
