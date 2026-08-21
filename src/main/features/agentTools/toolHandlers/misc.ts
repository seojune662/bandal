import type { TabDescriptor } from '../../../../shared/tabs'
import {
  cancelled,
  inputObject,
  nullableStringField,
  optionalInteger,
  optionalString,
  stringField,
  type ToolContext,
  type ToolHandlerMap
} from './context'

export function miscTools(ctx: ToolContext) {
  const {
    deps,
    currentTurn,
    reserve,
    release,
    approve,
    record,
    assertCoursePath
  } = ctx

  return {
    app_state() {
      const state = deps.appState?.()
      if (state === undefined) {
        return {
          selectedCourseId: null,
          groups: [],
          courses: [],
          workspaceTabs: [],
          browserTabs: []
        }
      }
      return state
    },

    list_favorites(input) {
      return deps.favoritesRepo.list(nullableStringField(input, 'courseId'))
    },

    add_favorite(input) {
      const context = currentTurn()
      const courseId = nullableStringField(input, 'courseId')
      const favorite = deps.favoritesRepo.add({
        courseId,
        label: stringField(input, 'label', { nonEmpty: true }),
        descriptor: inputObject(input['descriptor']) as unknown as TabDescriptor
      })
      record(context, courseId ?? context.courseId, 'add_favorite', 'course', favorite.id, `즐겨찾기 «${favorite.label}»`, false)
      return favorite
    },

    rename_favorite(input) {
      const context = currentTurn()
      const favorite = deps.favoritesRepo.rename({
        id: stringField(input, 'id', { nonEmpty: true }),
        label: stringField(input, 'label', { nonEmpty: true })
      })
      record(context, favorite.courseId ?? context.courseId, 'rename_favorite', 'course', favorite.id, `즐겨찾기 «${favorite.label}»`, false)
      return favorite
    },

    async remove_favorite(input) {
      const context = currentTurn()
      const id = stringField(input, 'id', { nonEmpty: true })
      if (!await approve(
        context,
        'remove_favorite',
        `즐겨찾기 «${id}»을(를) 삭제합니다.`,
        [id]
      )) return cancelled('remove_favorite')
      deps.favoritesRepo.softDelete(id)
      record(context, context.courseId, 'remove_favorite', 'course', id, `즐겨찾기 «${id}»`, false)
      return { ok: true as const }
    },

    search_course(input) {
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const query = stringField(input, 'query', { nonEmpty: true })
      const limit = optionalInteger(input, 'limit', 1)
      return { hits: deps.searchIndex.query(courseId, query, limit) }
    },

    send_highlight_to_note(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const relPath = stringField(input, 'relPath', { nonEmpty: true })
      const noteRelPath = optionalString(input, 'noteRelPath')
      assertCoursePath(courseId, relPath)
      if (noteRelPath !== undefined) assertCoursePath(courseId, noteRelPath)
      const mayCreate = noteRelPath === undefined
      if (mayCreate) reserve('files', 1)
      let result
      try {
        result = deps.linkService.sendHighlightToNote({
          courseId,
          relPath,
          page: optionalInteger(input, 'page', 1) as number,
          quote: stringField(input, 'quote', { nonEmpty: true }),
          comment: nullableStringField(input, 'comment'),
          annotationId: stringField(input, 'annotationId', { nonEmpty: true }),
          ...(noteRelPath !== undefined ? { noteRelPath } : {})
        })
      } catch (error) {
        if (mayCreate) release('files', 1)
        throw error
      }
      if (mayCreate && !result.created) release('files', 1)
      record(context, courseId, 'send_highlight_to_note', 'note', result.relPath, `필기 «${result.relPath}»`, result.created)
      return result
    },

    send_web_clip_to_note(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const noteRelPath = optionalString(input, 'noteRelPath')
      if (noteRelPath !== undefined) assertCoursePath(courseId, noteRelPath)
      const mayCreate = noteRelPath === undefined
      if (mayCreate) reserve('files', 1)
      let result
      try {
        result = deps.linkService.sendWebClipToNote({
          courseId,
          url: stringField(input, 'url', { nonEmpty: true }),
          title: stringField(input, 'title'),
          quote: stringField(input, 'quote', { nonEmpty: true }),
          comment: nullableStringField(input, 'comment'),
          ...(noteRelPath !== undefined ? { noteRelPath } : {})
        })
      } catch (error) {
        if (mayCreate) release('files', 1)
        throw error
      }
      if (mayCreate && !result.created) release('files', 1)
      record(context, courseId, 'send_web_clip_to_note', 'note', result.relPath, `필기 «${result.relPath}»`, result.created)
      return result
    }
  } satisfies Partial<ToolHandlerMap>
}
