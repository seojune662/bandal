import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]'
].join(',')

const activeTraps = new WeakMap<Document, HTMLElement[]>()

export interface FocusTrapOptions {
  active: boolean
  initialFocus?: 'first' | RefObject<HTMLElement>
  returnFocus?: boolean
  onEscape?: (() => void) | undefined
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.closest('[hidden], [inert], [aria-hidden="true"]') === null
  )
}

/** Shared by the hook and its DOM-free regression tests. */
export function handleFocusTrapKeyDown(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'defaultPrevented' | 'preventDefault'>,
  container: HTMLElement
): void {
  if (event.key !== 'Tab' || event.defaultPrevented) return

  const items = focusableElements(container)
  const first = items[0]
  const last = items.at(-1)
  if (first === undefined || last === undefined) {
    event.preventDefault()
    container.focus()
    return
  }

  const activeElement = container.ownerDocument.activeElement
  const focusIsOutside =
    activeElement === null || !container.contains(activeElement)
  if (event.shiftKey && (activeElement === first || focusIsOutside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (activeElement === last || focusIsOutside)) {
    event.preventDefault()
    first.focus()
  }
}

/** Shared by the hook and its return-focus regression test. */
export function restoreFocus(element: HTMLElement | null): void {
  if (element?.isConnected) element.focus()
}

function activeHTMLElement(document: Document): HTMLElement | null {
  const activeElement = document.activeElement
  return activeElement !== null && typeof (activeElement as HTMLElement).focus === 'function'
    ? (activeElement as HTMLElement)
    : null
}

export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T>,
  {
    active,
    initialFocus = 'first',
    returnFocus = true,
    onEscape
  }: FocusTrapOptions
): void {
  const onEscapeRef = useRef(onEscape)
  const returnFocusRef = useRef(returnFocus)
  onEscapeRef.current = onEscape
  returnFocusRef.current = returnFocus

  useEffect(() => {
    if (!active || ref.current === null) return

    const container = ref.current
    const ownerDocument = container.ownerDocument
    const previousFocus = activeHTMLElement(ownerDocument)
    let addedTabIndex = false

    const requestedFocus =
      initialFocus === 'first' ? null : initialFocus.current
    const firstFocus = focusableElements(container)[0] ?? null
    const focusTarget =
      requestedFocus !== null && container.contains(requestedFocus)
        ? requestedFocus
        : firstFocus

    if (focusTarget !== null) {
      focusTarget.focus()
    } else {
      if (!container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1')
        addedTabIndex = true
      }
      container.focus()
    }

    const traps = activeTraps.get(ownerDocument) ?? []
    traps.push(container)
    activeTraps.set(ownerDocument, traps)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (traps.at(-1) !== container) return
      if (event.key === 'Escape' && !event.defaultPrevented) {
        const escape = onEscapeRef.current
        if (escape !== undefined) {
          event.preventDefault()
          escape()
        }
        return
      }
      handleFocusTrapKeyDown(event, container)
    }

    ownerDocument.addEventListener('keydown', handleKeyDown)
    return () => {
      ownerDocument.removeEventListener('keydown', handleKeyDown)
      const trapIndex = traps.lastIndexOf(container)
      if (trapIndex >= 0) traps.splice(trapIndex, 1)
      if (traps.length === 0) activeTraps.delete(ownerDocument)
      if (addedTabIndex && container.getAttribute('tabindex') === '-1') {
        container.removeAttribute('tabindex')
      }
      if (returnFocusRef.current) restoreFocus(previousFocus)
    }
  }, [active, initialFocus, ref])
}
