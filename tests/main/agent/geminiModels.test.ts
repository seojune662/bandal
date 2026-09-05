import { describe, expect, test } from 'vitest'
import { getAgentModels } from '../../../src/main/features/agent/agentModels'

describe('Gemini model catalog', () => {
  test('returns the four CLI aliases with auto as default', async () => {
    await expect(getAgentModels('gemini')).resolves.toEqual({
      models: [
        { id: 'auto', displayName: 'Gemini 자동 선택', isDefault: true },
        { id: 'pro', displayName: 'Gemini Pro', isDefault: false },
        { id: 'flash', displayName: 'Gemini Flash', isDefault: false },
        {
          id: 'flash-lite',
          displayName: 'Gemini Flash Lite',
          isDefault: false
        }
      ]
    })
  })
})
