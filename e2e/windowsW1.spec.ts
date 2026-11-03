import { _electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument } from 'pdf-lib'
import { createCourse, launchBandal, launchEnv, seedSettings, waitForShell } from './helpers/launch'

/**
 * W1 of docs/windows-manual-test.md on the packaged Windows app
 * (.github/workflows/windows-w1.yml): the data-folder move out of
 * Documents\Bandal, also killed mid-copy, signed-out use, bandal://
 * registration and the uninstall/reinstall path. The startup message boxes
 * are native, so UI Automation clicks their real buttons; nothing is stubbed.
 */
test.skip(process.platform !== 'win32' || process.env['BANDAL_E2E_EXECUTABLE'] === undefined, 'packaged Windows app only')

const EXE = process.env['BANDAL_E2E_EXECUTABLE'] ?? ''
const COMMAND_KEY = 'HKCU\\Software\\Classes\\bandal\\shell\\open\\command'
const run = promisify(execFile)

// Finds the Bandal message box (class #32770) whose text includes E2E_TEXT,
// invokes the E2E_BUTTON button and prints the box's texts as JSON. UI
// Automation lists a modal box under the window that owns it.
const MESSAGE_BOX = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
trap { [Console]::Out.WriteLine("$_"); exit 1 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$nl = [string][char]10
$A = [Windows.Automation.AutomationElement]
$scope = [Windows.Automation.TreeScope]
$ofProcess = New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty, [int]$env:E2E_PID)
$isBox = New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')
function Boxes {
  foreach ($window in $A::RootElement.FindAll($scope::Children, $ofProcess)) {
    if ($window.Current.ClassName -eq '#32770') { $window }
    $window.FindAll($scope::Children, $isBox)
  }
}
$seen = @()
$deadline = [DateTime]::UtcNow.AddMilliseconds([int]$env:E2E_TIMEOUT_MS)
while ([DateTime]::UtcNow -lt $deadline) {
  foreach ($box in @(Boxes)) {
    $all = $box.FindAll($scope::Descendants, [Windows.Automation.Condition]::TrueCondition)
    $texts = @(@($box.Current.Name) + @($all | ForEach-Object { $_.Current.Name }) | Where-Object { $_ })
    $seen = $texts
    if (-not (($texts -join $nl).Contains($env:E2E_TEXT))) { continue }
    $button = $all | Where-Object {
      $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ($_.Current.Name -split $nl)[0].Trim() -eq $env:E2E_BUTTON
    } | Select-Object -First 1
    if ($null -eq $button) { throw "no '$($env:E2E_BUTTON)' button among: $($texts -join ' | ')" }
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    ConvertTo-Json -Compress -InputObject $texts
    exit 0
  }
  Start-Sleep -Milliseconds 200
}
$list = @($A::RootElement.FindAll($scope::Children, $ofProcess) | ForEach-Object {
  $children = @($_.FindAll($scope::Children, [Windows.Automation.Condition]::TrueCondition) | ForEach-Object { "$($_.Current.ClassName): $($_.Current.Name)" }) -join ', '
  "$($_.Current.ClassName): $($_.Current.Name) [$children]"
}) -join ' | '
throw "no message box showing '$($env:E2E_TEXT)'; last box: $($seen -join ' | '); windows of the process: $list"
`

/** Clicks `button` in the message box of process `pid` that shows `text`, and returns the box's texts. */
async function messageBox(pid: number, text: string, button: string, timeoutMs = 60_000): Promise<string[]> {
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(MESSAGE_BOX, 'utf16le').toString('base64')], {
      env: { ...process.env, E2E_PID: String(pid), E2E_TEXT: text, E2E_BUTTON: button, E2E_TIMEOUT_MS: String(timeoutMs) },
      encoding: 'utf8', timeout: timeoutMs + 30_000, windowsHide: true
    })
    return JSON.parse(stdout.trim()) as string[]
  } catch (error) {
    throw new Error(`message box '${text}' › ${button}: ${(error as { stdout?: string }).stdout?.trim() || String(error)}`)
  }
}

/** A registry value through reg.exe (`null` = the key's default value); rejects when it is missing. */
async function regValue(key: string, name: string | null = null): Promise<string> {
  const { stdout } = await run('reg', ['query', key, ...(name === null ? ['/ve'] : ['/v', name])], { encoding: 'utf8', windowsHide: true })
  const match = /\sREG_SZ(?: {4}(.*?))?\s*$/m.exec(stdout)
  if (match === null) throw new Error(`no REG_SZ in: ${stdout}`)
  return match[1] ?? ''
}

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const courses = (page: Page) => page.evaluate(() => window.bandal.invoke('courses:list', {}))
const courseRow = (page: Page, name: string) =>
  page.getByRole('complementary', { name: '과목 목록' }).locator('.course-row__name', { hasText: name })

interface OldUser {
  /** `<home>\Documents\Bandal`, the data root before the move. */
  legacy: string
  profileDir: string
  userDataDir: string
  /** SHA-256 of the files written into the old courses, by path under `legacy`. */
  files: Record<string, string>
}

/**
 * A profile as v0.92.9 left it: settings.dataRoot is Documents\Bandal and two
 * managed courses live there. The app looks under the account's own home (a
 * temp USERPROFILE keeps Chromium from starting), so this is the runner's.
 */
async function oldUser(fillerMiB = 0): Promise<OldUser> {
  const legacy = join(homedir(), 'Documents', 'Bandal')
  expect(existsSync(legacy), 'no Documents\\Bandal on this account yet').toBe(false)
  mkdirSync(legacy, { recursive: true })
  const files: Record<string, string> = {}
  const write = (path: string, bytes: Uint8Array | string): void => {
    writeFileSync(path, bytes)
    files[relative(legacy, path)] = sha256(path)
  }
  // BANDAL_DATA_ROOT keeps this seeding launch from moving anything.
  const bandal = await launchBandal({ keepProfileOnClose: true, extraSettings: { dataRoot: legacy } })
  try {
    await createCourse(bandal.page, '선형대수')
    await createCourse(bandal.page, 'Data Structures')
    const list = await courses(bandal.page)
    const folder = (name: string): string => list.find(course => course.name === name)?.folderPath ?? ''
    expect(folder('선형대수').startsWith(legacy + '\\')).toBe(true)
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.addPage()
    write(join(folder('선형대수'), '1주차 강의.pdf'), await pdf.save())
    write(join(folder('선형대수'), '요약.md'), '# 요약\n\n행렬 곱은 결합법칙을 따른다.\n')
    for (let index = 1; index <= Math.ceil(fillerMiB / 16); index++) {
      write(join(folder('Data Structures'), `녹음 ${index}.bin`), randomBytes(16 * 1024 * 1024))
    }
  } finally {
    await bandal.close()
  }
  return { legacy, profileDir: bandal.profileDir, userDataDir: bandal.userDataDir, files }
}

interface Running { app: ElectronApplication; pid: number; output: string[] }
const running: Running[] = []

/** Launches the old user's profile the way an update does: no BANDAL_DATA_ROOT, so the startup move runs. */
async function relaunch(user: OldUser): Promise<Running> {
  const app = await _electron.launch({
    executablePath: EXE,
    env: launchEnv(user.profileDir, user.userDataDir, null)
  })
  const output: string[] = []
  for (const stream of [app.process().stdout, app.process().stderr]) {
    stream?.on('data', chunk => { if (output.length < 2000) output.push(String(chunk)) })
  }
  const launched = { app, pid: await app.evaluate(() => process.pid), output }
  running.push(launched)
  return launched
}

function expectFiles(root: string, files: Record<string, string>): void {
  for (const [path, hash] of Object.entries(files)) expect(sha256(join(root, path)), path).toBe(hash)
}

async function expectMoved(page: Page, user: OldUser): Promise<void> {
  const newRoot = join(user.userDataDir, 'Courses')
  expect((await page.evaluate(() => window.bandal.invoke('settings:get', {}))).dataRoot).toBe(newRoot)
  for (const course of await courses(page)) expect(course.folderPath.startsWith(newRoot + '\\'), course.folderPath).toBe(true)
  expectFiles(newRoot, user.files)
  // The old folder is never changed.
  expectFiles(user.legacy, user.files)
  expect(existsSync(`${newRoot}.partial`)).toBe(false)
  expect(existsSync(join(user.userDataDir, 'data-root-migration.json'))).toBe(false)
  await courseRow(page, '선형대수').click()
  await expect(page.locator('.material-row', { hasText: '1주차 강의' })).toBeVisible()
  await expect(page.locator('.material-row', { hasText: '요약' })).toBeVisible()
}

async function closeKilled(app: ElectronApplication): Promise<void> {
  await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 10_000))])
}

/** Closes what a failed step left open (it holds the profile), keeps its output and removes the folders. */
async function cleanUp(user: OldUser): Promise<void> {
  for (const { app, output } of running.splice(0)) {
    await closeKilled(app)
    await test.info().attach('main process output', { body: output.join(''), contentType: 'text/plain' })
  }
  for (const dir of [user.legacy, user.profileDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    } catch (error) {
      test.info().annotations.push({ type: 'cleanup', description: String(error) })
    }
  }
}

test('W1-3 asks before moving Documents\\Bandal, keeps it on 나중에 and copies it on 옮기기', async () => {
  test.skip(process.env['CI'] !== 'true', 'uses this account\'s Documents\\Bandal: CI runners only')
  test.setTimeout(300_000)
  const user = await oldUser()
  const newRoot = join(user.userDataDir, 'Courses')
  try {
    let bandal = await relaunch(user)
    const text = (await messageBox(bandal.pid, '자료 폴더를 옮길게요', '나중에')).join('\n')
    expect(text).toContain(newRoot)
    expect(text).toContain(user.legacy)
    let page = await waitForShell(bandal.app)
    await expect.poll(async () => (await courses(page)).length).toBe(2)
    expect((await page.evaluate(() => window.bandal.invoke('settings:get', {}))).dataRoot).toBe(user.legacy)
    expect(existsSync(newRoot)).toBe(false)
    await bandal.app.close()

    // Asked again on the next launch.
    bandal = await relaunch(user)
    await messageBox(bandal.pid, '자료 폴더를 옮길게요', '옮기기')
    await messageBox(bandal.pid, '자료 폴더를 옮겼어요', '확인', 180_000)
    page = await waitForShell(bandal.app)
    await expectMoved(page, user)
    await bandal.app.close()

    // Not asked again: a pending message box would hold startup and courses:list.
    bandal = await relaunch(user)
    page = await waitForShell(bandal.app)
    await expect.poll(async () => (await courses(page)).length, { timeout: 30_000 }).toBe(2)
    await bandal.app.close()
  } finally {
    await cleanUp(user)
  }
})

test('W1-3 a move killed mid-copy keeps both folders intact, asks again and completes', async () => {
  test.skip(process.env['CI'] !== 'true', 'uses this account\'s Documents\\Bandal: CI runners only')
  test.setTimeout(420_000)
  const user = await oldUser(320)
  const staging = join(user.userDataDir, 'Courses.partial'), journal = join(user.userDataDir, 'data-root-migration.json')
  const copying = (): boolean => {
    try {
      return (JSON.parse(readFileSync(journal, 'utf8')) as { state: string }).state === 'copying' &&
        readdirSync(staging, { recursive: true }).length > 2
    } catch {
      return false
    }
  }
  try {
    let bandal = await relaunch(user)
    await messageBox(bandal.pid, '자료 폴더를 옮길게요', '옮기기')
    await expect.poll(copying, { intervals: [50], timeout: 60_000 }).toBe(true)
    await run('taskkill', ['/PID', String(bandal.pid), '/T', '/F'])
    await closeKilled(bandal.app)
    // Killed while copying: the setting and the old folder are untouched.
    expect((JSON.parse(readFileSync(join(user.userDataDir, 'settings.json'), 'utf8')) as { dataRoot: string }).dataRoot).toBe(user.legacy)
    expectFiles(user.legacy, user.files)
    expect(existsSync(journal)).toBe(true)

    bandal = await relaunch(user)
    await messageBox(bandal.pid, '자료 폴더를 옮길게요', '옮기기')
    await messageBox(bandal.pid, '자료 폴더를 옮겼어요', '확인', 240_000)
    const page = await waitForShell(bandal.app)
    await expectMoved(page, user)
    await expect.poll(async () => (await courses(page)).length).toBe(2)
    await bandal.app.close()
  } finally {
    await cleanUp(user)
  }
})

test('W1-4 signed out, work survives a restart and sign-in offers only Apple and Google', async () => {
  const first = await launchBandal({ keepProfileOnClose: true })
  await createCourse(first.page, '로그인 없이')
  await first.app.close()
  const bandal = await launchBandal({ reuseProfileDir: first.profileDir })
  try {
    const { page } = bandal
    await expect(page.getByRole('heading', { name: '반달에 로그인' })).toHaveCount(0)
    expect((await page.evaluate(() => window.bandal.invoke('auth:getState', {}))).phase).toBe('signed-out')
    await expect(courseRow(page, '로그인 없이')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="account"]').click()
    const panel = page.locator('.settings-panel')
    await expect(panel.getByRole('button', { name: 'Apple로 로그인' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Google로 로그인' })).toBeVisible()
    await expect(panel.getByText(/kakao|카카오/i)).toHaveCount(0)
  } finally {
    await bandal.close()
  }
})

test('W1-5 bandal:// opens this Bandal.exe, which hands the link to the running app', async () => {
  const bandal = await launchBandal()
  // A path, like auth/callback: Windows adds '/' before the query when there is none.
  const probe = `bandal://e2e/probe?id=${randomUUID()}`
  try {
    const exe = await bandal.app.evaluate(() => process.execPath)
    expect(await regValue(COMMAND_KEY)).toBe(`"${exe}" "%1"`)
    expect(await regValue('HKCU\\Software\\Classes\\bandal', 'URL Protocol')).toBe('')
    await bandal.app.evaluate(({ app }) => {
      (globalThis as { e2eHandoff?: Promise<string[]> }).e2eHandoff =
        new Promise(resolve => app.once('second-instance', (_event, argv) => resolve(argv)))
    })
    // As a browser does: ShellExecute → the registry command → a second
    // Bandal.exe, which finds this profile's lock and hands over its argv.
    // It inherits this env, so it resolves the same profile.
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${probe}'`], {
      env: launchEnv(bandal.profileDir, bandal.userDataDir, bandal.dataRoot), windowsHide: true
    })
    const argv = await bandal.app.evaluate(() => (globalThis as { e2eHandoff?: Promise<string[]> }).e2eHandoff)
    expect(argv).toContain(probe)
  } finally {
    await bandal.close()
    // A copy that did not hand over would still be running.
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='Bandal.exe'" | Where-Object CommandLine -like '*${probe.slice(-36)}*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
    ], { windowsHide: true }).catch(() => undefined)
  }
})

