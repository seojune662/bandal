import { useEffect } from 'react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './styles/tokens.css'
import './styles/base.css'
import './features/overlay/overlay.css'
import type { OverlayView } from '../../shared/types/overlay'
import { OverlayOrbApp } from './features/overlay/OverlayOrbApp'
import { OverlayPopupApp } from './features/overlay/OverlayPopupApp'
import { useLocale } from './i18n'
import { useUiStore } from './stores/uiStore'

const requestedView = new URLSearchParams(location.search).get('view')
const view: OverlayView = requestedView === 'popup' ? 'popup' : 'orb'

document.documentElement.dataset['overlayView'] = view
document.documentElement.dataset['platform'] = window.bandal.platform

function OverlayEntry(): JSX.Element {
  const initTheme = useUiStore((state) => state.initTheme)
  const locale = useLocale()

  useEffect(() => {
    void initTheme().catch((error: unknown) => {
      console.error('[Bandal] 오버레이 테마를 불러오지 못했습니다.', error)
    })
  }, [initTheme])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return view === 'popup' ? <OverlayPopupApp /> : <OverlayOrbApp />
}

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <OverlayEntry />
  </React.StrictMode>
)
