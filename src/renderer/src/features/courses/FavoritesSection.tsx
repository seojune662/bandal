import { useEffect, useId, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Favorite } from '../../../../shared/types/favorite'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import {
  favoriteScopeKey,
  useFavoritesStore
} from '../../stores/favoritesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { tabTitle } from '../workspace/tabIdentity'
import { TabKindIcon } from '../workspace/workspaceIcons'
import {
  canAcceptFavoriteDrop,
  descriptorFromDrop,
  FAVORITE_ITEM_MIME,
  FAVORITE_TAB_MIME,
  moveFavoriteBefore,
  moveFavoriteToEnd,
  serializeFavoriteTabDrag
} from './favoriteDrop'
import { buildLinkFavoriteInput } from './linkFavorite'

interface FavoritesSectionProps {
  courseId: string | null
}

export function FavoritesSection({
  courseId
}: FavoritesSectionProps): JSX.Element {
  const key = favoriteScopeKey(courseId)
  const linkFormId = useId()
  const favorites = useFavoritesStore((state) => state.byCourse[key])
  const loading = useFavoritesStore(
    (state) => state.loadingByCourse[key] === true
  )
  const error = useFavoritesStore((state) => state.error)
  const load = useFavoritesStore((state) => state.load)
  const add = useFavoritesStore((state) => state.add)
  const rename = useFavoritesStore((state) => state.rename)
  const remove = useFavoritesStore((state) => state.remove)
  const reorder = useFavoritesStore((state) => state.reorder)
  const [dragOver, setDragOver] = useState(false)
  const [isAddingLink, setAddingLink] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [isSavingLink, setSavingLink] = useState(false)
  const dragDepth = useRef(0)
  const requestedScope = useRef<string | null>(null)
  const linkUrlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (
      favorites === undefined &&
      !loading &&
      requestedScope.current !== key
    ) {
      requestedScope.current = key
      void load(courseId)
    }
  }, [courseId, favorites, key, load, loading])

  useEffect(() => {
    if (isAddingLink) linkUrlRef.current?.focus()
  }, [isAddingLink])

  const closeLinkForm = (): void => {
    setAddingLink(false)
    setLinkUrl('')
    setLinkLabel('')
    setLinkError(null)
  }

  const handleAddLink = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()

    let input
    try {
      input = buildLinkFavoriteInput(
        courseId,
        linkUrl,
        linkLabel,
        uuidv4()
      )
    } catch (validationError) {
      setLinkError(
        validationError instanceof Error
          ? validationError.message
          : '링크 정보를 확인해 주세요.'
      )
      return
    }

    setSavingLink(true)
    setLinkError(null)
    try {
      await add(input)
      showToast('링크를 즐겨찾기에 추가했어요.')
      closeLinkForm()
    } catch {
      setLinkError('링크를 저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setSavingLink(false)
    }
  }

  const saveOrder = (ids: string[]): void => {
    if (favorites?.every((favorite, index) => favorite.id === ids[index])) return
    void reorder(ids).catch(() => {
      showToast('즐겨찾기 순서를 저장하지 못했어요.', 'danger')
    })
  }

  const handleRename = (favorite: Favorite): void => {
    const next = window.prompt('즐겨찾기 이름', favorite.label)
    if (next === null || next.trim().length === 0 || next.trim() === favorite.label) {
      return
    }
    void rename({ id: favorite.id, label: next.trim() }).catch(() => {
      showToast('즐겨찾기 이름을 바꾸지 못했어요.', 'danger')
    })
  }

  const handleRemove = (favorite: Favorite): void => {
    void remove(favorite.id).catch(() => {
      showToast('즐겨찾기를 제거하지 못했어요.', 'danger')
    })
  }

  const handleDragEnter = (event: React.DragEvent<HTMLElement>): void => {
    if (!canAcceptFavoriteDrop(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLElement>): void => {
    if (!canAcceptFavoriteDrop(event.dataTransfer)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  const handleDragOver = (event: React.DragEvent<HTMLElement>): void => {
    if (!canAcceptFavoriteDrop(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
      FAVORITE_ITEM_MIME
    )
      ? 'move'
      : 'copy'
  }

  const handleDrop = (event: React.DragEvent<HTMLElement>): void => {
    if (!canAcceptFavoriteDrop(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragOver(false)

    const favoriteId = event.dataTransfer.getData(FAVORITE_ITEM_MIME)
    if (favoriteId.length > 0 && favorites !== undefined) {
      saveOrder(moveFavoriteToEnd(favorites.map((favorite) => favorite.id), favoriteId))
      return
    }

    const descriptor = descriptorFromDrop(event.dataTransfer)
    if (descriptor === null) {
      showToast('이 항목은 즐겨찾기에 추가할 수 없어요.', 'danger')
      return
    }
    void add({ courseId, label: tabTitle(descriptor), descriptor })
      .then(() => showToast('즐겨찾기에 추가했어요.'))
      .catch(() => showToast('즐겨찾기를 추가하지 못했어요.', 'danger'))
  }

  return (
    <section
      className="favorites-section"
      data-drag-over={dragOver || undefined}
      aria-label="즐겨찾기"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="favorites-section__heading">
        <span>즐겨찾기</span>
        <button
          type="button"
          className="favorites-section__add-link"
          aria-expanded={isAddingLink}
          disabled={isSavingLink}
          onClick={() => {
            if (isAddingLink) closeLinkForm()
            else {
              setLinkError(null)
              setAddingLink(true)
            }
          }}
        >
          <Icon name="link" />
          링크 추가
        </button>
      </div>

      {isAddingLink && (
        <form
          className="favorite-link-form"
          onSubmit={(event) => void handleAddLink(event)}
        >
          <label htmlFor={`${linkFormId}-url`}>URL</label>
          <input
            ref={linkUrlRef}
            id={`${linkFormId}-url`}
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.com"
            value={linkUrl}
            disabled={isSavingLink}
            onChange={(event) => setLinkUrl(event.target.value)}
          />
          <label htmlFor={`${linkFormId}-label`}>이름</label>
          <input
            id={`${linkFormId}-label`}
            type="text"
            autoComplete="off"
            placeholder="강의실"
            value={linkLabel}
            disabled={isSavingLink}
            onChange={(event) => setLinkLabel(event.target.value)}
          />
          {linkError !== null && (
            <p className="favorite-link-form__error" role="alert">
              {linkError}
            </p>
          )}
          <div className="favorite-link-form__actions">
            <button type="button" disabled={isSavingLink} onClick={closeLinkForm}>
              취소
            </button>
            <button type="submit" disabled={isSavingLink}>
              {isSavingLink ? '추가 중…' : '추가'}
            </button>
          </div>
        </form>
      )}

      {!isAddingLink && (
        <p className="favorites-section__drop-copy" aria-hidden="true">
          {dragOver ? '여기에 놓아 추가' : '탭을 끌어다 놓아도 추가할 수 있어요'}
        </p>
      )}

      {loading && favorites === undefined ? (
        <p className="favorites-section__status">불러오는 중…</p>
      ) : favorites !== undefined && favorites.length > 0 ? (
        <ul className="favorites-list">
          {favorites.map((favorite) => (
            <li
              key={favorite.id}
              className="favorite-row"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copyMove'
                event.dataTransfer.setData(FAVORITE_ITEM_MIME, favorite.id)
                event.dataTransfer.setData(
                  FAVORITE_TAB_MIME,
                  serializeFavoriteTabDrag(favorite.descriptor)
                )
              }}
              onDragEnd={() => {
                dragDepth.current = 0
                setDragOver(false)
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(FAVORITE_ITEM_MIME)) return
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                const sourceId = event.dataTransfer.getData(FAVORITE_ITEM_MIME)
                if (sourceId.length === 0) return
                event.preventDefault()
                event.stopPropagation()
                dragDepth.current = 0
                setDragOver(false)
                saveOrder(
                  moveFavoriteBefore(
                    favorites.map((item) => item.id),
                    sourceId,
                    favorite.id
                  )
                )
              }}
            >
              <button
                type="button"
                className="favorite-row__open"
                title={favorite.label}
                onClick={() =>
                  useWorkspaceStore.getState().openTab(favorite.descriptor)
                }
              >
                <TabKindIcon kind={favorite.descriptor.kind} />
                <span>{favorite.label}</span>
              </button>
              <div className="favorite-row__actions">
                <button
                  type="button"
                  aria-label={`${favorite.label} 이름 변경`}
                  title="이름 변경"
                  onClick={() => handleRename(favorite)}
                >
                  <Icon name="pencil" />
                </button>
                <button
                  type="button"
                  aria-label={`${favorite.label} 즐겨찾기 제거`}
                  title="즐겨찾기 제거"
                  onClick={() => handleRemove(favorite)}
                >
                  <Icon name="x" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="favorites-section__empty">
          {dragOver ? '여기에 놓으면 즐겨찾기에 추가돼요' : '고정한 탭이 없어요'}
        </p>
      )}

      {error !== null && (
        <p className="favorites-section__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
