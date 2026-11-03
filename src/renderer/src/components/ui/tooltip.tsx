import * as React from 'react'
import * as TooltipPrimitive from 'radix-ui/tooltip'

import { cn } from '../../lib/utils'
import { Z_TOOLTIP } from './surface'

// Delay matches the legacy components/Tooltip.tsx (300ms). Content is not
// hoverable so a tooltip never covers the control it names.
function TooltipProvider({
  delayDuration = 300,
  disableHoverableContent = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>): JSX.Element {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      disableHoverableContent={disableHoverableContent}
      {...props}
    />
  )
}

const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        // Same surface as the legacy .tooltip: overlay bg, hairline, shadow-md.
        className={cn(
          Z_TOOLTIP,
          'pointer-events-none max-w-72 rounded-sm border border-border bg-popover px-2 py-1 text-xs leading-snug text-foreground shadow-md [overflow-wrap:anywhere] animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})

/** Convenience wrapper: `<SimpleTooltip label="…"><Button …/></SimpleTooltip>`. */
function SimpleTooltip({
  label,
  side = 'top',
  children
}: {
  label: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: React.ReactElement
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

export { SimpleTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
