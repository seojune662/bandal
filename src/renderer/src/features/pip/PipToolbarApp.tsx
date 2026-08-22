import { useState } from 'react'
import { invoke } from '../../lib/ipc'

export function PipToolbarApp(): JSX.Element {
  const [active, setActive] = useState(false)

  // A child drag region cannot move its parent BrowserWindow. A real handle
  // belongs in v2 together with the proposed `pip:moveBy` IPC channel.
  return (
    <nav
      className={`pip-toolbar${active ? ' pip-toolbar--active' : ''}`}
      aria-label="웹 미니 플레이어 컨트롤"
      onMouseEnter={() => setActive(true)}
      onMouseMove={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      <button
        type="button"
        className="pip-toolbar__button"
        aria-label="원래 화면으로 돌아가기"
        title="돌아가기"
        onClick={() => {
          void invoke('pip:restore', {}).catch(() => undefined)
        }}
      >
        <span aria-hidden="true">↩</span>
      </button>
      <button
        type="button"
        className="pip-toolbar__button pip-toolbar__button--close"
        aria-label="미니 플레이어 닫기"
        title="닫기"
        onClick={() => {
          void invoke('pip:close', {}).catch(() => undefined)
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </nav>
  )
}
