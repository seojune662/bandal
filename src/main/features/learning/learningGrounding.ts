import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { LearningBinding, LearningSourceRef } from '../../../shared/types/learning'
import { resolveInsideReal } from '../../db/validate'
import { extractLearningMaterialSource, type LearningMaterialSource } from './materialSource'

const normalize = (text: string): string => text.normalize('NFC').replace(/\s+/gu, ' ').trim()

/** Resolves citations inside their course, with exact retained content as evidence. */
export function createLearningGrounding(getCourseFolder: (courseId: string) => string) {
  const sourcePath = (binding: LearningBinding, ref: LearningSourceRef): string =>
    ref.pathScope === 'course' ? ref.relPath ?? '' : posix.join(binding.rootRelPath, ref.relPath ?? '')
  async function material(binding: LearningBinding, relPath: string) {
      const absPath = resolveInsideReal(getCourseFolder(binding.courseId), relPath)
      const source = await extractLearningMaterialSource(absPath)
      if (!source?.text.trim()) throw new Error('이 자료에서 학습에 사용할 텍스트를 찾지 못했어요.')
      return source
  }
  function validator(binding: LearningBinding): (ref: LearningSourceRef) => Promise<void> {
    const sources = new Map<string, Promise<LearningMaterialSource>>()
    return async ref => {
      const relPath = sourcePath(binding, ref)
      if (!sources.has(relPath)) sources.set(relPath, material(binding, relPath))
      const source = await sources.get(relPath)!
      if (ref.contentHash && ref.contentHash !== source.contentHash) throw new Error('자료가 생성할 때와 달라졌어요. 최신 자료로 다시 생성하세요.')
      const text = ref.page === undefined ? source.text : source.pages.find(page => page.page === ref.page)?.text
      if (!text || !normalize(text).includes(normalize(ref.quote))) throw new Error('학습 자료의 근거 문장이 원본에 없어요.')
      ref.contentHash = source.contentHash
    }
  }
  return {
    material, validator,
    validateMaterial: (binding: LearningBinding, ref: LearningSourceRef) => validator(binding)(ref),
    async resolve(binding: LearningBinding, ref: LearningSourceRef): Promise<{ relPath: string | null; missing: boolean }> {
      try {
        if (ref.availability === 'missing' || ref.availability === 'changed') return { relPath: null, missing: true }
        const relPath = sourcePath(binding, ref)
        const absPath = resolveInsideReal(getCourseFolder(binding.courseId), relPath)
        if ((await stat(absPath)).size > 50 * 1024 * 1024) return { relPath: null, missing: true }
        const bytes = await readFile(absPath)
        if (ref.contentHash && createHash('sha256').update(bytes).digest('hex') !== ref.contentHash) return { relPath: null, missing: true }
        return { relPath, missing: false }
      } catch { return { relPath: null, missing: true } }
    }
  }
}
