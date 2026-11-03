import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import * as Slot from 'radix-ui/slot'

import { cn } from '../../lib/utils'

// Structure from Orca's components/ui/button.tsx (MIT); colors and heights use
// Bandal tokens. `secondary` reproduces the legacy `.secondary-button` look.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,opacity] duration-(--dur-fast) ease-(--ease-out) disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/88',
        secondary:
          'border border-border-strong bg-secondary text-secondary-foreground hover:border-primary hover:text-foreground',
        outline:
          'border border-border-strong bg-transparent text-foreground hover:bg-accent',
        ghost: 'text-secondary-foreground hover:bg-accent hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        'destructive-outline':
          'border border-destructive/45 bg-transparent text-destructive hover:bg-destructive-muted',
        link: 'h-auto px-0 text-foreground underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-(--button-height) px-4 text-sm has-[>svg]:px-3',
        sm: 'h-(--control-height) gap-1.5 px-3 text-xs has-[>svg]:px-2.5',
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        icon: 'size-(--icon-button-size)',
        'icon-sm': "size-7 [&_svg:not([class*='size-'])]:size-3.5"
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

type ButtonProps = React.ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'default', asChild = false, type, ...props },
  ref
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      // Plain <button> defaults to submit; settings forms must opt in.
      type={asChild ? type : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
})

export { Button, buttonVariants }
export type { ButtonProps }
