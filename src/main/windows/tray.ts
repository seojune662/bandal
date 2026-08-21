import { app, Menu, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { Settings, SettingsPatch } from '../../shared/types/settings'
import { buildTrayMenu, type TrayAction } from './trayMenu'

export interface TrayDeps {
  getSettings(): Settings
  setSettings(patch: SettingsPatch): Settings
  openMain(): void
  quit(): void
}

function trayIconPath(): string {
  const name = process.platform === 'win32' ? 'tray.ico' : 'trayTemplate.png'
  return app.isPackaged
    ? join(process.resourcesPath, 'tray', name)
    : join(app.getAppPath(), 'resources', name)
}

export function installTray(deps: TrayDeps): {
  refresh(): void
  destroy(): void
} {
  let tray: Tray | null = null

  const runAction = (action: TrayAction): void => {
    switch (action) {
      case 'open':
        deps.openMain()
        break
      case 'toggleDesktopOrb': {
        const assistantMode =
          deps.getSettings().assistantMode === 'desktop' ? 'in-app' : 'desktop'
        const next = deps.setSettings({ assistantMode })
        sync(next)
        break
      }
      case 'quit':
        deps.quit()
        break
    }
  }

  const menuTemplate = (settings: Settings): MenuItemConstructorOptions[] =>
    buildTrayMenu({ desktopOrbEnabled: settings.assistantMode === 'desktop' }).map(
      (item) => {
        if (item.type === 'separator') return { type: 'separator' }
        if (item.id === undefined || item.label === undefined) {
          throw new Error('Invalid tray menu item')
        }
        const { id, label } = item
        return {
          id,
          label,
          click: () => runAction(id)
        }
      }
    )

  function destroy(): void {
    tray?.destroy()
    tray = null
  }

  function sync(settings = deps.getSettings()): void {
    if (settings.assistantMode !== 'desktop') {
      destroy()
      return
    }

    if (tray === null) {
      // Electron 35 recognizes the adjacent @2x representation from the
      // Template filename on macOS and recommends ICO for Windows trays.
      tray = new Tray(trayIconPath())
      tray.setToolTip('반달')
      if (process.platform === 'win32') tray.on('click', deps.openMain)
    }
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(settings)))
  }

  sync()
  return { refresh: sync, destroy }
}
