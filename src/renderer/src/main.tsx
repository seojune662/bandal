import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppShell } from './app/AppShell'
import { installMockGroupsIfRequested } from './features/group/mockAdapter'
// tokens.css pulls in every theme (styles/themes/index.css) — entry points
// never list themes individually.
import './styles/tokens.css'
import './styles/base.css'

// [P2-D] `?mockGroups=1` swaps the IPC transport for a scripted fake so the
// 함께하기 surface can be built and reviewed with no Supabase project and no
// signed-in account. It is a no-op without the flag, and channels it does not
// own still go to the real bridge, so Phase 1 is unaffected either way.
installMockGroupsIfRequested()

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
)
