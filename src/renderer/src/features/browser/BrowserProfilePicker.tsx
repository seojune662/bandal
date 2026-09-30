import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PROFILE_COLORS, type BrowserProfile } from '../../../../shared/types/browserProfile'
import { invoke } from '../../lib/ipc'

export function BrowserProfilePicker({ profileId, onChange }: { profileId: string; onChange: (id: string) => Promise<void> }): JSX.Element {
  const [profiles, setProfiles] = useState<BrowserProfile[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PROFILE_COLORS[0])
  const [icon, setIcon] = useState('●')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = async (): Promise<void> => setProfiles(await invoke('browser:profiles', {}))
  useEffect(() => { void refresh().catch(e => setError(String(e))) }, [open])
  const current = profiles.find(p => p.id === profileId)
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <>
    <button type="button" className="browser-profile-button" aria-label="브라우저 프로필" title={`프로필: ${current?.name ?? (profileId === 'default' ? '기본' : '프로필 선택')}`} onClick={() => setOpen(true)} style={{ color: current?.color }}>
      {current?.icon ?? '●'} <span>{current?.name ?? (profileId === 'default' ? '기본' : '프로필 선택')}</span>
    </button>
    {open && createPortal(<div className="browser-profiles-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <section className="browser-profiles-dialog" role="dialog" aria-modal="true" aria-label="브라우저 프로필 선택" onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
        <header><h2>브라우저 프로필</h2><button aria-label="닫기" onClick={() => setOpen(false)}>×</button></header>
        <p>이 탭에서 사용할 프로필을 선택하세요. 로그인과 방문 기록은 프로필마다 따로 보관됩니다.</p>
        <div className="browser-profiles-list">{profiles.map(p => <div key={p.id} className="browser-profile-row">
          <button disabled={busy} aria-pressed={p.id === profileId} onClick={() => void run(async () => { await onChange(p.id); setOpen(false) })}>
            <span style={{ color: p.color }}>{p.icon}</span> {p.name}{p.id === profileId ? ' ✓' : ''}
          </button>
          <button disabled={busy} aria-label={`${p.name} 편집`} onClick={() => { setEditing(p.id); setName(p.name); setColor(p.color); setIcon(p.icon) }}>편집</button>
          {p.id !== 'default' && <button disabled={busy} aria-label={`${p.name} 삭제`} onClick={() => void run(async () => { await invoke('browser:deleteProfile', { id: p.id }); await refresh() })}>삭제</button>}
        </div>)}</div>
        <form onSubmit={e => { e.preventDefault(); void run(async () => { await invoke('browser:saveProfile', { ...(editing ? { id: editing } : {}), name, color, icon }); setEditing(undefined); setName(''); await refresh() }) }}>
          <h3>{editing ? '프로필 편집' : '프로필 추가'}</h3>
          <label>이름<input aria-label="프로필 이름" value={name} onChange={e => setName(e.target.value)} maxLength={40} required /></label>
          <label>아이콘<input aria-label="프로필 아이콘" value={icon} onChange={e => setIcon(e.target.value)} maxLength={4} /></label>
          <label>색상<select aria-label="프로필 색상" value={color} onChange={e => setColor(e.target.value)}>{PROFILE_COLORS.map((c, i) => <option key={c} value={c}>{['초록', '파랑', '보라', '주황', '분홍'][i]}</option>)}</select></label>
          <button disabled={busy || !name.trim()} type="submit">{editing ? '저장' : '추가'}</button>
          {editing && <button type="button" onClick={() => { setEditing(undefined); setName('') }}>취소</button>}
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
    </div>, document.body)}
  </>
}
