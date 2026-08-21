import { describe, expect, test } from 'vitest'
import { buildTrayMenu } from '../../../src/main/windows/trayMenu'

describe('buildTrayMenu', () => {
  test.each([
    [true, '데스크톱 오브 끄기'],
    [false, '데스크톱 오브 켜기']
  ])('uses the mode label and fixed item order', (desktopOrbEnabled, label) => {
    expect(buildTrayMenu({ desktopOrbEnabled })).toEqual([
      { id: 'open', label: '반달 열기' },
      { type: 'separator' },
      { id: 'toggleDesktopOrb', label },
      { type: 'separator' },
      { id: 'quit', label: '종료' }
    ])
  })
})
