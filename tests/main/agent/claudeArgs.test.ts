import { describe, expect, test } from 'vitest'
import {
  buildClaudeArgs,
  CLAUDE_ALLOWED_TOOLS
} from '../../../src/main/features/agent/claude/ClaudeCodeAdapter'

/** Reads the value that follows a flag in an argv array. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function allowedRules(args: readonly string[]): string[] {
  return (valueOf(args, '--allowedTools') ?? '').split(',')
}

describe('buildClaudeArgs — write containment', () => {
  const args = buildClaudeArgs({})

  test('scopes Edit and Write to the working directory', () => {
    const rules = allowedRules(args)
    expect(rules).toContain('Edit(./**)')
    expect(rules).toContain('Write(./**)')
  })

  test('never grants a blanket Edit or Write rule', () => {
    // A bare `Edit`/`Write` rule matches every path on disk, which is what
    // let the tutor rewrite ~/.zshrc without a permission card.
    const rules = allowedRules(args)
    expect(rules).not.toContain('Edit')
    expect(rules).not.toContain('Write')
  })

  test('runs in default permission mode so unmatched writes must be approved', () => {
    // acceptEdits would auto-approve edits without consulting the renderer.
    expect(valueOf(args, '--permission-mode')).toBe('default')
    expect(args).not.toContain('acceptEdits')
  })

  test('keeps the stdio permission prompt wired up', () => {
    // Without this the out-of-course write would be denied outright rather
    // than surfacing a permission card the student can answer.
    expect(valueOf(args, '--permission-prompt-tool')).toBe('stdio')
  })

  test('still blocks Bash outright', () => {
    expect(valueOf(args, '--disallowedTools')).toBe('Bash')
  })

  test('passes the allowlist as a single comma-joined value', () => {
    // Splatting the rules as separate argv items risks them being read as
    // positional arguments in `-p` mode.
    expect(valueOf(args, '--allowedTools')).toBe(CLAUDE_ALLOWED_TOOLS.join(','))
    expect(allowedRules(args)).toHaveLength(CLAUDE_ALLOWED_TOOLS.length)
  })

  test('every path-scoped rule uses a cwd-relative glob', () => {
    // An absolute path inside a rule is read as project-relative by the CLI
    // and therefore matches nothing — verified in SPIKE-NOTES §Spike 5.
    for (const rule of CLAUDE_ALLOWED_TOOLS) {
      const scope = /\((?<scope>.*)\)/u.exec(rule)?.groups?.['scope']
      if (scope === undefined) continue
      expect(scope.startsWith('/')).toBe(false)
      expect(scope).toBe('./**')
    }
  })

  test('keeps the read-only study tools allowlisted', () => {
    const rules = allowedRules(args)
    for (const tool of ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite']) {
      expect(rules).toContain(tool)
    }
  })
})

describe('buildClaudeArgs — stream wiring', () => {
  test('keeps the verified stream-json spawn shape', () => {
    const args = buildClaudeArgs({})
    expect(args[0]).toBe('-p')
    expect(valueOf(args, '--input-format')).toBe('stream-json')
    expect(valueOf(args, '--output-format')).toBe('stream-json')
    expect(args).toContain('--include-partial-messages')
    // stream-json output in -p mode requires --verbose.
    expect(args).toContain('--verbose')
    expect(args).toContain('--disable-slash-commands')
  })

  test('omits the optional flags when nothing is supplied', () => {
    const args = buildClaudeArgs({})
    expect(args).not.toContain('--model')
    expect(args).not.toContain('--resume')
    expect(args).not.toContain('--append-system-prompt')
  })

  test.each([
    ['model', { model: '' }, '--model'],
    ['resumeCliSessionId', { resumeCliSessionId: '' }, '--resume'],
    ['systemPromptAppend', { systemPromptAppend: '' }, '--append-system-prompt']
  ] as const)('treats an empty %s as absent', (_name, opts, flag) => {
    expect(buildClaudeArgs(opts)).not.toContain(flag)
  })

  test('appends model, resume and system prompt when supplied', () => {
    const args = buildClaudeArgs({
      model: 'sonnet',
      resumeCliSessionId: 'sess-1',
      systemPromptAppend: '너는 학습 튜터야'
    })
    expect(valueOf(args, '--model')).toBe('sonnet')
    expect(valueOf(args, '--resume')).toBe('sess-1')
    expect(valueOf(args, '--append-system-prompt')).toBe('너는 학습 튜터야')
  })
})
