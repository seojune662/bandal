export type MaterialView = 'icons' | 'list' | 'columns' | 'gallery' | 'compact'
export type MaterialSortOrder = 'name' | 'modified' | 'kind'
export const MATERIAL_VIEW_STORAGE_KEY = 'bandal:materials:view'
export const MATERIAL_SORT_STORAGE_KEY = 'bandal:materials:sort'

export function readMaterialView(): MaterialView {
  try {
    const value = window.localStorage.getItem(MATERIAL_VIEW_STORAGE_KEY)
    if (value === 'icons' || value === 'columns' || value === 'gallery' || value === 'compact') return value
  } catch { /* View selection still works when storage is unavailable. */ }
  return 'list'
}

export function readMaterialSort(): MaterialSortOrder {
  try {
    const value = window.localStorage.getItem(MATERIAL_SORT_STORAGE_KEY)
    if (value === 'modified' || value === 'kind') return value
  } catch { /* Optional preference. */ }
  return 'name'
}

export function rememberMaterialSort(value: MaterialSortOrder): void {
  try { window.localStorage.setItem(MATERIAL_SORT_STORAGE_KEY, value) } catch { /* Keep the current session. */ }
}

export function rememberMaterialView(value: MaterialView): void {
  try { window.localStorage.setItem(MATERIAL_VIEW_STORAGE_KEY, value) } catch { /* Keep the current session's selection. */ }
}
