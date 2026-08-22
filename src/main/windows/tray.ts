import {
  app,
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import type { Settings, SettingsPatch } from '../../shared/types/settings'
import { buildTrayMenu, type TrayAction } from './trayMenu'

export interface TrayDeps {
  getSettings(): Settings
  setSettings(patch: SettingsPatch): Settings
  openMain(): void
  quit(): void
}

export function resolveTrayIconPath(opts: {
  isPackaged: boolean
  resourcesPath: string
  bundleDir: string
  platform: NodeJS.Platform
}): string {
  const name = opts.platform === 'win32' ? 'tray.ico' : 'trayTemplate.png'
  return opts.isPackaged
    ? join(opts.resourcesPath, 'tray', name)
    : join(opts.bundleDir, '../../resources', name)
}

function trayIconPath(): string {
  return resolveTrayIconPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    bundleDir: __dirname,
    platform: process.platform
  })
}

export function installTray(deps: TrayDeps): {
  refresh(): void
  destroy(): void
  setIconVariant(dir: string): void
} {
  let tray: Tray | null = null
  let iconVariantDir: string | null = null

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

  function setIconVariant(dir: string): void {
    iconVariantDir = dir
    if (tray === null) return

    try {
      const image = nativeImage.createFromPath(
        join(dir, process.platform === 'win32' ? 'tray.ico' : 'trayTemplate.png')
      )
      if (process.platform !== 'win32') image.setTemplateImage(true)
      tray.setImage(image)
    } catch (error) {
      console.warn(
        '[tray] failed to update tray icon; keeping the current icon:',
        error
      )
    }
  }

  function sync(settings = deps.getSettings()): void {
    if (settings.assistantMode !== 'desktop') {
      destroy()
      return
    }

    if (tray === null) {
      // Electron 35 recognizes the adjacent @2x representation from the
      // Template filename on macOS and recommends ICO for Windows trays.
      try {
        tray = new Tray(trayIconPath())
      } catch (error) {
        console.warn('[tray] failed to load tray icon; using an empty icon:', error)
        try {
          tray = new Tray(nativeImage.createEmpty())
        } catch (fallbackError) {
          console.warn('[tray] failed to create tray; continuing without it:', fallbackError)
          tray = null
          return
        }
      }
      tray.setToolTip('반달')
      if (process.platform === 'win32') tray.on('click', deps.openMain)
      if (iconVariantDir !== null) setIconVariant(iconVariantDir)
    }
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(settings)))
  }

  sync()
  return { refresh: sync, destroy, setIconVariant }
}
