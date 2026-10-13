import { describe, expect, test } from 'vitest'
import {
  forgetGoogleAccountNavigation,
  googleAccountRequestUrl,
  googleAccountNavigationUrl,
  prepareGoogleAccountSiteNavigation,
  rememberGoogleAccountNavigation
} from '../../../src/main/features/browser/googleAccountNavigation'

describe('explicit Google account navigation', () => {
  test('opens YouTube with the latest committed Google account before its first request', () => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=0')
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/?authuser=1')
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/watch?v=lecture&t=90#chapter'))
      .toBe('https://www.youtube.com/watch?v=lecture&t=90&authuser=1#chapter')
  })

  test.each([
    'https://mail.google.com/mail/u/1/#inbox',
    'https://drive.google.com/drive/u/1/home',
    'https://docs.google.com/document/u/1/',
    'https://www.google.co.kr/search?q=lecture&authuser=1'
  ])('uses only the explicit numeric account in %s', source => {
    const session = {}
    rememberGoogleAccountNavigation(session, source)
    expect(googleAccountNavigationUrl(session, 'https://youtube.com/')).toBe('https://youtube.com/?authuser=1')
  })

  test('isolates browser profiles and private sessions', () => {
    const first = {}, second = {}, privateSession = {}
    rememberGoogleAccountNavigation(first, 'https://www.google.com/?authuser=1')
    rememberGoogleAccountNavigation(second, 'https://www.google.com/?authuser=2')
    expect(googleAccountNavigationUrl(first, 'https://www.youtube.com/')).toContain('authuser=1')
    expect(googleAccountNavigationUrl(second, 'https://www.youtube.com/')).toContain('authuser=2')
    expect(googleAccountNavigationUrl(privateSession, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test('hands off once, then lets YouTube own its account and channel selection', () => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/?authuser=1')
    rememberGoogleAccountNavigation(session, 'https://www.youtube.com/?authuser=1')
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
    rememberGoogleAccountNavigation(session, 'https://www.youtube.com/?authuser=0')
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/watch?v=lecture'))
      .toBe('https://www.youtube.com/watch?v=lecture')
  })

  test('an explicit YouTube choice before handoff supersedes the pending Google choice', () => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    rememberGoogleAccountNavigation(session, 'https://www.youtube.com/?authuser=0')
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test('a hidden Google page cannot choose the account, but a hidden logout invalidates it', () => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=0', false)
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/?authuser=1')
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    rememberGoogleAccountNavigation(session, 'https://accounts.google.com/Logout', false)
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test('a hidden YouTube account switch invalidates the pending selection in that session', () => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    rememberGoogleAccountNavigation(session, 'https://www.youtube.com/?authuser=0', false)
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test('clearing browser storage also forgets the session account index', () => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    forgetGoogleAccountNavigation(session)
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test('a marked native Google link hands off on the first GET, without replaying canonical redirects', () => {
    const session = {}, page = {}
    const source = 'https://www.google.com/?authuser=1', destination = 'https://www.youtube.com/'
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, destination)
    const request = { url: destination, method: 'GET', resourceType: 'mainFrame' }
    expect(googleAccountRequestUrl(session, page, request)).toBe('https://www.youtube.com/?authuser=1')
    // Even another visible Google commit cannot turn this redirect chain into
    // a loop: only a new will-navigate event can mark another native request.
    rememberGoogleAccountNavigation(session, source)
    expect(googleAccountRequestUrl(session, page, request)).toBe(destination)
  })

  test('native account handoff belongs to the marked page, not a sibling tab', () => {
    const session = {}, page = {}, sibling = {}
    const source = 'https://www.google.com/?authuser=1', destination = 'https://www.youtube.com/'
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, destination)
    const request = { url: destination, method: 'GET', resourceType: 'mainFrame' }
    expect(googleAccountRequestUrl(session, sibling, request)).toBe(destination)
    expect(googleAccountRequestUrl(session, page, request)).toContain('authuser=1')
  })

  test.each(['', 'about:blank'])('preserves an inherited popup marker through its first %s navigation', initialUrl => {
    const session = {}, page = {}, source = 'https://www.google.com/?authuser=1', target = 'https://www.youtube.com/watch?v=popup'
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, target, true)
    prepareGoogleAccountSiteNavigation(page, initialUrl, target)
    expect(googleAccountRequestUrl(session, page, { url: target, method: 'GET', resourceType: 'mainFrame' }))
      .toBe(`${target}&authuser=1`)
  })

  test('does not preserve a popup marker for a changed target or an already committed document', () => {
    const session = {}, page = {}, source = 'https://www.google.com/?authuser=1', target = 'https://www.youtube.com/'
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, target, true)
    prepareGoogleAccountSiteNavigation(page, 'about:blank', 'https://www.youtube.com/watch?v=other')
    expect(googleAccountRequestUrl(session, page, { url: target, method: 'GET', resourceType: 'mainFrame' })).toBe(target)
    prepareGoogleAccountSiteNavigation(page, source, target, true)
    prepareGoogleAccountSiteNavigation(page, 'https://www.youtube.com/', target)
    expect(googleAccountRequestUrl(session, page, { url: target, method: 'GET', resourceType: 'mainFrame' })).toBe(target)
  })

  test('matches a native request without its fragment and preserves the clicked link fragment', () => {
    const session = {}, page = {}, source = 'https://www.google.com/?authuser=1'
    const target = 'https://www.youtube.com/watch?v=lecture#chapter'
    const request = { url: 'https://www.youtube.com/watch?v=lecture', method: 'GET', resourceType: 'mainFrame' }
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, target)
    expect(googleAccountRequestUrl(session, page, request)).toBe('https://www.youtube.com/watch?v=lecture&authuser=1#chapter')
    // With no pending account, a fragment alone must not cause a redirect.
    prepareGoogleAccountSiteNavigation(page, source, target)
    expect(googleAccountRequestUrl(session, page, request)).toBe(request.url)
  })

  test('a native POST is neither rewritten nor later retried as GET', () => {
    const session = {}, page = {}
    const source = 'https://www.google.com/?authuser=1', destination = 'https://www.youtube.com/'
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, destination)
    expect(googleAccountRequestUrl(session, page, { url: destination, method: 'POST', resourceType: 'mainFrame' })).toBe(destination)
    expect(googleAccountRequestUrl(session, page, { url: destination, method: 'GET', resourceType: 'mainFrame' })).toBe(destination)
  })

  test.each(['subFrame', 'xhr', 'script', 'media'])('a %s request cannot consume a main-frame navigation marker', resourceType => {
    const session = {}, page = {}
    const source = 'https://www.google.com/?authuser=1', destination = 'https://www.youtube.com/'
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, destination)
    expect(googleAccountRequestUrl(session, page, { url: destination, method: 'GET', resourceType })).toBe(destination)
    expect(googleAccountRequestUrl(session, page, { url: destination, method: 'GET', resourceType: 'mainFrame' })).toContain('authuser=1')
  })

  test.each([
    'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2F',
    'https://www.google.com/logout',
    'https://www.google.com/?continue=%2F',
    'https://www.youtube.com/',
    'https://example.com/',
    'https://www.google.com.attacker.test/'
  ])('does not mark native requests from auth flow, YouTube itself, or unrelated sources: %s', source => {
    const session = {}, page = {}, destination = 'https://www.youtube.com/'
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    prepareGoogleAccountSiteNavigation(page, source, destination)
    expect(googleAccountRequestUrl(session, page, { url: destination, method: 'GET', resourceType: 'mainFrame' })).toBe(destination)
  })

  test('an unrelated next navigation retires a canceled native link marker', () => {
    const session = {}, page = {}, source = 'https://www.google.com/?authuser=1'
    rememberGoogleAccountNavigation(session, source)
    prepareGoogleAccountSiteNavigation(page, source, 'https://www.youtube.com/')
    prepareGoogleAccountSiteNavigation(page, source, 'https://example.com/')
    expect(googleAccountRequestUrl(session, page, { url: 'https://www.youtube.com/', method: 'GET', resourceType: 'mainFrame' }))
      .toBe('https://www.youtube.com/')
  })

  test.each([
    'https://www.youtube.com/?authuser=0',
    'https://www.youtube.com/?authuser=student%40example.com',
    'https://www.youtube.com/?authuser=',
    'https://www.youtube.com/?pageid=channel',
    'https://www.youtube.com/?action_handle_signin=true&next=%2F',
    'https://www.youtube.com/?state=opaque&code=opaque',
    'https://www.youtube.com/signin',
    'https://www.youtube.com/logout',
    'https://www.youtube.com/channel_switcher',
    'https://www.youtube.com/switch_service_login'
  ])('preserves explicit destination intent and drops stale selection: %s', destination => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    expect(googleAccountNavigationUrl(session, destination)).toBe(destination)
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test.each([
    'https://accounts.google.com/Logout',
    'https://accounts.google.com/v3/signin/challenge',
    'https://accounts.youtube.com/accounts/SetSID',
    'https://www.google.com/logout',
    'https://www.youtube.com/signin?authuser=0',
    'https://www.youtube.com/?pageid=channel',
    'https://www.google.com/?authuser=student%40example.com',
    'https://mail.google.com/mail/u/student%40example.com/'
  ])('clears the remembered index when account state can change: %s', source => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    rememberGoogleAccountNavigation(session, source)
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test.each([
    'https://www.google.com.attacker.test/?authuser=1',
    'https://attacker.test/?authuser=1',
    'https://googleusercontent.com/?authuser=1',
    'https://accounts.google.com/AccountChooser?authuser=1',
    'https://www.google.com/?continue=https%3A%2F%2Fwww.google.com%2F%3Fauthuser%3D1',
    'http://www.google.com/?authuser=1',
    'https://www.google.com:8443/?authuser=1',
    'https://student:secret@www.google.com/?authuser=1',
    'https://www.google.com/?authuser=-1',
    'https://www.google.com/?authuser=1&authuser=2',
    'https://drive.google.com/drive/u/1/home?authuser=2',
    'not a URL'
  ])('does not infer an account from ambiguous or untrusted source: %s', source => {
    const session = {}
    rememberGoogleAccountNavigation(session, source)
    expect(googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  })

  test.each([
    'https://www.youtube.com.attacker.test/',
    'https://music.youtube.com/',
    'https://studio.youtube.com/',
    'https://www.youtube.com/youtubei/v1/account/accounts_list',
    'https://www.youtube.com/embed/lecture',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/channel/UCexample',
    'http://www.youtube.com/',
    'https://www.youtube.com:8443/',
    'https://student:secret@www.youtube.com/',
    'https://accounts.youtube.com/accounts/SetSID',
    'https://example.com/',
    'not a URL'
  ])('does not alter unrelated, embedded, channel, or nonstandard URLs: %s', destination => {
    const session = {}
    rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
    expect(googleAccountNavigationUrl(session, destination)).toBe(destination)
  })
})
