import { expect, test } from '@playwright/test'
import { createCourse, launchBandal } from './helpers/launch'

const FAVORITE_TAB_MIME = 'application/x-bandal-tab'

interface DragSnapshot {
  types: string[]
  effectAllowed: string
  dropEffect: string
  defaultPrevented: boolean
  customData: string
}

interface DragDiagnostics {
  dragstart: DragSnapshot | null
  dragover: DragSnapshot[]
  drop: DragSnapshot | null
}

test('drags a real dockview tab into course favorites', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
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

    await page.evaluate((mime) => {
      type DiagnosticWindow = Window & {
        __favoriteDragDiagnostics?: DragDiagnostics
      }
      const diagnosticWindow = window as DiagnosticWindow
      diagnosticWindow.__favoriteDragDiagnostics = {
        dragstart: null,
        dragover: [],
        drop: null
      }

      const snapshot = (event: DragEvent): DragSnapshot | null => {
        if (event.dataTransfer === null) return null
        return {
          types: [...event.dataTransfer.types],
          effectAllowed: event.dataTransfer.effectAllowed,
          dropEffect: event.dataTransfer.dropEffect,
          defaultPrevented: event.defaultPrevented,
          customData: event.dataTransfer.getData(mime)
        }
      }

      document.addEventListener('dragstart', (event) => {
        diagnosticWindow.__favoriteDragDiagnostics!.dragstart = snapshot(event)
      })
      document.addEventListener('dragover', (event) => {
        const target = event.target
        if (
          !(target instanceof Element) ||
          target.closest('.favorites-section') === null
        ) {
          return
        }
        const value = snapshot(event)
        if (value !== null) {
          diagnosticWindow.__favoriteDragDiagnostics!.dragover.push(value)
        }
      })
      document.addEventListener('drop', (event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('.favorites-section') !== null
        ) {
          diagnosticWindow.__favoriteDragDiagnostics!.drop = snapshot(event)
        }
      })
    }, FAVORITE_TAB_MIME)

    // This goes through Chromium's native HTML5 DnD path. In particular,
    // Chromium decides whether a drop is legal from effectAllowed/dropEffect;
    // manually dispatching `drop` would bypass that decision.
    await tab.dragTo(favorites)

    const diagnostics = await page.evaluate(() => {
      return (
        window as Window & {
          __favoriteDragDiagnostics?: DragDiagnostics
        }
      ).__favoriteDragDiagnostics
    })
    console.info('favorites drag diagnostics', JSON.stringify(diagnostics))

    expect(diagnostics?.dragstart?.types).toContain(FAVORITE_TAB_MIME)
    expect(diagnostics?.dragstart?.effectAllowed).toBe('copyMove')
    expect(diagnostics?.dragstart?.customData).not.toBe('')
    expect(diagnostics?.dragover.length).toBeGreaterThan(0)
    expect(diagnostics?.dragover.some((event) => event.defaultPrevented)).toBe(
      true
    )
    expect(
      diagnostics?.dragover.some((event) => event.dropEffect === 'copy')
    ).toBe(true)
    expect(diagnostics?.drop).not.toBeNull()
    expect(diagnostics?.drop?.customData).not.toBe('')
    await expect(
      favorites.locator('.favorite-row', { hasText: '학업 보드' })
    ).toHaveCount(1)

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
  } finally {
    await bandal.close()
  }
})
