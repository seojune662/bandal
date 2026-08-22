import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createCourse, launchBandal } from './helpers/launch'

const FAVORITE_TAB_MIME = 'application/x-bandal-tab'

interface SyntheticDragResult {
  types: string[]
  effectAllowed: string
  customData: string
  dropDefaultPrevented: boolean
}

interface StoredFavoriteSnapshot {
  id: string
  courseId: string | null
  label: string
  descriptor: unknown
  sortOrder: number
}

interface FavoriteStateSnapshot {
  dom: {
    text: string
    rows: string[]
    html: string | null
  }
  courseId: string | null
  favorites: StoredFavoriteSnapshot[]
}

async function readFavoriteState(
  page: Page,
  courseName: string
): Promise<FavoriteStateSnapshot> {
  return page.evaluate(async (name) => {
    const region = document.querySelector('.favorites-section')
    const dom = {
      text: region?.textContent?.trim() ?? '',
      rows: [...document.querySelectorAll('.favorites-section .favorite-row')]
        .map((row) => row.textContent?.trim() ?? ''),
      html: region?.outerHTML ?? null
    }
    const bridge = (
      window as unknown as {
        bandal: {
          invoke: (channel: string, request: unknown) => Promise<unknown>
        }
      }
    ).bandal
    const courses = (await bridge.invoke('courses:list', {})) as Array<{
      id: string
      name: string
    }>
    const course = courses.find((candidate) => candidate.name === name)
    if (course === undefined) return { dom, courseId: null, favorites: [] }
    const stored = (await bridge.invoke('favorites:list', {
      courseId: course.id
    })) as StoredFavoriteSnapshot[]
    return {
      dom,
      courseId: course.id,
      favorites: stored.map(
        ({ id, courseId, label, descriptor, sortOrder }) => ({
          id,
          courseId,
          label,
          descriptor,
          sortOrder
        })
      )
    }
  }, courseName)
}

test('drags a real dockview tab into course favorites', async () => {
  const bandal = await launchBandal()
  const { page } = bandal
  let drag: SyntheticDragResult | null = null
  let immediateState: FavoriteStateSnapshot | null = null
  try {
    await createCourse(page, '드래그 과목')

    await page
      .locator('.workspace-watermark')
      .getByRole('button', { name: '새 탭 열기' })
      .click()
    await page.getByRole('option', { name: '학업 보드' }).click()

    const tab = page.locator('.dv-tab', {
      has: page.locator('.workspace-tab__title', { hasText: '학업 보드' })
    })
    const favorites = page.getByRole('region', { name: '즐겨찾기' })
    await expect(tab).toBeVisible()
    await expect(favorites).toBeVisible()
    await expect(favorites.locator('.favorite-row')).toHaveCount(0)

    // Reuse one synthetic DataTransfer from the real tab's dragstart through
    // the drop, matching the deterministic pattern used by other drop specs.
    drag = await tab.evaluate<SyntheticDragResult, string>(
      (element, mime) => {
        const dataTransfer = new DataTransfer()
        element.dispatchEvent(
          new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        )
        const types = [...dataTransfer.types]
        const effectAllowed = dataTransfer.effectAllowed
        const customData = dataTransfer.getData(mime)

        const target = document.querySelector('.favorites-section')
        if (!(target instanceof HTMLElement)) {
          throw new Error('즐겨찾기 드롭 영역을 찾지 못했습니다.')
        }
        const bounds = target.getBoundingClientRect()
        const eventInit: DragEventInit = {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          dataTransfer
        }
        target.dispatchEvent(new DragEvent('dragover', eventInit))
        const drop = new DragEvent('drop', eventInit)
        target.dispatchEvent(drop)
        element.dispatchEvent(
          new DragEvent('dragend', {
            bubbles: true,
            cancelable: true,
            dataTransfer
          })
        )

        return {
          types,
          effectAllowed,
          customData,
          dropDefaultPrevented: drop.defaultPrevented
        }
      },
      FAVORITE_TAB_MIME
    )

    immediateState = await readFavoriteState(page, '드래그 과목')
    console.log(
      'favorites drop immediate state',
      JSON.stringify({ drag, state: immediateState })
    )

    expect(drag.types).toContain(FAVORITE_TAB_MIME)
    expect(drag.customData).not.toBe('')
    expect(JSON.parse(drag.customData)).toEqual({
      descriptor: { kind: 'board', payload: {} },
      label: '학업 보드'
    })
    expect(drag.dropDefaultPrevented).toBe(true)
    await expect(
      favorites.locator('.favorite-row', { hasText: '학업 보드' })
    ).toHaveCount(1)

    // A constructed DataTransfer reports effectAllowed="none" even though
    // the dragstart handler assigned copyMove. That is a synthetic-event
    // limitation, not the product path: unlike MaterialTree file rows, tabs
    // are not promoted to a native OS drag and their custom MIME reaches this
    // HTML5 drop handler. Assert the completed DOM + persisted result instead.
    const persisted = await readFavoriteState(page, '드래그 과목')
    console.log('favorites drop settled state', JSON.stringify(persisted))
    expect(persisted.courseId).not.toBeNull()
    expect(persisted.favorites).toEqual([
      {
        id: expect.any(String),
        courseId: persisted.courseId,
        label: '학업 보드',
        descriptor: { kind: 'board', payload: {} },
        sortOrder: 0
      }
    ])
    expect(persisted.favorites[0]?.id).not.toBe('')

    // Widening the allowed operation to copyMove must preserve dockview's
    // original move behavior. Add a second tab and reorder the first one.
    await page.locator('.workspace-add-tab').click()
    await page.getByRole('option', { name: /^AI/ }).click()
    const aiTab = page.locator('.dv-tab', {
      has: page.locator('.workspace-tab__title', { hasText: 'AI 튜터' })
    })
    await expect(aiTab).toBeVisible()
    const aiBox = await aiTab.boundingBox()
    expect(aiBox).not.toBeNull()
    await tab.dragTo(aiTab, {
      targetPosition: {
        x: Math.max(1, aiBox!.width - 2),
        y: aiBox!.height / 2
      }
    })
    await expect(page.locator('.dv-tab .workspace-tab__title')).toHaveText([
      'AI 튜터',
      '학업 보드'
    ])
  } catch (error) {
    let failureState: FavoriteStateSnapshot | { captureError: string }
    try {
      failureState = await readFavoriteState(page, '드래그 과목')
    } catch (captureError) {
      failureState = { captureError: String(captureError) }
    }
    const diagnostics = {
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      drag,
      immediateState,
      failureState
    }
    console.log('favorites drop failure state', JSON.stringify(diagnostics))
    await test.info().attach('favorites-drop-state.json', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json'
    })
    throw error
  } finally {
    await bandal.close()
  }
})
