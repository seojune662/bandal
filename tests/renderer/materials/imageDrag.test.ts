import { describe, expect, test } from 'vitest'
import {
  BANDAL_IMAGE_MIME,
  writeMaterialImageDragData
} from '../../../src/renderer/src/features/materials/imageDrag'

describe('material image drag data', () => {
  test('writes the ink/PDF payload, negotiable effect, and text fallback', () => {
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      setData(format: string, data: string): void {
        values.set(format, data)
      }
    }

    writeMaterialImageDragData(dataTransfer, {
      relPath: 'figures/architecture.png',
      label: 'architecture.png'
    })

    expect(dataTransfer.effectAllowed).toBe('copyMove')
    expect(JSON.parse(values.get(BANDAL_IMAGE_MIME) ?? '')).toEqual({
      relPath: 'figures/architecture.png',
      label: 'architecture.png'
    })
    expect(values.get('text/plain')).toBe('architecture.png')
  })
})
