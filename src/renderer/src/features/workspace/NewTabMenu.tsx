/**
 * "+" new-tab menu — a lightweight take on Orca's typed omnibox: a filter
 * field on top; typing a URL turns the first entry into "open in browser",
 * plain text filters commands and the course's PDF materials.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Course } from '../../../../shared/types/course'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { createBrowserTab, createMarkdownTab } from '../../app/tabCommands'
import { showToast } from '../../app/toast'
import { useFavoritesStore } from '../../stores/favoritesStore'
import { useGroupsStore } from '../../stores/groupsStore'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useNewTabMenu } from './newTabMenuController'
import { descriptorFor, looksLikeUrl, normalizeUrl } from './tabIdentity'
import { TabKindIcon } from './workspaceIcons'
import { invoke } from '../../lib/ipc'

const MAX_PDF_ITEMS = 8

interface MenuItem {
  id: string
  label: string
  hint?: string
  shortcut?: string
  icon: JSX.Element
  keepOpen?: boolean
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

function labelForUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
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
  const [isAddingLink, setAddingLink] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [isSavingLink, setSavingLink] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const linkUrlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (isAddingLink) linkUrlRef.current?.focus()
  }, [isAddingLink])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const menu = menuRef.current
      if (menu !== null && !menu.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [close])

  const beginAddLink = (): void => {
    const trimmed = query.trim()
    const url = looksLikeUrl(trimmed) ? normalizeUrl(trimmed) : ''
    setLinkUrl(url)
    setLinkLabel(labelForUrl(url))
    setLinkError(null)
    setAddingLink(true)
  }

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
    // Personal whiteboards live under an expanded course in the rail, which
    // is easy to miss when you are looking for "a tab". The omnibox is where
    // students actually go to open one.
    if (matches('새 화이트보드', '화이트보드', '마인드맵')) {
      result.push({
        id: 'new-whiteboard',
        label: '새 화이트보드',
        hint: '정리 · 마인드맵',
        icon: <TabKindIcon kind="whiteboard" />,
        run: async () => {
          try {
            const board = await invoke('canvas:create', { courseId: course.id })
            openTab(descriptorFor('whiteboard', {
              courseId: course.id,
              boardId: board.id
            }))
          } catch (error) {
            console.error('[Bandal] 화이트보드를 만들지 못했습니다.', error)
          }
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
    // One course-scoped tab owns the in-panel group switcher. Keep the entry
    // hidden when the course has no groups, and carry the matching group only
    // when search entered through a group name.
    const courseGroups = groups.filter((group) => group.courseId === course.id)
    const matchingGroup =
      trimmed.length > 0
        ? courseGroups.find((group) => matches(group.name))
        : undefined
    if (
      courseGroups.length > 0 &&
      (matches('함께하기', '그룹') || matchingGroup !== undefined)
    ) {
      result.push({
        id: `group-chat:${course.id}`,
        label: '함께하기',
        hint: course.name,
        icon: <TabKindIcon kind="group-chat" />,
        run: () => {
          openTab(
            descriptorFor('group-chat', {
              courseId: course.id,
              ...(matchingGroup !== undefined
                ? { groupId: matchingGroup.id }
                : {})
            })
          )
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

  const linkItem: MenuItem = {
    id: 'add-link',
    label: '링크 추가',
    hint: '즐겨찾기',
    icon: <Icon name="link" />,
    keepOpen: true,
    run: beginAddLink
  }
  const allItems = [...items, linkItem]
  const clampedHighlight = Math.min(
    highlighted,
    Math.max(allItems.length - 1, 0)
  )

  const activate = (item: MenuItem | undefined): void => {
    if (item === undefined) return
    void item.run()
    if (item.keepOpen !== true) close()
  }

  const saveLink = async (): Promise<void> => {
    const urlInput = linkUrl.trim()
    const label = linkLabel.trim()
    if (!looksLikeUrl(urlInput)) {
      setLinkError('http(s) URL을 입력해 주세요.')
      return
    }
    if (label.length === 0) {
      setLinkError('링크 이름을 입력해 주세요.')
      return
    }

    setSavingLink(true)
    setLinkError(null)
    try {
      const initialUrl = normalizeUrl(urlInput)
      await useFavoritesStore.getState().add({
        courseId: course.id,
        label,
        descriptor: descriptorFor('browser', {
          tabId: uuidv4(),
          initialUrl
        })
      })
      showToast('링크를 즐겨찾기에 추가했어요.')
      close()
    } catch (error) {
      console.error('[Bandal] 링크를 즐겨찾기에 추가하지 못했습니다.', error)
      setLinkError('링크를 저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setSavingLink(false)
    }
  }

  const style =
    anchor !== null
      ? {
          left: `clamp(var(--space-2), ${anchor.x}px, calc(100vw - var(--new-tab-menu-width) - var(--space-2)))`,
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
      {isAddingLink ? (
        <form
          className="new-tab-menu__link-form"
          aria-label="즐겨찾기 링크 추가"
          onSubmit={(event) => {
            event.preventDefault()
            void saveLink()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
        >
          <p className="new-tab-menu__form-title">링크 추가</p>
          <label>
            <span>URL</span>
            <input
              ref={linkUrlRef}
              type="text"
              inputMode="url"
              spellCheck={false}
              aria-invalid={linkError !== null}
              value={linkUrl}
              placeholder="https://youtube.com"
              onChange={(event) => {
                setLinkUrl(event.target.value)
                setLinkError(null)
              }}
            />
          </label>
          <label>
            <span>이름</span>
            <input
              type="text"
              aria-invalid={linkError !== null}
              value={linkLabel}
              placeholder="예: YouTube"
              onChange={(event) => {
                setLinkLabel(event.target.value)
                setLinkError(null)
              }}
            />
          </label>
          {linkError !== null && (
            <p className="new-tab-menu__form-error" role="alert">
              {linkError}
            </p>
          )}
          <div className="new-tab-menu__form-actions">
            <button
              type="button"
              onClick={() => {
                setAddingLink(false)
                setLinkError(null)
                window.requestAnimationFrame(() => inputRef.current?.focus())
              }}
            >
              취소
            </button>
            <button type="submit" data-primary="true" disabled={isSavingLink}>
              {isSavingLink ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      ) : (
        <>
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
                  setHighlighted((index) =>
                    Math.min(index + 1, allItems.length - 1)
                  )
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setHighlighted((index) => Math.max(index - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  activate(allItems[clampedHighlight])
                }
              }}
            />
          </div>
          <ul
            className="new-tab-menu__list"
            role="listbox"
            aria-label="새 탭 항목"
          >
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
            <li className="new-tab-menu__link-item" role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={items.length === clampedHighlight}
                data-highlighted={items.length === clampedHighlight}
                onMouseEnter={() => setHighlighted(items.length)}
                onClick={() => activate(linkItem)}
              >
                <span className="new-tab-menu__icon">{linkItem.icon}</span>
                <span className="new-tab-menu__label">{linkItem.label}</span>
                <span className="new-tab-menu__hint">{linkItem.hint}</span>
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  )
}
