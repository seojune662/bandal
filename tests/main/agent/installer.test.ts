import { describe, expect, test } from 'vitest'
import {
  CLAUDE_INSTALL_COMMAND,
  CODEX_INSTALL_COMMAND,
  createAgentInstaller
} from '../../../src/main/features/agent/installer'

describe('agent installer command disclosure', () => {
  test('returns the exact official Claude installer command', () => {
    const result = createAgentInstaller().commandFor('claude-code')
    expect(result.command).toBe('curl -fsSL https://claude.ai/install.sh | bash')
    expect(result.command).toBe(CLAUDE_INSTALL_COMMAND)
  })

  test('returns the exact Codex npm command and checks npm support', () => {
    const result = createAgentInstaller().commandFor('codex')
    expect(result.command).toBe('npm install -g @openai/codex')
    expect(result.command).toBe(CODEX_INSTALL_COMMAND)
    // Tests themselves run under pnpm/node, so the login-shell npm is present.
    expect(result.supported).toBe(true)
  })
})
