import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Unregistered, tailwind-merge reads the extra `text-2xs` step as a color and
// drops it when merged with a text color class.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['2xs'] } }
})

/** Merge class names; later Tailwind utilities win (callers pass className last). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
