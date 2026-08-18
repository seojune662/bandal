import { editorViewCtx, type Editor } from '@milkdown/core'
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  updateCodeBlockLanguageCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from '@milkdown/preset-commonmark'
import {
  insertTableCommand,
  toggleStrikethroughCommand
} from '@milkdown/preset-gfm'
import { useInstance } from '@milkdown/react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { callCommand } from '@milkdown/utils'
import { insertNoteImageFiles } from './noteImagePlugin'
import type { NoteFormatState } from './noteFormatting'
import { toggleTaskListItems } from './noteFormatting'
import {
  NOTE_FONT_SCALES,
  type NoteFontScale
} from './noteZoom'
import {
  NOTE_SLASH_TOOLBAR_ACTION_EVENT,
  type NoteSlashToolbarAction
} from './slashMenuPlugin'

interface FormatButtonProps {
  active: boolean
  disabled?: boolean
  label: string
  text: string
  onClick: () => void
  className?: string | undefined
}

function keepEditorFocused(event: ReactMouseEvent<HTMLButtonElement>): void {
  event.preventDefault()
}

function FormatButton({
  active,
  disabled = false,
  label,
  text,
  onClick,
  className = ''
}: FormatButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`note-format-button ${className}`.trim()}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={keepEditorFocused}
      onClick={onClick}
    >
      {text}
    </button>
  )
}

export interface NoteToolbarProps {
  courseId: string
  formatState: NoteFormatState
  fontScale: NoteFontScale
  onFontScaleChange: (scale: NoteFontScale) => void
}

