import { describe, expect, test } from 'vitest'
import { AGENT_TOOL_DEFINITIONS } from '../../../src/main/features/agentTools/schemas'

function definition(name: string) {
  const found = AGENT_TOOL_DEFINITIONS.find((tool) => tool.name === name)
  if (found === undefined) throw new Error(`missing tool definition: ${name}`)
  return found
}

describe('add_shapes agent tool schema', () => {
  test('accepts the textbox text-style keys with closed enums', () => {
    const shapes = definition('add_shapes').inputSchema.properties?.shapes as {
      items: { properties: { style: { properties: Record<string, object>; additionalProperties: boolean } } }
    }
    const style = shapes.items.properties.style

    expect(style.additionalProperties).toBe(false)
    expect(style.properties).toMatchObject({
      bold: { type: 'boolean' },
      italic: { type: 'boolean' },
      underline: { type: 'boolean' },
      strike: { type: 'boolean' },
      align: { type: 'string', enum: ['left', 'center', 'right'] },
      fill: {
        type: 'string',
        enum: ['ink', 'red', 'orange', 'yellow', 'green', 'blue', 'violet']
      }
    })
  })
})

describe('material link agent tool schemas', () => {
  test('defines link_materials as a creation with an optional label', () => {
    expect(definition('link_materials')).toMatchObject({
      description: '두 자료를 서로 연결해요',
      inputSchema: {
        required: ['courseId', 'fromRelPath', 'toRelPath'],
        properties: {
          courseId: { type: 'string' },
          fromRelPath: { type: 'string' },
          toRelPath: { type: 'string' },
          label: { type: 'string' }
        }
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    })
  })

  test('defines list_links as read-only', () => {
    expect(definition('list_links')).toMatchObject({
      inputSchema: {
        required: ['courseId', 'relPath'],
        properties: {
          courseId: { type: 'string' },
          relPath: { type: 'string' }
        }
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    })
  })
})
