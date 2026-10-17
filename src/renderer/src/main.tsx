import { bootstrapAppearance } from './app/bootstrapAppearance'
import { installWorkspaceTransition } from './features/documents/workspaceTransition'
import React from 'react'
import ReactDOM from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import { AccountAccessGate } from './features/account/AccountAccessGate'
import { AppShell } from './app/AppShell'
import { RendererErrorBoundary } from './app/RendererErrorBoundary'
// tokens.css pulls in every theme (styles/themes/index.css) — entry points
// never list themes individually.
import './styles/tokens.css'
import './styles/base.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}
const disposeWorkspaceTransition = installWorkspaceTransition(rootElement)
window.addEventListener('pagehide', disposeWorkspaceTransition, { once: true })

void bootstrapAppearance().then(() =>
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RendererErrorBoundary>
        <AccountAccessGate><AppShell /></AccountAccessGate>
      </RendererErrorBoundary>
    </React.StrictMode>
  )
)
