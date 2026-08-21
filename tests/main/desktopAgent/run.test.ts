import { describe, expect, it, vi } from 'vitest'
import { createDesktopRunRegistry } from '../../../src/main/features/desktopAgent/run'

describe('desktop run registry', () => {
  it('emits every visible state update', () => {
    const emit = vi.fn()
    const registry = createDesktopRunRegistry({ emit })

    registry.set('conversation-1', 'capturing', '화면을 읽는 중')

    expect(emit).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      status: 'capturing',
      action: '화면을 읽는 중'
    })
  })

  it('uses a null action when omitted', () => {
    const emit = vi.fn()
    const registry = createDesktopRunRegistry({ emit })

    registry.set('conversation-1', 'reading')

    expect(emit).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      status: 'reading',
      action: null
    })
  })

  it('clears the glass box by emitting idle', () => {
    const emit = vi.fn()
    const registry = createDesktopRunRegistry({ emit })
    registry.set('conversation-1', 'reading', '앞쪽 앱을 확인하는 중')

    registry.clear('conversation-1')

    expect(emit).toHaveBeenLastCalledWith({
      conversationId: 'conversation-1',
      status: 'idle',
      action: null
    })
  })
})
