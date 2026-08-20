/**
 * [M6-A] Application menu.
 *
 * Exists mostly so the DEFAULT macOS menu does not: the default File menu
 * binds ⌘W to "Close Window", which swallows the chord at the menu layer —
 * the renderer would never see it. Bandal treats ⌘W as "close active tab"
 * (renderer keydown, src/renderer/src/app/shortcuts.ts), so here:
 *  - window close moves to ⇧⌘W,
 *  - 설정… gets the standard ⌘, slot,
 *  - Edit/View/Window keep their roles (copy/paste/reload/minimize).
 */

import { app, BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { openSettingsInApp } from './windows/settingsWindow'

const PRINT_MENU_ITEM_ID = 'print'

function requestPrint(): void {
  const target =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (target === undefined || target.isDestroyed()) return
  target.webContents.send('ui:print', {})
}

/**
 * Turns 파일 ▸ 인쇄… on and off as the active tab changes.
 *
 * This is not decoration — it is how ⌘P means two things. A macOS menu
 * accelerator is consumed by `performKeyEquivalent:` before the event reaches
 * the window, so as long as the item is ENABLED it owns ⌘P. A DISABLED item
 * does not perform its key equivalent, and the event falls through the
 * responder chain to the renderer, where ⌘P is still 빠른 파일 검색.
 *
 * Mutates the live item rather than rebuilding the menu: rebuilding on every
 * tab change would drop open submenus and re-register every accelerator.
 */
export function setPrintMenuEnabled(enabled: boolean): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById(PRINT_MENU_ITEM_ID)
  if (item === null || item === undefined) return
  item.enabled = enabled
}

export function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'Bandal',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: '설정…',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  openSettingsInApp()
                }
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: '파일',
      submenu: [
        // Starts disabled: nothing is printable until a browser or PDF tab is
        // focused, and while it is disabled ⌘P falls through to the renderer
        // as 빠른 파일 검색. See setPrintMenuEnabled above.
        {
          id: PRINT_MENU_ITEM_ID,
          label: '인쇄…',
          accelerator: 'CmdOrCtrl+P',
          enabled: false,
          click: requestPrint
        },
        { type: 'separator' },
        // ⌘W is deliberately NOT bound here — the renderer uses it to close
        // the active workspace tab. Window close lives on ⇧⌘W instead.
        { label: '창 닫기', accelerator: 'Shift+CmdOrCtrl+W', role: 'close' }
      ]
    },
    { label: '편집', role: 'editMenu' },
    { label: '보기', role: 'viewMenu' },
    { label: '윈도우', role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
