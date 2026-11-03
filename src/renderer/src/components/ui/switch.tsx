import * as React from 'react'
import * as SwitchPrimitive from 'radix-ui/switch'

import { cn } from '../../lib/utils'

// Bandal's toggle look (legacy `.toggle`): raised track with a strong border,
// muted thumb that turns ink-colored when checked.
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-lg border border-border-strong bg-secondary p-[3px] transition-[background-color,border-color] duration-(--dur-fast) ease-(--ease-out) hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-selected',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-muted-foreground shadow-sm transition-[transform,background-color] duration-(--dur-base) ease-(--ease-out) data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary"
      />
    </SwitchPrimitive.Root>
  )
})

export { Switch }
