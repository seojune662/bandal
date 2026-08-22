import React from 'react'
import ReactDOM from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './styles/tokens.css'
import './styles/base.css'
import './features/pip/pip.css'
import { PipPlayerApp } from './features/pip/PipPlayerApp'
import { PipToolbarApp } from './features/pip/PipToolbarApp'

const params = new URLSearchParams(location.search)
const view = params.get('view') === 'toolbar' ? 'toolbar' : 'player'

document.documentElement.dataset['theme'] = 'dark'
document.documentElement.dataset['palette'] = 'bandal'
document.documentElement.dataset['pipView'] = view

function playerTitle(relPath: string): string {
  return params.get('title') ?? relPath.split('/').at(-1) ?? relPath
}

function PipEntry(): JSX.Element {
  if (view === 'toolbar') return <PipToolbarApp />

  const courseId = params.get('course') ?? ''
  const relPath = params.get('rel') ?? ''
  return (
    <PipPlayerApp
      courseId={courseId}
      relPath={relPath}
      title={playerTitle(relPath)}
    />
  )
}

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PipEntry />
  </React.StrictMode>
)
