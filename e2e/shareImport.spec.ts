import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

test('shared files survive reload and import into the chosen course folder without replacing files', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '공유 시작 과목')
    await createCourse(page, '공유 저장 과목')
    const courses = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const course = courses.find(course => course.name === '공유 저장 과목')!
    await page.evaluate(courseId => window.bandal.invoke('materials:createFolder', { courseId, dirRelPath: '', name: '받은 자료' }), course.id)
    writeFileSync(join(course.folderPath, '받은 자료', '공유.md'), 'Existing content')
    const id = randomUUID()
    const requestDir = join(bandal.profileDir, 'share-inbox', id)
    mkdirSync(requestDir, { recursive: true })
    writeFileSync(join(requestDir, '공유.md'), '# Shared content\n\nExternal share payload.\n')
    writeFileSync(join(requestDir, 'manifest.json'), JSON.stringify({ version: 1, id, createdAt: new Date().toISOString(), files: ['공유.md'] }))
    await bandal.app.evaluate(({ app }, url) => {
      app.emit('open-url', { preventDefault() {} } as Electron.Event, url)
    }, `bandal://share/inbox/${id}`)

    const dialog = page.getByRole('dialog', { name: '공유한 자료 가져오기' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('공유.md')
    await page.reload()
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('과목', { exact: true }).selectOption(course.id)
    await dialog.getByLabel('저장할 폴더', { exact: true }).selectOption('받은 자료')
    await info.attach('share-course-folder-picker', { body: await page.screenshot(), contentType: 'image/png' })
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(readFileSync(join(course.folderPath, '받은 자료', '공유.md'), 'utf8')).toBe('Existing content')
    const tree = await page.evaluate(courseId => window.bandal.invoke('materials:tree', { courseId }), course.id)
    const folder = tree.find(node => node.relPath === '받은 자료')!
    const imported = folder.children!.find(node => node.relPath !== '받은 자료/공유.md')!
    expect(imported).toBeDefined()
    expect(readFileSync(join(course.folderPath, imported.relPath), 'utf8')).toContain('External share payload.')
    expect(existsSync(requestDir)).toBe(false)
    expect(await page.evaluate(() => window.bandal.invoke('share:list', {}))).toEqual([])
  } finally {
    await bandal.close()
  }
})

test('a first share can create its destination course without losing the delivery', async () => {
  const bandal = await launchBandal()
  try {
    const id = randomUUID()
    const requestDir = join(bandal.profileDir, 'share-inbox', id)
    mkdirSync(requestDir, { recursive: true })
    writeFileSync(join(requestDir, '공유한 내용.md'), 'First shared material')
    writeFileSync(join(requestDir, 'manifest.json'), JSON.stringify({ version: 1, id, createdAt: new Date().toISOString(), files: ['공유한 내용.md'] }))
    await bandal.app.evaluate(({ app }, url) => app.emit('open-url', { preventDefault() {} } as Electron.Event, url), `bandal://share/inbox/${id}`)
    const dialog = bandal.page.getByRole('dialog', { name: '공유한 자료 가져오기' })
    await dialog.getByLabel('새 과목 이름').fill('첫 공유 과목')
    await dialog.getByRole('button', { name: '과목 만들기', exact: true }).click()
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click()
    await expect(dialog).toBeHidden()
    const courses = await bandal.page.evaluate(() => window.bandal.invoke('courses:list', {}))
    expect(courses).toHaveLength(1)
    expect(courses[0]!.name).toBe('첫 공유 과목')
    expect(readFileSync(join(courses[0]!.folderPath, '공유한 내용.md'), 'utf8')).toBe('First shared material')
  } finally { await bandal.close() }
})
