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

import { app, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { openSettingsInApp } from './windows/settingsWindow'

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
