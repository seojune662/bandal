import * as React from 'react'
import { XIcon } from 'lucide-react'
import * as DialogPrimitive from 'radix-ui/dialog'

import { cn } from '../../lib/utils'
import { Z_DIALOG } from './surface'

// Structure from Orca's components/ui/dialog.tsx (MIT). Bandal look: solid
// overlay surface, --backdrop scrim, shadow-lg.
const Dialog = DialogPrimitive.Root

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    size?: 'default' | 'compact' | 'wide'
    showCloseButton?: boolean
    closeLabel?: string
  }
>(function DialogContent(
  { className, children, size = 'default', showCloseButton = true, closeLabel = 'Close', ...props },
  ref
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          Z_DIALOG,
          'fixed inset-0 bg-backdrop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0'
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        data-size={size}
        className={cn(
          Z_DIALOG,
          'fixed top-1/2 left-1/2 grid max-h-[calc(100vh-4rem)] w-full -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-lg outline-hidden duration-(--dur-base) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97]',
          'data-[size=compact]:max-w-(--dialog-width) data-[size=default]:max-w-[28rem] data-[size=wide]:max-w-[40rem]',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className="absolute top-3.5 right-3.5 inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={closeLabel}
          >
            <XIcon className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

function DialogHeader({ className, ...props }: React.ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-base leading-snug font-semibold tracking-tight', className)}
      {...props}
    />
  )
})

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  )
})

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
}