test('W1-7 uninstalling keeps %APPDATA%\\bandal and a reinstall opens it without asking', async () => {
  const installer = process.env['BANDAL_E2E_INSTALLER']
  test.skip(installer === undefined || process.env['CI'] !== 'true', 'installs into this Windows account: CI runners only (BANDAL_E2E_INSTALLER)')
  test.setTimeout(600_000)
  const programs = join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Bandal'), exe = join(programs, 'Bandal.exe')
  const uninstaller = join(programs, 'Uninstall Bandal.exe')
  const profile = join(process.env['APPDATA'] ?? '', 'bandal')
  // Never run over a real install or profile; other launches may leave an empty folder here.
  expect(existsSync(programs), 'Bandal is not installed').toBe(false)
  expect(existsSync(join(profile, 'bandal.db')), 'no Bandal profile yet').toBe(false)
  const install = async (): Promise<void> => {
    await run(installer ?? '', ['/S'], { timeout: 300_000 })
    await expect.poll(() => existsSync(exe), { timeout: 60_000 }).toBe(true)
  }
  const uninstall = async (): Promise<void> => {
    // NSIS reruns the uninstaller from %TEMP%, so the first process returns early.
    await run(uninstaller, ['/S'], { timeout: 300_000 })
    await expect.poll(() => existsSync(exe), { timeout: 120_000 }).toBe(false)
  }
  const open = async (): Promise<{ app: ElectronApplication; page: Page }> => {
    // The default profile: no BANDAL_USER_DATA_DIR and no BANDAL_DATA_ROOT.
    const env = launchEnv(profile, profile, null)
    delete env['BANDAL_USER_DATA_DIR']
    const app = await _electron.launch({ executablePath: exe, env })
    return { app, page: await waitForShell(app) }
  }
  try {
    await install()
    mkdirSync(profile, { recursive: true })
    seedSettings(profile, join(profile, 'Courses'))
    let bandal = await open()
    expect((await bandal.app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase()).toBe(profile.toLowerCase())
    await createCourse(bandal.page, '다시 설치')
    expect(await regValue(COMMAND_KEY)).toBe(`"${exe}" "%1"`)
    await bandal.app.close()

    await uninstall()
    expect(existsSync(join(profile, 'settings.json'))).toBe(true)
    expect(existsSync(join(profile, 'bandal.db'))).toBe(true)
    expect(readdirSync(join(profile, 'Courses')).length).toBeGreaterThan(0)
    // The app registers bandal:// itself on launch, so the uninstaller does not know the key.
    const left = await regValue(COMMAND_KEY).catch(() => null)
    test.info().annotations.push({ type: 'bandal:// after uninstall', description: left ?? 'removed' })

    await install()
    bandal = await open()
    await expect(courseRow(bandal.page, '다시 설치')).toBeVisible()
    await expect.poll(async () => (await courses(bandal.page)).length, { timeout: 30_000 }).toBe(1)
    expect(await regValue(COMMAND_KEY)).toBe(`"${exe}" "%1"`)
    await bandal.app.close()
  } finally {
    if (existsSync(uninstaller)) await uninstall().catch(() => undefined)
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
})
