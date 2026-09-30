import { useEffect, useState } from 'react'
import { invoke } from '../../lib/ipc'
import type { BrowserProfile } from '../../../../shared/types/browserProfile'
export function BrowserProfileSelect({ value, onChange }: { value: string; onChange: (id: string) => void }): JSX.Element {
  const [profiles, setProfiles] = useState<BrowserProfile[]>([])
  useEffect(() => { void invoke('browser:profiles', {}).then(setProfiles).catch(console.error) }, [])
  return <label>브라우저 프로필 <select aria-label="설정할 브라우저 프로필" value={value} onChange={e => onChange(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}</select></label>
}
