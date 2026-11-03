import type { SettingsCatalogEntry } from '../catalogTypes'

export const ACCOUNT_ENTRIES = [
  { id: 'account.profile', category: 'account', title: 'settings.account.profile.title', description: 'settings.account.profile.description', keywords: ['profile', 'avatar', '프로필 사진', 'email', '이메일'] },
  { id: 'account.profile.nickname', category: 'account', group: 'account.profile', title: 'settings.account.nickname.title', description: 'settings.account.nickname.description', keywords: ['nickname', 'name', 'username', '이름', '별명'] },
  { id: 'account.signIn', category: 'account', title: 'settings.account.signIn.title', description: 'settings.account.signIn.description', keywords: ['sign in', 'login', 'Apple', 'Google', '로그인'] },
  { id: 'account.link', category: 'account', title: 'settings.account.link.title', description: 'settings.account.link.description', keywords: ['link', 'identity', 'Apple', 'Google', '연동'] },
  { id: 'account.link.providers', category: 'account', group: 'account.link', title: 'settings.account.link.providersLabel', description: 'settings.account.link.providersDescription', keywords: ['Sign in with Apple', 'Google', '연결'] },
  { id: 'account.backup', category: 'account', title: 'settings.account.backup.title', description: 'settings.account.backup.description', keywords: ['backup', 'profile', '백업'] },
  { id: 'account.backup.full', category: 'account', group: 'account.backup', title: 'settings.account.backup.full.title', description: 'settings.account.backup.full.description', keywords: ['backup', 'export', '내보내기', '백업'] },
  { id: 'account.backup.newProfile', category: 'account', group: 'account.backup', title: 'settings.account.backup.newProfile.title', description: 'settings.account.backup.newProfile.description', keywords: ['new profile', 'reset', 'fresh start', '초기화', '프로필 전환'] },
  { id: 'account.session', category: 'account', title: 'settings.account.session.title', description: 'settings.account.session.description' },
  { id: 'account.session.signOut', category: 'account', group: 'account.session', title: 'settings.account.signOut.title', description: 'settings.account.signOut.description', keywords: ['sign out', 'log out', 'logout'] },
  { id: 'account.session.delete', category: 'account', group: 'account.session', title: 'settings.account.delete.title', description: 'settings.account.delete.description', keywords: ['delete account', 'remove account', '탈퇴', '회원 탈퇴', 'GDPR'] }
] as const satisfies readonly SettingsCatalogEntry[]
