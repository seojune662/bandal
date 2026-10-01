import { useEffect, useRef, useState } from 'react'
import { invoke } from '../../lib/ipc'
export function ScreenSelectionApp(): JSX.Element {
  const [image, setImage] = useState(''), [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => { void invoke('assistant:selection', { action: 'get' }).then(result => setImage(result.image ?? '')); const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); void invoke('assistant:selection', { action: 'cancel' }) } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [])
  return <div className="screen-selection" style={{ position: 'fixed', inset: 0, cursor: 'crosshair', userSelect: 'none', backgroundImage: `url(${image})`, backgroundSize: '100% 100%' }} onPointerDown={event => { start.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); setRect(null) }} onPointerMove={event => { if (start.current) setRect({ x: Math.min(start.current.x, event.clientX), y: Math.min(start.current.y, event.clientY), width: Math.abs(start.current.x - event.clientX), height: Math.abs(start.current.y - event.clientY) }) }} onPointerUp={event => { const origin = start.current; start.current = null; if (origin) void invoke('assistant:selection', { action: 'select', rect: { x: Math.min(origin.x, event.clientX), y: Math.min(origin.y, event.clientY), width: Math.abs(origin.x - event.clientX), height: Math.abs(origin.y - event.clientY) } }) }}>
    <div style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', padding: '10px 16px', background: '#161616e6', color: 'white', borderRadius: 10, fontSize: 13 }}>질문할 영역을 드래그하세요 · Esc 취소</div>
    {rect && <div style={{ position: 'absolute', ...rect, border: '2px solid white', boxShadow: '0 0 0 9999px #0006', boxSizing: 'border-box' }} />}
  </div>
}
