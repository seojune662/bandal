import { expect, test } from 'vitest'
import { accountAvatarUrl } from '../../../src/shared/account/avatar'

test('uses the Google or Kakao provider photo and upgrades legacy Kakao URLs', () => {
  expect(accountAvatarUrl({ avatar_url: 'https://lh3.googleusercontent.com/a/photo' })).toBe('https://lh3.googleusercontent.com/a/photo')
  expect(accountAvatarUrl({ picture: 'http://k.kakaocdn.net/dn/photo.jpg' })).toBe('https://k.kakaocdn.net/dn/photo.jpg')
  expect(accountAvatarUrl({ avatar_url: '', picture: 'https://t1.kakaocdn.net/photo' })).toBe('https://t1.kakaocdn.net/photo')
})
test('missing or untrusted photos use the neutral profile', () => {
  for (const avatar_url of [undefined, '', 'file:///secret', 'javascript:alert(1)', 'https://googleusercontent.com.attacker.test/a', 'https://user:pass@k.kakaocdn.net/a']) {
    expect(accountAvatarUrl({ avatar_url })).toBeNull()
  }
  expect(accountAvatarUrl(undefined)).toBeNull()
})
