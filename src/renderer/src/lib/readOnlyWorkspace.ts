/**
 * Set by a host that shows synced material it cannot write yet: the web app
 * at bandal.io/app in phase 1 sets `data-read-only` on <html>. Notes then
 * open non-editable and never save. The desktop never sets it.
 */
export const isReadOnlyWorkspace = (): boolean => document.documentElement.dataset.readOnly === 'true'
