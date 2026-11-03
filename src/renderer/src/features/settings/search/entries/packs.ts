import type { SettingsCatalogEntry } from '../catalogTypes'

/**
 * Static plugin-center rows. Installed plugin names and their manifest
 * settings are indexed at runtime by SettingsApp (`packs.plugin.<id>[.<key>]`).
 */
export const PACKS_ENTRIES = [
  { id: 'packs.features', category: 'packs', title: 'settings.packs.features.title', description: 'settings.packs.features.description', keywords: ['plugin', 'extension', 'study pack', 'workflow', '팩', '확장', '학습 도구', '외부 도구', 'MCP', 'Notion', 'GitHub', 'Slack', 'Google Drive'] },
  { id: 'packs.manage', category: 'packs', title: 'settings.packs.manage.title', description: 'settings.packs.manage.description' },
  { id: 'packs.manage.catalog', category: 'packs', group: 'packs.manage', title: 'settings.packs.manage.catalog.title', description: 'settings.packs.manage.catalog.description', keywords: ['catalog', 'sources', 'source', '카탈로그', '소스', 'browse', '찾아보기', 'install'] },
  { id: 'packs.manage.external', category: 'packs', group: 'packs.manage', title: 'settings.packs.manage.external.title', description: 'settings.packs.manage.external.description', keywords: ['MCP', 'MCP servers', 'MCP 서버', 'server connections', '서버 연결', 'external tools'] },
  { id: 'packs.manage.installFolder', category: 'packs', group: 'packs.manage', title: 'settings.packs.manage.installFolder.title', description: 'settings.packs.manage.installFolder.description', keywords: ['install', 'folder', 'local plugin', '설치', '폴더'] },
  { id: 'packs.manage.importPack', category: 'packs', group: 'packs.manage', title: 'settings.packs.manage.importPack.title', description: 'settings.packs.manage.importPack.description', keywords: ['import', 'pack', 'JSON', '팩', '가져오기'] },
  { id: 'packs.manage.importMcp', category: 'packs', group: 'packs.manage', title: 'settings.packs.manage.importMcp.title', description: 'settings.packs.manage.importMcp.description', keywords: ['MCP', 'JSON', 'Claude Desktop', 'Cursor', 'import', '가져오기'] },
  { id: 'packs.manage.manualMcp', category: 'packs', group: 'packs.manage', title: 'settings.packs.manage.manualMcp.title', description: 'settings.packs.manage.manualMcp.description', keywords: ['MCP', 'stdio', 'http', 'server', '서버', 'manual'] },
  { id: 'packs.manage.developer', category: 'packs', group: 'packs.manage', title: 'settings.packs.manage.developer.title', description: 'settings.packs.manage.developer.description', keywords: ['developer center', '개발자 센터', 'local development', '로컬 개발', 'marketplace', '마켓플레이스', 'publish', '배포', 'release'] }
] as const satisfies readonly SettingsCatalogEntry[]
