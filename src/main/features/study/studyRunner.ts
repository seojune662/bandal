import { existsSync } from 'node:fs'
import { basename, extname, posix } from 'node:path'
import type {
  RunStudyToolInput,
  RunStudyToolResult,
  StudyToolDefinition
} from '../../../shared/types/study'
import { ValidationError } from '../../db/errors'
import { requireId, requireNonEmptyString, resolveInside } from '../../db/validate'
import { buildStudyToolPrompt, STUDY_TOOLS } from './studyTools'

const OUTPUT_DIRECTORY = 'AI 학습자료'

export function createStudyRunner(deps: {
  getCourse: (courseId: string) => { name: string; folder: string }
  /** Sends a prompt through the course's existing agent session. */
  ask: (courseId: string, prompt: string) => Promise<void>
  recordActivity?: (courseId: string, summary: string, relPath: string) => void
}): {
  run(input: RunStudyToolInput): Promise<RunStudyToolResult>
  tools(): StudyToolDefinition[]
} {
  // A file does not exist until the streaming agent reaches its Write call.
  // Keep dispatched destinations reserved so rapid consecutive runs still get
  // the same -2/-3 collision behavior as notesRepo. A successful dispatch may
  // resolve before streaming finishes, so its reservation lasts for this
  // runner's lifetime; an asynchronously rejected dispatch releases it.
  const reservedPaths = new Set<string>()

  function tools(): StudyToolDefinition[] {
    return STUDY_TOOLS.map((tool) => ({ ...tool }))
  }

  async function run(input: RunStudyToolInput): Promise<RunStudyToolResult> {
    const courseId = requireId(input.courseId, 'courseId')
    const definition = STUDY_TOOLS.find((tool) => tool.id === input.tool)
    if (definition === undefined) {
      throw new ValidationError(`unknown study tool: ${String(input.tool)}`)
    }
    if (input.relPath === null && !definition.worksOnCourse) {
      throw new ValidationError(`${definition.label} requires a target file`)
    }

    const course = deps.getCourse(courseId)
    const targetLabel = resolveTargetLabel(course.folder, input.relPath)
    const destination = reserveDestination(
      course.folder,
      definition.label,
      input.relPath === null ? course.name : targetLabel,
      reservedPaths
    )
    const recipePrompt = buildStudyToolPrompt(input, {
      courseName: course.name,
      targetLabel: input.relPath === null ? '이 과목 전체' : targetLabel
    })
    const prompt = [
      recipePrompt,
      '',
      '## 반드시 사용할 결과 파일 경로',
      `Write 도구의 파일 경로를 ${JSON.stringify(`./${destination.relPath}`)}로 지정하라.`,
      '상위 디렉터리가 아직 없다면 생성한 뒤, 이 경로에 완성된 마크다운 문서를 저장하라.'
    ].join('\n')

    let request: Promise<void>
    try {
      request = deps.ask(courseId, prompt)
    } catch (error) {
      reservedPaths.delete(destination.absPath)
      throw error
    }

    // Deliberately do not await: Claude Code streams the turn and writes later.
    // The renderer learns that the artifact is ready from the existing material
    // tree watcher; run() only returns the collision-safe planned path.
    void request.catch(() => {
      reservedPaths.delete(destination.absPath)
    })

    deps.recordActivity?.(
      courseId,
      `${definition.label} 생성 요청 · ${targetLabel}`,
      destination.relPath
    )
    return { relPath: destination.relPath }
  }

  return { run, tools }
}

function resolveTargetLabel(courseFolder: string, relPath: string | null): string {
  if (relPath === null) return '이 과목 전체'

  const validRelPath = requireNonEmptyString(relPath, 'relPath')
  resolveInside(courseFolder, validRelPath)
  return basename(validRelPath)
}

function reserveDestination(
  courseFolder: string,
  toolLabel: string,
  targetLabel: string,
  reservedPaths: Set<string>
): { relPath: string; absPath: string } {
  const date = formatLocalDate(new Date())
  const targetStem = stripExtension(targetLabel)
  const safeTarget = sanitizeFilePart(targetStem, 72)
  const title = sanitizeFilePart(`${toolLabel} - ${safeTarget} ${date}`, 120)

  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    const fileName = suffix === 1 ? `${title}.md` : `${title}-${suffix}.md`
    const relPath = posix.join(OUTPUT_DIRECTORY, fileName)
    const absPath = resolveInside(courseFolder, relPath)
    if (!existsSync(absPath) && !reservedPaths.has(absPath)) {
      reservedPaths.add(absPath)
      return { relPath, absPath }
    }
  }

  throw new ValidationError(`could not find a free name for "${title}"`)
}

function stripExtension(fileName: string): string {
  const extension = extname(fileName)
  return extension.length === 0 ? fileName : fileName.slice(0, -extension.length)
}

function sanitizeFilePart(value: string, maxLength: number): string {
  const cleaned = value
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, maxLength)
    .trim()
  return cleaned.length > 0 ? cleaned : '학습자료'
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
