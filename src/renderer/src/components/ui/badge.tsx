import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-px text-2xs font-medium whitespace-nowrap [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border-strong text-secondary-foreground',
        info: 'bg-status-info/12 text-status-info',
        success: 'bg-status-success/12 text-status-success',
        warning: 'bg-highlight/45 text-foreground',
        destructive: 'bg-destructive-muted text-destructive'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & VariantProps<typeof badgeVariants>): JSX.Element {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }
export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>
