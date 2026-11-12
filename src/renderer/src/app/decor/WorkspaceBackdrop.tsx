/**
 * What the glass sits on: the decor mesh and its grain, painted by
 * applyDecor.ts into `--decor-mesh` / `--decor-grain`. The iPad app's
 * NativeWorkspaceBackdrop.
 */
export function WorkspaceBackdrop(): JSX.Element {
  return <div className="workspace-backdrop" aria-hidden="true" />
}
