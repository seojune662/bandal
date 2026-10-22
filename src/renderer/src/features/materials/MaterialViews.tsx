import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { openMaterialInWorkspace } from '../workspace/openMaterial'
import { MaterialTree, TreeNode, type MaterialTreeProps } from './MaterialTree'
import { MaterialFileIcon } from './materialIcons'
import { findMaterialNode, materialBaseName, materialParentPath } from './materialPaths'
import type { MaterialView } from './materialViewPreference'

const MaterialPreviewContent = lazy(() => import('./preview/MaterialPreviewContent').then(module => ({ default: module.MaterialPreviewContent })))
const VIEW_LABELS: Record<MaterialView, string> = { icons: '아이콘', list: '목록', columns: '열', gallery: '갤러리' }

function ViewIcon({ view }: { view: MaterialView }): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {view === 'icons' ? <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></>
      : view === 'list' ? <><path d="M7 4h10M7 10h10M7 16h10M3 4h.1M3 10h.1M3 16h.1" /></>
        : view === 'columns' ? <><rect x="2.5" y="3" width="15" height="14" rx="1.5" /><path d="M7.5 3v14M12.5 3v14" /></>
          : <><rect x="3" y="3" width="14" height="10" rx="1.5" /><path d="M3 16h3M8.5 16h3M14 16h3" /></>}
  </svg>
}

