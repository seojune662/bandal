export type MaterialView = 'icons' | 'list' | 'columns' | 'gallery'
export const MATERIAL_VIEW_STORAGE_KEY = 'bandal:materials:view'

export function readMaterialView(): MaterialView {
  try {
    const value = window.localStorage.getItem(MATERIAL_VIEW_STORAGE_KEY)
    if (value === 'icons' || value === 'columns' || value === 'gallery') return value
  } catch { /* View selection still works when storage is unavailable. */ }
  return 'list'
}

export function rememberMaterialView(value: MaterialView): void {
  try { window.localStorage.setItem(MATERIAL_VIEW_STORAGE_KEY, value) } catch { /* Keep the current session's selection. */ }
}
