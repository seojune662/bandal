import JSZip from 'jszip'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildClaudeArgs } from '../../../src/main/features/agent/claude/ClaudeCodeAdapter'
import { buildCodexArgs } from '../../../src/main/features/agent/codex/CodexAdapter'
import { parseCodexModelCatalog } from '../../../src/main/features/agent/codex/modelCatalog'
import { createAgentConfirmer } from '../../../src/main/features/agentTools/confirm'
import { discoverChatSkills } from '../../../src/main/features/agent/chatSkills'
import { importChatAttachments } from '../../../src/main/features/agent/chatAttachments'
import { collectChatArtifacts, createArtifactFolder } from '../../../src/main/features/agent/chatArtifacts'

const dirs: string[] = []
async function temp(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'bandal-chat-workflow-')); dirs.push(dir); return dir }
afterEach(async () => { vi.useRealTimers(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

describe('chat settings and skill execution', () => {
  test('passes supported effort to Claude and Codex, including Codex resume', () => {
    expect(buildClaudeArgs({ effort: 'high' })).toEqual(expect.arrayContaining(['--effort', 'high']))
    expect(buildClaudeArgs({})).not.toContain('--effort')
    const codex = buildCodexArgs({ cwd: '/course', prompt: 'hello', effort: 'xhigh', resumeCliSessionId: 'previous' })
    expect(codex).toContain('model_reasoning_effort="xhigh"')
    expect(codex.indexOf('model_reasoning_effort="xhigh"')).toBeLessThan(codex.indexOf('resume'))
  })
  test('enables skill execution only on an explicitly selected skill turn', () => {
    expect(buildClaudeArgs({})).toContain('--disable-slash-commands')
    expect(buildClaudeArgs({})).toContain('Bash')
    const selected = buildClaudeArgs({ selectedSkills: ['/skills/pdf/SKILL.md'] })
    expect(selected).not.toContain('--disable-slash-commands')
    expect(selected).toEqual(expect.arrayContaining(['--permission-mode', 'default', '--permission-prompt-tool', 'stdio']))
    expect(selected).not.toContain('--dangerously-skip-permissions')
  })
  test('retains per-model effort capabilities and excludes hidden models', () => {
    const models = parseCodexModelCatalog(JSON.stringify({ models: [
      { slug: 'a', display_name: 'A', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: ';bad' }] },
      { slug: 'b', display_name: 'B', visibility: 'hidden', supported_reasoning_levels: [{ effort: 'max' }] }
    ] }), 'a')
    expect(models[0]?.supportedEfforts).toEqual(['low', 'high'])
    expect(models[1]).toMatchObject({ value: 'a', supportedEfforts: ['low', 'high'], defaultEffort: 'low' })
    expect(models).toHaveLength(2)
  })
  test('discovers real installed skills, ignores unrelated files and deduplicates symlinks', async () => {
    const root = await temp(); const skill = join(root, 'pdf')
    await mkdir(skill); await writeFile(join(skill, 'SKILL.md'), '---\nname: pdf\ndescription: PDF documents\n---\nUse the PDF tools.')
    await symlink(skill, join(root, 'linked-pdf'))
    await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'SKILL.md'), '---\nname: bad\n---')
    const skills = await discoverChatSkills('codex', undefined, [root])
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ name: 'pdf', creationKinds: ['pdf'], description: 'PDF documents' })
    expect(await discoverChatSkills('codex', undefined, [join(root, 'missing')])).toEqual([])
  })
})

