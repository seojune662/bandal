import { expect, test } from 'vitest'
import { foldVisits, normalizeSiteUrl, rankHomeSites, sanitizeHomeSites, type HomeSiteSchoolLink } from '../../src/shared/homeSites'

const school = (id: string, url: string, secondary = false): HomeSiteSchoolLink => ({ id, label: id, url, secondary, opensExternally: false })
const links = [school('portal', 'https://portal.snu.ac.kr'), school('mail', 'https://mail.snu.ac.kr', true), school('etl', 'https://myetl.snu.ac.kr'), school('lib', 'https://lib.snu.ac.kr'), school('sugang', 'https://sugang.snu.ac.kr'), school('dorm', 'https://dorm.snu.ac.kr')]

test('school essentials first (main links before secondary), capped at four, in school order', () => {
  const sites = rankHomeSites(links, { pinned: [], hidden: [], custom: [] }, [])
  expect(sites.map(site => site.id)).toEqual(['school:portal', 'school:etl', 'school:lib', 'school:sugang'])
})

test('visits reorder; often-visited hosts join; pinned stay first in pin order; hidden hosts leave', () => {
  const sites = rankHomeSites(links, { pinned: ['custom:notion', 'school:lib'], hidden: ['sugang.snu.ac.kr'], custom: [{ id: 'custom:notion', title: '', url: 'https://www.notion.so/' }] }, [
    { host: 'www.youtube.com', title: 'YouTube', visits: 5 },
    { host: 'myetl.snu.ac.kr', title: 'eTL', visits: 9 },
    { host: 'rare.example', title: 'Rare', visits: 2 }
  ])
  expect(sites.map(site => site.id)).toEqual(['custom:notion', 'school:lib', 'school:etl', 'visited:youtube.com', 'school:portal'])
  expect(sites[0]).toMatchObject({ title: 'notion.so', pinned: true })
})

test('caps at twelve tiles', () => {
  const custom = Array.from({ length: 20 }, (_, i) => ({ id: `custom:${i}`, title: `S${i}`, url: `https://s${i}.example/` }))
  expect(rankHomeSites([], { pinned: [], hidden: [], custom }, [])).toHaveLength(12)
})

test('history folds by host without www; addresses normalise; preferences sanitise', () => {
  expect(foldVisits([{ host: 'www.a.com', title: 'A', visitCount: 2 }, { host: 'a.com', title: 'A2', visitCount: 3 }])).toEqual([{ host: 'a.com', title: 'A', visits: 5 }])
  expect(normalizeSiteUrl('naver.com')).toBe('https://naver.com/')
  expect(normalizeSiteUrl('javascript:alert(1)')).toBeNull()
  expect(normalizeSiteUrl('localhost')).toBeNull()
  expect(sanitizeHomeSites({ pinned: ['a', 'a', 3], custom: [{ id: 'x', url: 'file:///etc' }, { id: 'y', url: 'https://y.com', title: 'Y' }] }))
    .toEqual({ pinned: ['a'], hidden: [], custom: [{ id: 'y', title: 'Y', url: 'https://y.com' }] })
})
