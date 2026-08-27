import { beforeEach, describe, expect, test, vi } from 'vitest'

const menuMocks = vi.hoisted(() => ({
  applicationMenu: null as null | {
    template: any[]
    getMenuItemById: (id: string) => any
  },
  buildFromTemplate: vi.fn(),
  setApplicationMenu: vi.fn()
}))

function findById(items: any[], id: string): any {
  for (const item of items) {
    if (item.id === id) return item
    if (Array.isArray(item.submenu)) {
      const nested = findById(item.submenu, id)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

vi.mock('electron', () => {
  menuMocks.buildFromTemplate.mockImplementation((template: any[]) => ({
    template,
    getMenuItemById: (id: string) => findById(template, id)
  }))
  menuMocks.setApplicationMenu.mockImplementation((menu) => {
    menuMocks.applicationMenu = menu
  })
  return {
    app: {},
    BrowserWindow: {
      getFocusedWindow: vi.fn(() => null),
      getAllWindows: vi.fn(() => [])
    },
    Menu: {
      buildFromTemplate: menuMocks.buildFromTemplate,
      setApplicationMenu: menuMocks.setApplicationMenu,
      getApplicationMenu: () => menuMocks.applicationMenu
    }
  }
})

vi.mock('../../src/main/windows/settingsWindow', () => ({
  openSettingsInApp: vi.fn()
}))

import { resolveKeymap } from '../../src/shared/keymap'
import {
  electronAcceleratorForChord,
  installApplicationMenu,
  setPrintMenuEnabled
} from '../../src/main/menu'

function latestTemplate(): any[] {
  const call = menuMocks.buildFromTemplate.mock.calls.at(-1)
  if (call === undefined) throw new Error('menu was not built')
  return call[0] as any[]
}

describe('application menu keymap', () => {
  beforeEach(() => {
    setPrintMenuEnabled(false)
    menuMocks.applicationMenu = null
    vi.clearAllMocks()
  })

  test('converts shared chords to Electron accelerator syntax', () => {
    expect(electronAcceleratorForChord('mod+alt+shift+k')).toBe(
      'CmdOrCtrl+Alt+Shift+K'
    )
    expect(electronAcceleratorForChord(null)).toBeUndefined()
  })

  test('uses resolved settings and print chords', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    try {
      installApplicationMenu(
        resolveKeymap({
          settings: 'mod+alt+s',
          'quick-search': 'mod+shift+p'
        })
      )

      const template = latestTemplate()
      const appMenu = template.find((item) => item.label === 'Bandal')
      const settings = appMenu.submenu.find(
        (item: any) => item.label === '설정…'
      )
      const fileMenu = template.find((item) => item.label === '파일')
      const print = fileMenu.submenu.find((item: any) => item.id === 'print')
      expect(settings.accelerator).toBe('CmdOrCtrl+Alt+S')
      expect(print.accelerator).toBe('CmdOrCtrl+Shift+P')
    } finally {
      platform.mockRestore()
    }
  })

  test('preserves live print enabled state across safe reinstalls', () => {
    installApplicationMenu(resolveKeymap({}))
    setPrintMenuEnabled(true)
    installApplicationMenu(resolveKeymap({ 'quick-search': 'mod+alt+p' }))

    const fileMenu = latestTemplate().find((item) => item.label === '파일')
    const print = fileMenu.submenu.find((item: any) => item.id === 'print')
    expect(print.enabled).toBe(true)
    expect(print.accelerator).toBe('CmdOrCtrl+Alt+P')
  })
})
