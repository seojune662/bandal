import type { SettingsCatalogEntry } from '../catalogTypes'

export const SYNC_ENTRIES = [
  { id: 'sync.connect', category: 'sync', title: 'settings.sync.connect.title', description: 'settings.sync.connect.description', keywords: ['iCloud', 'Google Drive', 'iPad', '아이패드', '아이클라우드', '구글 드라이브'] },
  { id: 'sync.connect.storage', category: 'sync', group: 'sync.connect', title: 'settings.sync.connect.storage', description: 'settings.sync.connect.storageDescription', keywords: ['iCloud', 'Google Drive', 'provider'] },
  { id: 'sync.connect.google', category: 'sync', group: 'sync.connect', title: 'settings.sync.google.label', description: 'settings.sync.google.description', keywords: ['Google', 'Gmail', '구글', 'sign in', '로그인'] },
  { id: 'sync.connect.start', category: 'sync', group: 'sync.connect', title: 'settings.sync.connect.start', description: 'settings.sync.connect.startDescription', keywords: ['connect', '연결', '합치기', 'merge', 'overwrite', '덮어쓰기'] },
  { id: 'sync.status', category: 'sync', title: 'settings.sync.status.title', description: 'settings.sync.status.description', keywords: ['status', '상태'] },
  { id: 'sync.status.now', category: 'sync', group: 'sync.status', title: 'settings.sync.status.now', description: 'settings.sync.status.nowDescription', keywords: ['sync now', 'refresh', '새로고침'] },
  { id: 'sync.move', category: 'sync', title: 'settings.sync.move.title', description: 'settings.sync.move.groupDescription', keywords: ['migrate', 'switch storage', '이전', '저장소 변경'] },
  { id: 'sync.move.start', category: 'sync', group: 'sync.move', title: 'settings.sync.move.start', description: 'settings.sync.move.groupDescription', keywords: ['iCloud', 'Google Drive'] },
  { id: 'sync.devices', category: 'sync', title: 'settings.sync.devices.title', description: 'settings.sync.devices.description', keywords: ['devices', 'iPad', 'Mac'] },
  { id: 'sync.devices.name', category: 'sync', group: 'sync.devices', title: 'settings.sync.devices.name', description: 'settings.sync.devices.nameDescription', keywords: ['device name', 'rename', '이름 변경', '컴퓨터 이름'] },
  { id: 'sync.advanced', category: 'sync', title: 'settings.sync.advanced.title', description: 'settings.sync.advanced.description', keywords: ['advanced'] },
  { id: 'sync.advanced.disconnect', category: 'sync', group: 'sync.advanced', title: 'settings.sync.disconnect.label', description: 'settings.sync.disconnect.catalogDescription', keywords: ['disconnect', 'turn off', 'unlink', '끄기', '해제'] }
] as const satisfies readonly SettingsCatalogEntry[]
