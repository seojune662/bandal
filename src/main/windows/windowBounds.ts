/**
 * 창 크기·위치 영속 (backlog 11.2). settings.json 과 분리한 이유:
 * bounds 는 resize/move 마다 갱신되는 고빈도 값이라 settings:changed
 * 브로드캐스트를 타면 렌더러가 불필요하게 깨어난다.
 */

import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const STATE_FILE = 'window-state.json'
const SAVE_DEBOUNCE_MS = 500
/** 저장된 창이 최소 이만큼은 어느 디스플레이 안에 보여야 복원한다. */
const MIN_VISIBLE_PX = 100

export interface WindowState {
  bounds: Rectangle | null
  maximized: boolean
}

function statePath(): string {
  return join(app.getPath('userData'), STATE_FILE)
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeBounds(raw: unknown): Rectangle | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { x, y, width, height } = raw as Record<string, unknown>
  if (!isFiniteInt(x) || !isFiniteInt(y) || !isFiniteInt(width) || !isFiniteInt(height)) {
    return null
  }
  if (width < 200 || height < 200) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** 모니터 구성이 바뀌어 창이 화면 밖에 뜨는 걸 막는다. */
function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapY =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX
  })
}

export function readWindowState(): WindowState {
  try {
    const raw: unknown = JSON.parse(readFileSync(statePath(), 'utf8'))
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const bounds = sanitizeBounds(record['bounds'])
    return {
      bounds: bounds !== null && isVisibleOnSomeDisplay(bounds) ? bounds : null,
      maximized: record['maximized'] === true
    }
  } catch {
    return { bounds: null, maximized: false }
  }
}

function persist(state: WindowState): void {
  try {
    const file = statePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.error('[window] failed to persist window state:', error)
  }
}

/** resize/move 를 디바운스 저장하고 close 시점에 확정 저장한다. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const snapshot = (): WindowState => ({
    // getNormalBounds: 최대화 상태에서도 "복원될" 크기를 기억한다.
    bounds: win.getNormalBounds(),
    maximized: win.isMaximized()
  })

  const scheduleSave = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!win.isDestroyed()) persist(snapshot())
    }, SAVE_DEBOUNCE_MS)
  }

  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('close', () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!win.isDestroyed()) persist(snapshot())
  })
}
