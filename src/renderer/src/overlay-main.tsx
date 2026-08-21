import React from 'react'
import ReactDOM from 'react-dom/client'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>overlay</React.StrictMode>
)
