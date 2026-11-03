import * as React from 'react'

import { cn } from '../../lib/utils'

const inputClassName =
  'w-full min-w-0 rounded-sm border border-border-strong bg-background px-3 text-sm text-foreground transition-[border-color] duration-(--dur-fast) placeholder:text-muted-foreground hover:border-muted-foreground/60 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive'

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
  function Input({ className, type = 'text', ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(inputClassName, 'h-(--control-height)', className)}
        {...props}
      />
    )
  }
)

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(inputClassName, 'min-h-16 py-2 leading-normal', className)}
        {...props}
      />
    )
  }
)

export { Input, Textarea }
