import type { LearningBinding } from '../../../../shared/types/learning'
import { Icon } from '../../app/icons'
import { useLearningProject } from './useLearningProject'
import { openLearningResource } from './learningNavigation'

/** Folder preview uses the same resource identities as the right materials list. */
export function ProjectFolderContents({ binding }: { binding: LearningBinding }): JSX.Element {
  const { project, loading, error } = useLearningProject(binding)
  const placement = { kind: 'project' as const, ...binding }
  return <div className="project-folder-contents">
    {loading && !project && <p role="status">불러오는 중…</p>}
    {error && <p role="alert">{error}</p>}
    {project && <ul>
      {project.articles.map(article => <li key={article.id}><button onClick={() => openLearningResource(binding, { kind: 'article', id: article.id }, placement)}><Icon name="fileText" /><span>{article.title}</span></button></li>)}
      {project.purpose === 'english-reading' && <li><button onClick={() => openLearningResource(binding, { kind: 'vocabulary' }, placement)}><Icon name="fileText" /><span>단어장</span></button></li>}
      {project.artifacts.map(artifact => <li key={artifact.id}><button onClick={() => openLearningResource(binding, { kind: 'artifact', id: artifact.id }, placement)}><Icon name="fileText" /><span>{artifact.title}</span></button></li>)}
      {!project.articles.length && !project.artifacts.length && project.purpose !== 'english-reading' && <li><p>아직 자료가 없어요.</p></li>}
    </ul>}
  </div>
}
