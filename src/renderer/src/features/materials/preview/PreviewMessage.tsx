import { createContext, useContext } from 'react'
import type { MaterialNode } from '../../../../../shared/types/materials'
import { MaterialFileIcon } from '../materialIcons'

export const PreviewFallbackKind = createContext<MaterialNode['kind'] | null>(null)

export function PreviewMessage({ children }: { children: string }): JSX.Element {
  const kind = useContext(PreviewFallbackKind)
  return kind === null
    ? <p className="material-preview-content__message">{children}</p>
    : <span className="material-preview-content__fallback" aria-hidden="true"><MaterialFileIcon kind={kind} /></span>
}
