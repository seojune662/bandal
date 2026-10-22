import { createContext, useContext } from 'react'
import { AssistantPanelToggle } from '../assistantPanel/AssistantPanelToggle'
import { MaterialExportButton } from '../materials/MaterialExportButton'

export const FileToolbarContext = createContext<{ courseId: string; relPath: string } | null>(null)

export function FileToolbarActions(): JSX.Element | null {
  const ref = useContext(FileToolbarContext)
  if (!ref) return null
  return <div className="material-toolbar-actions">
    <MaterialExportButton {...ref} />
    <AssistantPanelToggle />
  </div>
}
