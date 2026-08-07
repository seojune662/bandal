import type { StudyToolDefinition } from '../../../../shared/types/study'

export const FILE_REQUIRED_REASON = '파일을 선택해야 사용할 수 있어요.'

export function isStudyToolEnabled(
  tool: Pick<StudyToolDefinition, 'worksOnCourse'>,
  relPath: string | null
): boolean {
  return relPath !== null || tool.worksOnCourse
}

export function studyToolDisabledReason(
  tool: Pick<StudyToolDefinition, 'worksOnCourse'>,
  relPath: string | null
): string | null {
  return isStudyToolEnabled(tool, relPath) ? null : FILE_REQUIRED_REASON
}
