export interface TrayMenuModel {
  desktopOrbEnabled: boolean
}

export type TrayAction = 'open' | 'toggleDesktopOrb' | 'quit'

export interface TrayMenuItem {
  id?: TrayAction
  label?: string
  type?: 'separator'
}

export function buildTrayMenu(model: TrayMenuModel): TrayMenuItem[] {
  return [
    { id: 'open', label: '반달 열기' },
    { type: 'separator' },
    {
      id: 'toggleDesktopOrb',
      label: model.desktopOrbEnabled
        ? '데스크톱 오브 끄기'
        : '데스크톱 오브 켜기'
    },
    { type: 'separator' },
    { id: 'quit', label: '종료' }
  ]
}
