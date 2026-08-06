import { editorViewCtx, type Editor } from '@milkdown/core'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
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
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { callCommand } from '@milkdown/utils'
import type { NoteFormatState } from './noteFormatting'
import { toggleTaskListItems } from './noteFormatting'
import {
  NOTE_FONT_SCALES,
  type NoteFontScale
} from './noteZoom'

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
  formatState: NoteFormatState
  fontScale: NoteFontScale
  onFontScaleChange: (scale: NoteFontScale) => void
}

export function NoteToolbar({
  formatState,
  fontScale,
  onFontScaleChange
}: NoteToolbarProps): JSX.Element {
  const [loading, getEditor] = useInstance()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

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
    if (!moreOpen) return
    const closeOutside = (event: MouseEvent): void => {
      if (
        event.target instanceof Node &&
        moreRef.current?.contains(event.target)
      ) {
        return
      }
      setMoreOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [moreOpen])

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
      return
    }

    const href = window.prompt('링크 주소', formatState.linkHref ?? 'https://')
    if (href === null || href.trim().length === 0) return
    run((editor) =>
      editor.action(callCommand(toggleLinkCommand.key, { href: href.trim() }))
    )
  }

  const insertImage = (): void => {
    const src = window.prompt('이미지 주소', 'https://')
    if (src === null || src.trim().length === 0) return
    const alt = window.prompt('이미지 설명', '') ?? ''
    run((editor) =>
      editor.action(
        callCommand(insertImageCommand.key, { src: src.trim(), alt: alt.trim() })
      )
    )
  }

  const updateCodeLanguage = (language: string): void => {
    run((editor) => {
      if (formatState.codeBlockPosition === null) {
        editor.action(callCommand(createCodeBlockCommand.key, language))
        return
      }
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
          <FormatButton
            active={formatState.link}
            label="링크"
            text="↗"
            disabled={loading}
            onClick={toggleLink}
          />
          <FormatButton
            active={false}
            label="이미지"
            text="▧"
            disabled={loading}
            onClick={insertImage}
          />
          {commandButton(
            '인라인 코드',
            '<>',
            formatState.inlineCode,
            (editor) =>
              editor.action(callCommand(toggleInlineCodeCommand.key)),
            'note-format-button--code'
          )}
        </div>
      </div>

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
                value={
                  formatState.codeBlockPosition === null
                    ? '__none__'
                    : formatState.codeBlockLanguage
                }
                onChange={(event) => updateCodeLanguage(event.target.value)}
              >
                <option value="__none__" disabled>
                  코드 블록 만들기…
                </option>
                <option value="">자동 감지</option>
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
