import { app, dialog, shell, type BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDatabase } from '../../db/database'
import { defaultDataRoot, getSettings, legacyDataRoot, setSettings } from '../../settingsStore'
import { copyClaudeProjects, DataRootMoveError, moveDataRoot, planDataRootMove, recoverDataRootMove } from './dataRootMove'

function reason(error: unknown): string {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC') return '저장 공간이 부족해요.'
  if (error instanceof DataRootMoveError) return error.code === 'materialize-timeout' ? `${error.message}\n인터넷 연결을 확인해 주세요.` : error.message
  return error instanceof Error ? error.message : '알 수 없는 오류가 났어요.'
}

/**
 * Runs once per launch before any course service starts. Asks first, copies
 * with verification and leaves the old folder in place. Never throws: on any
 * failure the app keeps using the old location and asks again next launch.
 */
export async function moveLegacyDataRoot(window: BrowserWindow): Promise<void> {
  if (process.env['BANDAL_DATA_ROOT']) return
  try {
    const db = getDatabase()
    const journalPath = join(app.getPath('userData'), 'data-root-migration.json')
    const setDataRoot = (root: string): void => { setSettings({ dataRoot: root }) }
    recoverDataRootMove(db, { journalPath, currentDataRoot: getSettings().dataRoot, setDataRoot })
    const move = planDataRootMove(db, { legacyRoot: legacyDataRoot(), newRoot: defaultDataRoot(), currentDataRoot: getSettings().dataRoot })
    if (move === null) return
    if (move.folders.length === 0) { setDataRoot(move.to); return }
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', buttons: ['옮기기', '나중에'], defaultId: 0, cancelId: 1,
      message: '자료 폴더를 옮길게요',
      detail: `'문서' 폴더가 iCloud나 OneDrive와 동기화되면 파일이 비워져 반달이 자료를 열지 못할 수 있어요. 과목 폴더를 이 컴퓨터의 반달 전용 폴더로 복사해 옮깁니다.\n\n새 위치: ${move.to}\n원래 폴더(${move.from})는 지우지 않고 그대로 둡니다. 아직 내려받지 않은 파일이 있으면 먼저 내려받으므로 인터넷 연결이 필요할 수 있어요.`
    })
    if (response !== 0) return
    try {
      await moveDataRoot(db, move, { journalPath, setDataRoot, progress: (done, total) => window.setProgressBar(total > 0 ? done / total : 2) })
    } catch (error) {
      console.error('[dataRoot] move failed', error)
      void dialog.showMessageBox(window, { type: 'warning', message: '자료 폴더를 옮기지 못했어요',
        detail: `${reason(error)}\n\n지금은 원래 위치를 그대로 씁니다. 다음에 반달을 열 때 다시 시도합니다.` })
      return
    } finally { window.setProgressBar(-1) }
    await copyClaudeProjects(move.folders, process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'))
      .catch(error => console.warn('[dataRoot] Claude session folders were not copied', error))
    void dialog.showMessageBox(window, { type: 'info', buttons: ['확인', '원래 폴더 보기'], defaultId: 0,
      message: '자료 폴더를 옮겼어요',
      detail: `새 위치: ${move.to}\n원래 폴더는 그대로 남아 있어요. 새 위치에서 자료가 잘 열리는지 확인한 뒤 원래 폴더를 직접 지워도 됩니다.`
    }).then(({ response: choice }) => { if (choice === 1) shell.showItemInFolder(move.from) })
  } catch (error) {
    console.error('[dataRoot] legacy data root check failed', error)
  }
}