export function MaterialViewMenu({ value, onChange }: { value: MaterialView; onChange: (view: MaterialView) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const dismiss = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const blur = (): void => setOpen(false)
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('blur', blur) }
  }, [open])
  const close = (): void => { setOpen(false); trigger.current?.focus() }
  return <div className="materials-view-picker" ref={root} onContextMenu={event => event.stopPropagation()}>
    <button ref={trigger} type="button" className="materials-view-picker__trigger" aria-label="자료 보기 방식" title={`보기: ${VIEW_LABELS[value]}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) }
    }}><ViewIcon view={value} /><span>{VIEW_LABELS[value]}</span><span aria-hidden="true">⌄</span></button>
    {open && <div ref={menu} id={id} className="materials-view-menu" role="menu" aria-label="자료 보기 방식" onKeyDown={event => {
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === 'Tab') setOpen(false)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[index]?.focus()
      }
    }}>
      {(Object.keys(VIEW_LABELS) as MaterialView[]).map(view => <button type="button" key={view} role="menuitemradio" aria-checked={value === view} onClick={() => { onChange(view); close() }}>
        <ViewIcon view={view} /><span>{VIEW_LABELS[view]}</span><span aria-hidden="true">{value === view ? '✓' : ''}</span>
      </button>)}
    </div>}
  </div>
}

/** Only visible cards mount the expensive PDF/image/document preview readers. */
function CardPreview({ courseId, node }: { courseId: string; node: MaterialNode }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (node.kind === 'dir') return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { root: root.current?.closest('.materials-body') ?? null, rootMargin: '80px' })
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [node.kind])
  return <div ref={root} className="material-card-preview" data-kind={node.kind} aria-hidden="true">
    {node.kind === 'dir' ? <><MaterialFileIcon kind="dir" /><small>{node.children?.length ?? 0}개 항목</small></>
      : visible ? <Suspense fallback={<MaterialFileIcon kind={node.kind} />}><MaterialPreviewContent courseId={courseId} node={node} /></Suspense>
        : <MaterialFileIcon kind={node.kind} />}
  </div>
}

function metadata(node: MaterialNode): string {
  if (node.kind === 'dir') return `${node.children?.length ?? 0}개 항목`
  const date = node.mtime ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(node.mtime) : ''
  const size = node.size === undefined ? '' : node.size < 1024 ? `${node.size} B` : node.size < 1024 * 1024 ? `${Math.ceil(node.size / 1024)} KB` : `${(node.size / (1024 * 1024)).toFixed(1)} MB`
  return [date, size].filter(Boolean).join(' · ')
}

function SelectedPreview({ courseId, node, className }: { courseId: string; node: MaterialNode; className: string }): JSX.Element {
  return <section className={className} aria-label={`${node.name} 미리보기`}>
    <div className="materials-detail-preview"><Suspense fallback={<MaterialFileIcon kind={node.kind} />}><MaterialPreviewContent key={node.relPath} courseId={courseId} node={node} /></Suspense></div>
    <strong title={node.name}>{node.name}</strong>
    <small>{metadata(node)}</small>
    <button type="button" className="materials-preview-open" onClick={() => { if (node.kind !== 'dir') openMaterialInWorkspace(node.kind, node.relPath) }}>자료 열기<Icon name="chevronRight" /></button>
  </section>
}

interface MaterialBrowserProps extends MaterialTreeProps {
  view: MaterialView
  rootRelPath?: string
  directory: string
  onDirectoryChange: (relPath: string) => void
  searching?: boolean
}

export function MaterialBrowser({ view, directory, rootRelPath = '', onDirectoryChange, searching = false, ...props }: MaterialBrowserProps): JSX.Element {
  const directoryNode = findMaterialNode(props.nodes, directory)
  const validDirectory = !searching && directoryNode?.kind === 'dir' ? directoryNode.relPath : ''
  const nodes = validDirectory === '' ? props.nodes : directoryNode?.children ?? []
  const selected = findMaterialNode(props.nodes, props.selectedRelPath)
  const columns = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view !== 'columns') return
    const element = columns.current
    if (element) element.scrollTo?.({ left: element.scrollWidth, behavior: 'smooth' })
  }, [view, validDirectory, selected?.relPath])
  if (view === 'list') return <MaterialTree {...props} />
  const navigate = (relPath: string): void => {
    onDirectoryChange(relPath)
    const node = findMaterialNode(props.nodes, relPath)
    if (node) props.onSelect(node)
  }
  const trail = validDirectory.split('/').filter(Boolean).map((_, index, parts) => parts.slice(0, index + 1).join('/')).filter(path => !rootRelPath || path.startsWith(rootRelPath + '/'))
  const item = (node: MaterialNode, appearance: 'icon' | 'gallery' | 'column'): JSX.Element => <TreeNode
    {...props} key={node.relPath} node={node} depth={0} flat appearance={appearance} selectOnly={appearance !== 'icon'}
    expandedPaths={Object.fromEntries(trail.map(path => [path, true]))}
    preview={appearance === 'column' ? undefined : <><CardPreview courseId={props.courseId} node={node} /><small className="material-card-metadata">{metadata(node)}</small></>}
    onToggleFolder={navigate}
    onSelect={node => {
      if (appearance === 'column' && node.kind !== 'dir' && materialParentPath(node.relPath) !== validDirectory) onDirectoryChange(materialParentPath(node.relPath))
      props.onSelect(node)
    }}
  />
  const galleryNode = nodes.find(node => node.relPath === props.selectedRelPath && node.kind !== 'dir') ?? nodes.find(node => node.kind !== 'dir')
  const columnPaths = ['', ...trail]
  return <div className="materials-browser" data-view={view}>
    {!searching && <nav className="materials-breadcrumbs" aria-label="자료 폴더 경로">
      <button type="button" aria-label="전체 자료" onClick={() => navigate(rootRelPath)}><Icon name="folder" /><span>전체 자료</span></button>
      {trail.map(path => <span key={path}><Icon name="chevronRight" /><button type="button" aria-current={path === validDirectory ? 'location' : undefined} onClick={() => navigate(path)}>{materialBaseName(path)}</button></span>)}
    </nav>}
    {view === 'columns' ? <div ref={columns} className="materials-columns" aria-label="자료 열 보기">
      {columnPaths.map(path => {
        const children = path === '' ? props.nodes : findMaterialNode(props.nodes, path)?.children ?? []
        return <section className="materials-column" key={path} aria-label={path === '' ? '전체 자료' : materialBaseName(path)}><header>{path === '' ? '전체 자료' : materialBaseName(path)}</header>
          <ul className="materials-items" role="tree" aria-label={path === '' ? '전체 자료 파일' : `${materialBaseName(path)} 파일`}>{children.map(node => item(node, 'column'))}</ul>
          {children.length === 0 && <p className="materials-empty-folder">빈 폴더</p>}
        </section>
      })}
      {selected && selected.kind !== 'dir' && <SelectedPreview courseId={props.courseId} node={selected} className="materials-column-preview" />}
    </div> : <>
      {view === 'gallery' && galleryNode && <SelectedPreview courseId={props.courseId} node={galleryNode} className="materials-gallery-preview" />}
      <ul className={`materials-items materials-items--${view}`} role="tree" aria-label={searching ? '자료 검색 결과' : view === 'icons' ? '자료 아이콘 보기' : '자료 갤러리 보기'}>{nodes.map(node => item(node, view === 'icons' ? 'icon' : 'gallery'))}</ul>
      {nodes.length === 0 && <p className="materials-empty-folder">이 폴더에 자료를 드래그해서 추가하세요.</p>}
      <p className="materials-item-count">{nodes.length}개 항목{view === 'gallery' && nodes.length > 0 ? ' · 두 번 클릭해서 열기' : ''}</p>
    </>}
  </div>
}
