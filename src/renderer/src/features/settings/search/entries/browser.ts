import type { SettingsCatalogEntry } from '../catalogTypes'

export const BROWSER_ENTRIES = [
  { id: 'browser.general', category: 'browser', title: 'settings.browser.general.title', description: 'settings.browser.general.description' },
  { id: 'browser.general.homePage', category: 'browser', group: 'browser.general', title: 'settings.browser.homePage.title', description: 'settings.browser.homePage.description', keywords: ['home page', 'start page', 'homepage', '시작 페이지', 'URL'] },
  { id: 'browser.general.searchEngine', category: 'browser', group: 'browser.general', title: 'settings.browser.search.label', description: 'settings.browser.search.description', keywords: ['search engine', 'Google', 'Naver', 'Daum', 'DuckDuckGo', '구글', '네이버', '다음', '덕덕고'] },
  { id: 'browser.general.zoom', category: 'browser', group: 'browser.general', title: 'settings.browser.zoom.title', description: 'settings.browser.zoom.description', keywords: ['zoom', 'page size', '확대', '배율', '페이지 크기'] },
  { id: 'browser.general.swipe', category: 'browser', group: 'browser.general', title: 'settings.browser.swipe.label', description: 'settings.browser.swipe.description', keywords: ['swipe', 'gesture', 'trackpad', 'back', 'forward', '스와이프', '제스처', '뒤로'] },
  { id: 'browser.links', category: 'browser', title: 'settings.browser.links.title', description: 'settings.browser.links.description' },
  { id: 'browser.links.routing', category: 'browser', group: 'browser.links', title: 'settings.browser.links.routing', description: 'settings.browser.links.routingDescription', keywords: ['link', 'external browser', 'default browser', 'Safari', 'Chrome', '외부 브라우저'] },
  { id: 'browser.links.popups', category: 'browser', group: 'browser.links', title: 'settings.browser.popups.title', description: 'settings.browser.popups.description', keywords: ['popup', 'pop-up', 'window', '새 창'] },
  { id: 'browser.privacy', category: 'browser', title: 'settings.browser.protection.title', description: 'settings.browser.protection.description' },
  { id: 'browser.privacy.tracking', category: 'browser', group: 'browser.privacy', title: 'settings.browser.tracking.label', description: 'settings.browser.tracking.description', keywords: ['tracker', 'tracking', 'ad block', '광고', '트래커'] },
  { id: 'browser.privacy.dnt', category: 'browser', group: 'browser.privacy', title: 'settings.browser.dnt.label', description: 'settings.browser.dnt.description', keywords: ['DNT', 'GPC', 'Do Not Track', 'Global Privacy Control'] },
  { id: 'browser.profile', category: 'browser', title: 'settings.browser.profile.title', description: 'settings.browser.profile.description' },
  { id: 'browser.profile.select', category: 'browser', group: 'browser.profile', title: 'settings.browser.profile.select', description: 'settings.browser.profile.selectDescription', keywords: ['profile', '프로필'] },
  { id: 'browser.extensions', category: 'browser', title: 'settings.browser.extensions.title', description: 'settings.browser.extensions.description' },
  { id: 'browser.extensions.add', category: 'browser', group: 'browser.extensions', title: 'settings.browser.extensions.addRow', description: 'settings.browser.extensions.addRowDescription', keywords: ['extension', 'add-on', 'Chrome extension', 'MV3', '확장 프로그램', '애드온'] },
  { id: 'browser.import', category: 'browser', title: 'settings.browser.import.title', description: 'settings.browser.import.groupDescription' },
  { id: 'browser.import.open', category: 'browser', group: 'browser.import', title: 'settings.browser.import.row', description: 'settings.browser.import.rowDescription', keywords: ['import', 'bookmarks', 'passwords', 'Chrome', 'Edge', 'Firefox', 'Safari', '북마크', '비밀번호'] },
  { id: 'browser.sites', category: 'browser', title: 'settings.browser.sites.title', description: 'settings.browser.sites.description' },
  { id: 'browser.sites.signOutAll', category: 'browser', group: 'browser.sites', title: 'settings.browser.sites.signOutAll', description: 'settings.browser.sites.signOutAllDescription', keywords: ['logout', 'sign out', 'cookies', '쿠키', '세션'] },
  { id: 'browser.sites.clearHistory', category: 'browser', group: 'browser.sites', title: 'settings.browser.sites.clearHistory', description: 'settings.browser.sites.clearHistoryDescription', keywords: ['history', 'clear history', '기록'] },
  { id: 'browser.sites.clearStorage', category: 'browser', group: 'browser.sites', title: 'settings.browser.sites.clearStorage', description: 'settings.browser.sites.clearStorageDescription', keywords: ['cache', 'cookies', 'localStorage', 'IndexedDB', 'service worker', '캐시'] },
  { id: 'browser.permissions', category: 'browser', title: 'settings.browser.permissions.title', description: 'settings.browser.permissions.description' },
  { id: 'browser.permissions.clearAll', category: 'browser', group: 'browser.permissions', title: 'settings.browser.permissions.clearAll', description: 'settings.browser.permissions.clearAllDescription', keywords: ['site permissions', 'notifications', 'camera', 'microphone', 'location', '알림', '카메라', '마이크', '위치'] },
  { id: 'browser.agent', category: 'browser', title: 'settings.browser.agent.title', description: 'settings.browser.agent.description', keywords: ['agent', 'AI', 'automation', 'grants', 'audit', '에이전트', '자동화', '권한'] },
  { id: 'browser.agent.use', category: 'browser', group: 'browser.agent', title: 'settings.browser.agentUse.label', description: 'settings.browser.agentUse.description', keywords: ['agent', 'AI browser', 'computer use', '에이전트'] }
] as const satisfies readonly SettingsCatalogEntry[]