describe('authoritative approval lifecycle', () => {
  const request = { courseId: 'course', conversationId: 'chat', tool: 'browser_access', summary: 'Read page', details: [], scopes: ['once', 'site'] as const }
  test('expires and broadcasts the final state; stale duplicate responses never approve', async () => {
    vi.useFakeTimers()
    const changed = vi.fn(), gate = createAgentConfirmer({ emit: vi.fn(), changed, timeoutMs: 50 })
    const outcome = gate.confirm({ ...request, scopes: [...request.scopes] })
    const id = gate.list('chat')[0]!.request.requestId
    await vi.advanceTimersByTimeAsync(51)
    expect(await outcome).toBe(false)
    expect(gate.resolve({ requestId: id, approved: true })?.status).toBe('expired')
    expect(changed.mock.calls.map(([state]) => state.status)).toEqual(['pending', 'expired'])
  })
  test('validates scope, settles once, and cancels only the owning conversation', async () => {
    const gate = createAgentConfirmer({ emit: vi.fn() })
    const first = gate.confirm({ ...request, scopes: [...request.scopes] })
    const second = gate.confirm({ ...request, conversationId: 'other', scopes: [...request.scopes] })
    const id = gate.list('chat')[0]!.request.requestId
    expect(() => gate.resolve({ requestId: id, approved: true, scope: 'always' })).toThrow()
    gate.cancelConversation('chat')
    expect(await first).toBe(false)
    expect(gate.list('other')[0]?.status).toBe('pending')
    const other = gate.list('other')[0]!.request.requestId
    expect(gate.resolve({ requestId: other, approved: true, scope: 'site' })?.status).toBe('approved')
    expect(gate.resolve({ requestId: other, approved: false })?.status).toBe('approved')
    expect(await second).toBe('site')
  })
})

describe('attachments and generated files', () => {
  test('imports asynchronously without changing originals and retains Korean names', async () => {
    const root = await temp(), course = join(root, 'course'), source = join(root, '한글 자료.txt')
    await mkdir(course); await writeFile(source, 'original')
    const [first] = await importChatAttachments(course, [source])
    const [second] = await importChatAttachments(course, [source])
    expect(first!.relPath).not.toBe(second!.relPath)
    expect(first!.name).toBe('한글 자료.txt')
    expect(await readFile(join(course, first!.relPath), 'utf8')).toBe('original')
    expect(await readFile(source, 'utf8')).toBe('original')
    await expect(importChatAttachments(course, [root])).rejects.toThrow()
  })
  test('rejects an attachment directory that escapes through a symlink', async () => {
    const root = await temp(), course = join(root, 'course'), outside = join(root, 'outside'), source = join(root, 'file.txt')
    await mkdir(course); await mkdir(outside); await writeFile(source, 'x'); await symlink(outside, join(course, '첨부'))
    await expect(importChatAttachments(course, [source])).rejects.toThrow()
  })
  test('requires an actual OOXML document, not a ZIP renamed to docx', async () => {
    const root = await temp(), dir = await createArtifactFolder(root)
    const wrong = new JSZip().file('random.txt', 'hello')
    const valid = new JSZip().file('[Content_Types].xml', '<Types/>').file('word/document.xml', '<document/>')
    await writeFile(join(root, dir, 'fake.docx'), await wrong.generateAsync({ type: 'nodebuffer' }))
    await writeFile(join(root, dir, 'real.docx'), await valid.generateAsync({ type: 'nodebuffer' }))
    expect((await collectChatArtifacts('course', root, dir, 'document')).map((file) => file.name)).toEqual(['real.docx'])
  })
  test('reports only existing output files with matching format and refuses symlink results', async () => {
    const root = await temp(), dir = await createArtifactFolder(root)
    await writeFile(join(root, dir, 'valid.pdf'), '%PDF-1.7\nfixture')
    await writeFile(join(root, dir, 'fake.pdf'), 'not a PDF')
    await writeFile(join(root, dir, 'empty.pdf'), '')
    await symlink(join(root, dir, 'valid.pdf'), join(root, dir, 'link.pdf'))
    const result = await collectChatArtifacts('course', root, dir, 'pdf')
    expect(result.map((file) => file.name)).toEqual(['valid.pdf'])
    expect(result[0]?.courseId).toBe('course')
  })
})
