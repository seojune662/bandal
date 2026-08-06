/**
 * The update path fails in ways students cannot diagnose, and it fails
 * *silently* by design (a background check every 6 hours). These tests pin the
 * two decisions that determine whether they see anything at all: what counts
 * as "just offline", and what each real failure is called.
 */

import { describe, expect, it } from 'vitest'
import {
  describeError,
  isNoFeed,
  isOfflineish
} from '../../../src/main/features/updater/errorMessages'

describe('isNoFeed', () => {
  it('recognises a build with no app-update.yml', () => {
    // Real message seen from a `--dir` build: the updater must go quiet rather
    // than toast an ENOENT at the student every 6 hours.
    expect(
      isNoFeed(
        "ENOENT: no such file or directory, open '/Applications/Bandal.app/Contents/Resources/app-update.yml'"
      )
    ).toBe(true)
  })

  it('does not claim a missing feed for unrelated file errors', () => {
    expect(isNoFeed('ENOENT: no such file or directory, open bandal.db')).toBe(false)
  })
})

describe('isOfflineish', () => {
  it.each([
    'net::ERR_INTERNET_DISCONNECTED',
    'getaddrinfo ENOTFOUND github.com',
    'getaddrinfo EAI_AGAIN objects.githubusercontent.com',
    'connect ETIMEDOUT 140.82.114.4:443',
    'read ECONNRESET',
    'connect ECONNREFUSED 127.0.0.1:443'
  ])('treats %s as offline, not an error', (message) => {
    expect(isOfflineish(message)).toBe(true)
  })

  it.each([
    'Could not get code signature for running application',
    'HttpError: 404 Not Found',
    'ENOSPC: no space left on device'
  ])('does not swallow %s', (message) => {
    expect(isOfflineish(message)).toBe(false)
  })
})

describe('describeError', () => {
  it('explains an unsigned/tampered app instead of leaking Squirrel wording', () => {
    // The single most likely real-world failure on macOS: a locally built or
    // re-zipped copy that Squirrel.Mac refuses to update.
    const message = describeError(
      'Could not get code signature for running application'
    )
    expect(message).toContain('서명')
    expect(message).toContain('내려받아')
    expect(message).not.toContain('code signature')
  })

  it('says there is no release yet rather than showing a 404', () => {
    expect(describeError('HttpError: 404 Not Found')).toBe(
      '아직 게시된 릴리스가 없습니다.'
    )
    expect(describeError('Cannot find latest-mac.yml in the latest release')).toBe(
      '아직 게시된 릴리스가 없습니다.'
    )
  })

  it('names a full disk', () => {
    expect(describeError('ENOSPC: no space left on device')).toContain('저장 공간')
  })

  it('names a permission problem', () => {
    expect(describeError('EACCES: permission denied, rename ...')).toContain('권한')
  })

  it('still surfaces the raw text for anything unrecognised', () => {
    // Better an ugly message than a silent failure the student cannot report.
    expect(describeError('kaboom')).toContain('kaboom')
  })

  it('routes offline messages to the network wording', () => {
    expect(describeError('net::ERR_INTERNET_DISCONNECTED')).toContain('네트워크')
  })
})
