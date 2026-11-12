import type { SettingsCatalogEntry } from '../catalogTypes'

export const APPEARANCE_ENTRIES = [
  { id: 'appearance.theme', category: 'appearance', title: 'settings.appearance.theme.title', description: 'settings.appearance.theme.description', keywords: ['theme', 'dark mode', 'light mode', 'system', '다크 모드', '라이트 모드', '시스템'] },
  { id: 'appearance.decor', category: 'appearance', title: 'settings.appearance.decor.title', description: 'settings.appearance.decor.description', keywords: ['color', 'palette', 'glass', 'wallpaper', '색', '색상', '테마', '배경', '글래스', '꾸미기', '팔레트'] },
  { id: 'appearance.text', category: 'appearance', title: 'settings.appearance.text.title', description: 'settings.appearance.text.description' },
  { id: 'appearance.text.scale', category: 'appearance', group: 'appearance.text', title: 'settings.appearance.font.scale.title', description: 'settings.appearance.font.scale.description', keywords: ['font size', 'text size', 'zoom', '확대', '배율'] },
  { id: 'appearance.text.editorFont', category: 'appearance', group: 'appearance.text', title: 'settings.appearance.font.family.title', description: 'settings.appearance.font.family.description', keywords: ['font', 'typeface', 'serif', 'mono', 'sans', '글꼴', '고딕', '명조', '고정폭'] },
  { id: 'appearance.density', category: 'appearance', title: 'settings.appearance.density.title', description: 'settings.appearance.density.description', keywords: ['density', 'compact', 'spacing', '여백', '촘촘하게', '편안하게'] }
] as const satisfies readonly SettingsCatalogEntry[]
