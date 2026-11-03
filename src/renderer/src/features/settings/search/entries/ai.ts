import type { SettingsCatalogEntry } from '../catalogTypes'

export const AI_ENTRIES = [
  { id: 'ai.engine', category: 'ai', title: 'settings.ai.engine.title', description: 'settings.ai.engine.description' },
  { id: 'ai.engine.provider', category: 'ai', group: 'ai.engine', title: 'settings.ai.engine.label', description: 'settings.ai.engine.help', keywords: ['provider', 'agent', 'model', '모델', '에이전트', 'Claude', 'ChatGPT', 'Codex', 'Gemini'] },
  { id: 'ai.claude', category: 'ai', title: 'settings.ai.claude.name', description: 'settings.ai.claude.description', keywords: ['Claude Code', 'Anthropic', '클로드', 'login', '로그인'] },
  { id: 'ai.codex', category: 'ai', title: 'settings.ai.codex.name', description: 'settings.ai.codex.description', keywords: ['Codex', 'OpenAI', 'GPT', '챗GPT', 'login', '로그인'] },
  { id: 'ai.gemini', category: 'ai', title: 'settings.ai.gemini.name', description: 'settings.ai.gemini.description', keywords: ['Google', '제미나이', 'Gemini CLI', 'login', '로그인'] },
  { id: 'ai.gemini.apiKey', category: 'ai', group: 'ai.gemini', title: 'settings.ai.apiKey.label', description: 'settings.ai.apiKey.description', keywords: ['API key', 'Google AI Studio', 'AI Studio', '키'] }
] as const satisfies readonly SettingsCatalogEntry[]
