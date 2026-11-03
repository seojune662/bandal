import * as React from 'react'
import * as DropdownMenuPrimitive from 'radix-ui/dropdown-menu'

import { cn } from '../../lib/utils'
import { FLOATING_SURFACE, MENU_ITEM, OPEN_CLOSE_ANIMATION, Z_FLOATING } from './surface'

// Structure from Orca's components/ui/dropdown-menu.tsx (MIT), solid surface.
const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          FLOATING_SURFACE,
          Z_FLOATING,
          OPEN_CLOSE_ANIMATION,
          'max-h-(--radix-dropdown-menu-content-available-height) min-w-40 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto p-1',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
})

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    variant?: 'default' | 'destructive'
  }
>(function DropdownMenuItem({ className, variant = 'default', ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        MENU_ITEM,
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive-muted data-[variant=destructive]:[&_svg]:text-destructive',
        className
      )}
      {...props}
    />
  )
})

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>): JSX.Element {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
}
