/**
 * "+" new-tab menu — a lightweight take on Orca's typed omnibox: a filter
 * field on top; typing a URL turns the first entry into "open in browser",
 * plain text filters commands and the course's PDF materials.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Course } from '../../../../shared/types/course'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { createBrowserTab, createMarkdownTab } from '../../app/tabCommands'
import { useGroupsStore } from '../../stores/groupsStore'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useNewTabMenu } from './newTabMenuController'
import { descriptorFor, looksLikeUrl, normalizeUrl } from './tabIdentity'
import { TabKindIcon } from './workspaceIcons'

const MENU_WIDTH_PX = 300
const MAX_PDF_ITEMS = 8

interface MenuItem {
  id: string
  label: string
  hint?: string
  shortcut?: string
  icon: JSX.Element
  run: () => void | Promise<void>
}

function collectPdfs(nodes: MaterialNode[], into: MaterialNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'pdf') into.push(node)
    if (node.children !== undefined) collectPdfs(node.children, into)
  }
}

interface NewTabMenuProps {
  course: Course
}

export function NewTabMenu({ course }: NewTabMenuProps): JSX.Element {
  const anchor = useNewTabMenu((state) => state.anchor)
  const close = useNewTabMenu((state) => state.close)
  const openTab = useWorkspaceStore((state) => state.openTab)
  const tree = useMaterialsStore((state) => state.tree)
  // [P2-D] Empty array when signed out or unconfigured, so the group entries
  // simply do not exist rather than appearing disabled.
  const groups = useGroupsStore((state) => state.groups)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const menu = menuRef.current
      if (menu !== null && !menu.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [close])

  const items = useMemo<MenuItem[]>(() => {
    const trimmed = query.trim()
    const matches = (...searchTerms: string[]): boolean =>
      trimmed.length === 0 ||
      searchTerms.some((term) =>
        term.toLowerCase().includes(trimmed.toLowerCase())
      )
    const result: MenuItem[] = []

    if (looksLikeUrl(trimmed)) {
      const url = normalizeUrl(trimmed)
      result.push({
        id: 'open-url',
        label: `${url} 열기`,
        hint: '브라우저',
        icon: <TabKindIcon kind="browser" />,
        run: () => {
          createBrowserTab(url)
        }
      })
    }

    if (matches('새 마크다운', '새 필기')) {
      const titled = trimmed.length > 0 && !looksLikeUrl(trimmed)
      result.push({
        id: 'new-note',
        label: '새 마크다운',
        ...(titled ? { hint: `"${trimmed}"` } : {}),
        shortcut: '⇧⌘M',
        icon: <TabKindIcon kind="note" />,
        run: () => createMarkdownTab(titled ? trimmed : undefined)
      })
    }
    if (matches('새 브라우저 탭')) {
      result.push({
        id: 'new-browser',
        label: '새 브라우저 탭',
        shortcut: '⇧⌘B',
        icon: <TabKindIcon kind="browser" />,
        run: () => {
          createBrowserTab()
        }
      })
    }
    if (matches('AI 튜터')) {
      result.push({
        id: 'chat',
        label: 'AI 튜터',
        hint: course.name,
        icon: <TabKindIcon kind="chat" />,
        run: () => {
          openTab(descriptorFor('chat', { courseId: course.id }))
        }
      })
    }
    if (matches('학업 보드')) {
      result.push({
        id: 'board',
        label: '학업 보드',
        icon: <TabKindIcon kind="board" />,
        run: () => {
          openTab(descriptorFor('board', {}))
        }
      })
    }
    // [P2-D] Groups linked to this course. Only groups the user is already in
    // appear here; discovery (만들기 / 코드로 참여) lives in the 함께하기 rail,
    // and the list is empty — so this whole block is absent — when signed out
    // or in an unconfigured build.
    for (const group of groups.filter(
      (entry) => entry.courseId === course.id && matches(entry.name)
    )) {
      result.push({
        id: `group-chat:${group.id}`,
        label: group.name,
        hint: '그룹 채팅',
        icon: <TabKindIcon kind="group-chat" />,
        run: () => {
          openTab(descriptorFor('group-chat', { groupId: group.id }))
        }
      })
    }

    const pdfs: MaterialNode[] = []
    collectPdfs(tree, pdfs)
    for (const pdf of pdfs.filter((node) => matches(node.name)).slice(0, MAX_PDF_ITEMS)) {
      result.push({
        id: `pdf:${pdf.relPath}`,
        label: pdf.name,
        hint: 'PDF 열기',
        icon: <TabKindIcon kind="pdf" />,
        run: () => {
          openTab(
            descriptorFor('pdf', { courseId: course.id, relPath: pdf.relPath })
          )
        }
      })
    }
    return result
  }, [query, tree, groups, course.id, course.name, openTab])

  const clampedHighlight = Math.min(highlighted, Math.max(items.length - 1, 0))

  const activate = (item: MenuItem | undefined): void => {
    if (item === undefined) return
    void item.run()
    close()
  }

  const style =
    anchor !== null
      ? {
          left: Math.max(
            8,
            Math.min(anchor.x, window.innerWidth - MENU_WIDTH_PX - 8)
          ),
          top: anchor.y
        }
      : undefined

  return (
    <div
      ref={menuRef}
      className="new-tab-menu"
      data-centered={anchor === null}
      style={style}
      role="dialog"
      aria-label="새 탭 열기"
    >
      <div className="new-tab-menu__search">
        <Icon name="search" />
        <input
          ref={inputRef}
          type="text"
          placeholder="검색하거나 URL 입력…"
          aria-label="새 탭 검색"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setHighlighted((index) => Math.min(index + 1, items.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlighted((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              activate(items[clampedHighlight])
            }
          }}
        />
      </div>
      <ul className="new-tab-menu__list" role="listbox" aria-label="새 탭 항목">
        {items.length === 0 ? (
          <li className="new-tab-menu__empty">일치하는 항목이 없어요</li>
        ) : (
          items.map((item, index) => (
            <li key={item.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === clampedHighlight}
                data-highlighted={index === clampedHighlight}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => activate(item)}
              >
                <span className="new-tab-menu__icon">{item.icon}</span>
                <span className="new-tab-menu__label">{item.label}</span>
                {item.hint !== undefined && (
                  <span className="new-tab-menu__hint">{item.hint}</span>
                )}
                {item.shortcut !== undefined && (
                  <span className="new-tab-menu__shortcut" aria-hidden="true">
                    {item.shortcut}
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
