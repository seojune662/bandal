import * as React from 'react'
import * as ToggleGroupPrimitive from 'radix-ui/toggle-group'

import { cn } from '../../lib/utils'

// Segmented control (Orca's `segmented` toggle-group variant), Bandal look:
// raised track, the selected segment lifts onto the app background.
const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(function ToggleGroup({ className, ...props }, ref) {
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      data-slot="toggle-group"
      className={cn(
        'inline-flex w-fit items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5',
        className
      )}
      {...props}
    />
  )
})

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(function ToggleGroupItem({ className, ...props }, ref) {
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-sm px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-(--dur-fast) hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
})

export { ToggleGroup, ToggleGroupItem }