export function NoteToolbar({
  courseId,
  formatState,
  fontScale,
  onFontScaleChange
}: NoteToolbarProps): JSX.Element {
  const [loading, getEditor] = useInstance()
  const [moreOpen, setMoreOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('https://')
  const linkInputId = useId()
  const moreRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLDivElement>(null)
  const linkPopoverRef = useRef<HTMLFormElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const run = useCallback(
    (action: (editor: Editor) => void): void => {
      const editor = getEditor()
      if (editor === undefined) return
      action(editor)
      editor.action((context) => context.get(editorViewCtx).focus())
    },
    [getEditor]
  )

  useEffect(() => {
    if (!moreOpen && !linkOpen) return
    const closeOutside = (event: MouseEvent): void => {
      if (
        event.target instanceof Node &&
        (moreRef.current?.contains(event.target) === true ||
          linkRef.current?.contains(event.target) === true ||
          linkPopoverRef.current?.contains(event.target) === true)
      ) {
        return
      }
      setMoreOpen(false)
      setLinkOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMoreOpen(false)
      setLinkOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [linkOpen, moreOpen])

  useEffect(() => {
    if (loading) return
    const editor = getEditor()
    if (editor === undefined) return

    let editorDom: HTMLElement | undefined
    const handleSlashAction = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const action = event.detail as NoteSlashToolbarAction
      if (action === 'link') {
        setMoreOpen(false)
        setLinkHref('https://')
        setLinkOpen(true)
      } else if (action === 'image') {
        imageInputRef.current?.click()
      }
    }
    editor.action((context) => {
      editorDom = context.get(editorViewCtx).dom
      editorDom.addEventListener(
        NOTE_SLASH_TOOLBAR_ACTION_EVENT,
        handleSlashAction
      )
    })
    return () => {
      editorDom?.removeEventListener(
        NOTE_SLASH_TOOLBAR_ACTION_EVENT,
        handleSlashAction
      )
    }
  }, [getEditor, loading])

  const toggleTaskList = (): void => {
    run((editor) => {
      editor.action((context) => {
        const view = context.get(editorViewCtx)
        if (toggleTaskListItems(view)) return
        if (callCommand(wrapInBulletListCommand.key)(context)) {
          toggleTaskListItems(context.get(editorViewCtx))
        }
      })
    })
  }

  const toggleLink = (): void => {
    if (formatState.link) {
      run((editor) => editor.action(callCommand(toggleLinkCommand.key)))
      setLinkOpen(false)
      return
    }
    setMoreOpen(false)
    setLinkHref(formatState.linkHref ?? 'https://')
    setLinkOpen((open) => !open)
  }

  const confirmLink = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const href = linkHref.trim()
    if (href.length === 0) return
    run((editor) =>
      editor.action(callCommand(toggleLinkCommand.key, { href }))
    )
    setLinkOpen(false)
  }

  const chooseImage = (): void => {
    imageInputRef.current?.click()
  }

  const insertSelectedImages = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    if (files.length === 0) return
    run((editor) => {
      editor.action((context) => {
        void insertNoteImageFiles(
          context.get(editorViewCtx),
          courseId,
          files
        )
      })
    })
  }

  const updateCodeLanguage = (language: string): void => {
    if (formatState.codeBlockPosition === null) return
    run((editor) => {
      editor.action(
        callCommand(updateCodeBlockLanguageCommand.key, {
          pos: formatState.codeBlockPosition,
          language
        })
      )
    })
  }

  const commandButton = (
    label: string,
    text: string,
    active: boolean,
    action: (editor: Editor) => void,
    className?: string
  ): JSX.Element => (
    <FormatButton
      key={label}
      active={active}
      label={label}
      text={text}
      disabled={loading}
      className={className}
      onClick={() => run(action)}
    />
  )

  return (
    <div className="note-format-bar" role="toolbar" aria-label="마크다운 서식">
      <div className="note-format-bar__scroll">
        <div className="note-format-group">
          {commandButton('본문', '¶', formatState.paragraph, (editor) =>
            editor.action(callCommand(turnIntoTextCommand.key))
          )}
        </div>
        <div className="note-format-group">
          {[1, 2, 3].map((level) =>
            commandButton(
              `제목 ${level}`,
              `H${level}`,
              formatState.headingLevel === level,
              (editor) =>
                editor.action(callCommand(wrapInHeadingCommand.key, level))
            )
          )}
        </div>
        <div className="note-format-group">
          {commandButton(
            '굵게',
            'B',
            formatState.strong,
            (editor) => editor.action(callCommand(toggleStrongCommand.key)),
            'note-format-button--strong'
          )}
          {commandButton(
            '기울임',
            'I',
            formatState.emphasis,
            (editor) => editor.action(callCommand(toggleEmphasisCommand.key)),
            'note-format-button--emphasis'
          )}
          {commandButton(
            '취소선',
            'S',
            formatState.strikethrough,
            (editor) =>
              editor.action(callCommand(toggleStrikethroughCommand.key)),
            'note-format-button--strike'
          )}
        </div>
        <div className="note-format-group">
          {commandButton('글머리 목록', '•≡', formatState.bulletList, (editor) =>
            editor.action(callCommand(wrapInBulletListCommand.key))
          )}
          {commandButton('번호 목록', '1.', formatState.orderedList, (editor) =>
            editor.action(callCommand(wrapInOrderedListCommand.key))
          )}
          <FormatButton
            active={formatState.taskList}
            label="할 일 목록"
            text="☑"
            disabled={loading}
            onClick={toggleTaskList}
          />
        </div>
        <div className="note-format-group">
          {commandButton('인용', '❝', formatState.blockquote, (editor) =>
            editor.action(callCommand(wrapInBlockquoteCommand.key))
          )}
          <div className="note-format-link" ref={linkRef}>
            <FormatButton
              active={formatState.link || linkOpen}
              label={formatState.link ? '링크 해제' : '링크'}
              text="↗"
              disabled={loading}
              onClick={toggleLink}
            />
          </div>
          <FormatButton
            active={false}
            label="이미지"
            text="▧"
            disabled={loading}
            onClick={chooseImage}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,.avif,.bmp,.gif,.jpeg,.jpg,.png,.svg,.webp"
            multiple
            hidden
            onChange={insertSelectedImages}
          />
          {commandButton(
            '인라인 코드',
            '<>',
            formatState.inlineCode,
            (editor) =>
              editor.action(callCommand(toggleInlineCodeCommand.key)),
            'note-format-button--code'
          )}
          {commandButton(
            '코드 블록',
            '{}',
            formatState.codeBlockPosition !== null,
            (editor) =>
              editor.action(callCommand(createCodeBlockCommand.key)),
            'note-format-button--code'
          )}
        </div>
      </div>

      {linkOpen && (
        <form
          ref={linkPopoverRef}
          className="note-link-popover"
          onSubmit={confirmLink}
        >
          <label htmlFor={linkInputId}>링크 주소</label>
          <div className="note-link-popover__row">
            <input
              id={linkInputId}
              type="url"
              inputMode="url"
              autoFocus
              value={linkHref}
              placeholder="https://example.com"
              onChange={(event) => setLinkHref(event.target.value)}
            />
            <button type="submit" disabled={linkHref.trim().length === 0}>
              확인
            </button>
          </div>
        </form>
      )}

      <div className="note-format-more" ref={moreRef}>
        <FormatButton
          active={moreOpen}
          label="더 많은 서식"
          text="…"
          disabled={loading}
          onClick={() => setMoreOpen((open) => !open)}
        />
        {moreOpen && (
          <div className="note-format-more__menu" role="menu">
            <button
              type="button"
              className="note-format-menu-button"
              role="menuitem"
              onMouseDown={keepEditorFocused}
              onClick={() => {
                run((editor) => editor.action(callCommand(insertHrCommand.key)))
                setMoreOpen(false)
              }}
            >
              구분선
            </button>
            <button
              type="button"
              className="note-format-menu-button"
              role="menuitem"
              onMouseDown={keepEditorFocused}
              onClick={() => {
                run((editor) =>
                  editor.action(
                    callCommand(insertTableCommand.key, { row: 3, col: 3 })
                  )
                )
                setMoreOpen(false)
              }}
            >
              표 삽입
            </button>

            <label className="note-format-menu-field">
              <span>코드 블록 언어</span>
              <select
                disabled={formatState.codeBlockPosition === null}
                value={
                  formatState.codeBlockPosition === null
                    ? '__none__'
                    : formatState.codeBlockLanguage
                }
                onChange={(event) => updateCodeLanguage(event.target.value)}
              >
                <option value="__none__" disabled>
                  코드 블록 안에서 선택
                </option>
                <option value="">언어 없음</option>
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="bash">Bash</option>
                <option value="json">JSON</option>
              </select>
            </label>

            <fieldset className="note-format-scale">
              <legend>에디터 글자 크기</legend>
              <div className="note-format-scale__options">
                {NOTE_FONT_SCALES.map((scale) => (
                  <button
                    type="button"
                    className="note-format-scale__option"
                    data-active={scale === fontScale}
                    aria-pressed={scale === fontScale}
                    key={scale}
                    onMouseDown={keepEditorFocused}
                    onClick={() => onFontScaleChange(scale)}
                  >
                    {Math.round(scale * 100)}%
                  </button>
                ))}
              </div>
              <span className="note-format-scale__hint">⌘+ / ⌘−</span>
            </fieldset>
          </div>
        )}
      </div>
    </div>
  )
}
