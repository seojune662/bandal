import { afterEach, describe, expect, test, vi } from 'vitest'
import { observeImageVisibility } from '../../../src/renderer/src/features/ink/ImageShape'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImageShape initial visibility', () => {
  test('reports a viewport intersection before the observer callback arrives', () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800 })
    let observerCallback: IntersectionObserverCallback | null = null
    const observe = vi.fn()
    const disconnect = vi.fn()
    class Observer {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }

      observe = observe
      disconnect = disconnect
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    const element = {
      getBoundingClientRect: () => ({
        left: 20,
        top: 30,
        right: 220,
        bottom: 130,
        width: 200,
        height: 100
      })
    } as Element
    const onVisible = vi.fn()

    const release = observeImageVisibility(element, onVisible)

    expect(onVisible).toHaveBeenCalledWith(true)
    expect(observe).toHaveBeenCalledWith(element)

    const deliver = observerCallback as IntersectionObserverCallback | null
    deliver?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(onVisible).toHaveBeenLastCalledWith(false)

    release()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
