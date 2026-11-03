import { bootstrapAppearance } from './app/bootstrapAppearance'
import { installWorkspaceTransition } from './features/documents/workspaceTransition'
import React from 'react'
import ReactDOM from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import { AppShell } from './app/AppShell'
import { ConfirmDialogProvider } from './components/ui/confirm-dialog'
import { TooltipProvider } from './components/ui/tooltip'
import { RendererErrorBoundary } from './app/RendererErrorBoundary'
// tokens.css pulls in every theme (styles/themes/index.css) — entry points
// never list themes individually.
// tailwind.css first: it declares the cascade layer order (theme, base, …).
import './styles/tailwind.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/legacy-controls.css'

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
        <TooltipProvider>
          <ConfirmDialogProvider>
            <AppShell />
          </ConfirmDialogProvider>
        </TooltipProvider>
      </RendererErrorBoundary>
    </React.StrictMode>
  )
)
