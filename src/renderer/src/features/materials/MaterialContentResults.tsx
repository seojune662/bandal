import type { SearchHit } from '../../../../shared/types/search'
import { useMaterialContentSearch } from './useMaterialContentSearch'
import { materialBaseName, materialParentPath } from './materialPaths'
import { openMaterialSearchHit } from '../search/openMaterialSearchHit'

export function MaterialContentResults({ courseId, query, search }: { courseId: string; query: string; search: ReturnType<typeof useMaterialContentSearch> }): JSX.Element {
  const status = search.indexing
  const open = (hit: SearchHit, event: React.MouseEvent): void => {
    void openMaterialSearchHit(courseId, hit, query, window.bandal?.platform === 'darwin' ? event.metaKey : event.ctrlKey)
  }
  return <section className="materials-content-results" aria-label="본문 검색 결과" aria-busy={search.pending}>
    <h3>본문 <small>{search.hits.length === 100 ? '상위 100개' : `${search.hits.length}개`}</small></h3>
    {search.pending && <p role="status">본문을 찾는 중…</p>}
    {status?.phase === 'indexing' && <p role="status">자료 검색 준비 중 · {status.processedFiles} / {status.totalFiles}개</p>}
    {status?.phase === 'partial' && <details className="materials-search-warning"><summary>일부 자료의 본문을 읽지 못했어요</summary><ul>{status.failures.map(failure => <li key={failure.relPath}>{materialBaseName(failure.relPath)} · {failure.reason}</li>)}</ul></details>}
    {search.error && <p role="alert">{search.error} <button type="button" onClick={search.retry}>다시 시도</button></p>}
    {search.hits.map(hit => <button type="button" key={`${hit.kind}:${hit.relPath}:${hit.page}`} className="materials-content-hit" onClick={event => open(hit, event)}>
      <strong>{materialBaseName(hit.relPath)}</strong>
      <small>{[hit.page ? `${hit.page}페이지` : null, materialParentPath(hit.relPath)].filter(Boolean).join(' · ')}</small>
      <span>{hit.snippet}</span>
    </button>)}
    {!search.pending && !search.error && !search.hits.length && status?.phase !== 'indexing' && <p>일치하는 본문이 없어요.</p>}
  </section>
}
