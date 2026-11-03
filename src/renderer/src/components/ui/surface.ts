// One floating-surface recipe for every portaled layer (select, menu, popover).
// Orca uses translucent glass here; Bandal keeps its solid overlay surface.
export const FLOATING_SURFACE =
  'rounded-md border border-border bg-popover text-popover-foreground shadow-md'

// Stacking: the in-app settings overlay is z-index 200 and legacy overlays top
// out near 1000. Portaled primitives sit above both.
export const Z_DIALOG = 'z-[1000]'
export const Z_FLOATING = 'z-[1100]'
export const Z_TOOLTIP = 'z-[1200]'

export const OPEN_CLOSE_ANIMATION =
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1'

export const MENU_ITEM =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground"
