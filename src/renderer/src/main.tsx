import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppShell } from './app/AppShell'
import './styles/tokens.css'
import './styles/themes/dark-navy.css'
import './styles/themes/light.css'
import './styles/base.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
)
