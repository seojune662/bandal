import { describe, expect, test } from 'vitest'
import {
  CLAUDE_INSTALL_COMMAND,
  CLAUDE_INSTALL_COMMAND_WINDOWS,
  CODEX_INSTALL_COMMAND,
  GEMINI_INSTALL_COMMAND,
  createAgentInstaller
} from '../../../src/main/features/agent/installer'
import type { BinaryLocator } from '../../../src/main/features/agent/binaryLocator'

describe('agent installer command disclosure', () => {
  test('returns the exact official Claude installer command', () => {
    const result = createAgentInstaller().commandFor('claude-code')
    // POSIX dev/CI machines see curl|bash; the Windows PowerShell variant can
    // only be asserted as the constant since commandFor reads process.platform.
    expect(result.command).toBe('curl -fsSL https://claude.ai/install.sh | bash')
    expect(result.command).toBe(CLAUDE_INSTALL_COMMAND)
    expect(result.supported).toBe(true)
    expect(CLAUDE_INSTALL_COMMAND_WINDOWS).toBe(
      'irm https://claude.ai/install.ps1 | iex'
    )
  })

  test('returns the exact Codex npm command and checks npm support', () => {
    const result = createAgentInstaller().commandFor('codex')
    expect(result.command).toBe('npm install -g @openai/codex')
    expect(result.command).toBe(CODEX_INSTALL_COMMAND)
    // Tests themselves run under pnpm/node, so the login-shell npm is present.
    expect(result.supported).toBe(true)
  })

  test('returns the exact Gemini npm command', () => {
    const result = createAgentInstaller().commandFor('gemini')
    expect(result.command).toBe('npm install -g @google/gemini-cli')
    expect(result.command).toBe(GEMINI_INSTALL_COMMAND)
    expect(result.supported).toBe(true)
  })
})

describe('agent installer locator wiring', () => {
  test('accepts the shared locator singletons for post-install verification', () => {
    // The regression this guards: the installer used to build PRIVATE
    // locators and reset those, leaving the singletons that actually serve
    // `agent:availability` caching "not installed" after a successful
    // install. The constructor must accept the shared instances.
    const stub = (): BinaryLocator => ({
      locate: async () => ({ path: '/stub', version: '9.9.9' }),
      availability: async () => ({ installed: true, loggedIn: true }),
      loginShellPath: async () => null,
      reset: () => undefined
    })
    const installer = createAgentInstaller({
      locators: {
        'claude-code': stub(),
        codex: stub(),
        gemini: stub()
      }
    })
    expect(installer.commandFor('claude-code').command).toBe(
      CLAUDE_INSTALL_COMMAND
    )
  })
})
