import { expect, test } from 'vitest'
import { buildTrayMenu } from '../../../src/main/windows/trayMenu'
test('tray has only restore and quit, independent of PiP', () => {
  expect(buildTrayMenu()).toEqual([{ id: 'open', label: '반달 열기' }, { type: 'separator' }, { id: 'quit', label: '종료' }])
})
