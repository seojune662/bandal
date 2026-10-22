import { useState } from 'react'
import { useFeatureInventory, type PackFeatureEntry } from '../launcher/featureInventory'
import { captureLauncherContext } from '../launcher/launcherContext'
import { requestFeatureAction, type FeatureActionResult } from '../launcher/featureActions'
import { StudyResultCard } from '../chat/StudyResultCard'

/** AI packs stay with AI. Ordinary extension panels live in the app's More menu. */
export function AssistantToolsMenu(): JSX.Element {
  const { entries, loading, error } = useFeatureInventory()
  const [query, setQuery] = useState(''), [pending, setPending] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, FeatureActionResult>>({})
  const packs = entries.filter((entry): entry is PackFeatureEntry => entry.kind === 'pack')
  const run = async (entry: PackFeatureEntry): Promise<void> => {
    setPending(entry.id)
    try {
      const context = await captureLauncherContext()
      const result = await requestFeatureAction(entry, context, {
        scope: context.selection ? 'selection' : context.material?.relPath || context.binding || context.browser ? 'material' : 'course',
        onResult: result => setResults(previous => ({ ...previous, [entry.id]: result }))
      })
      setResults(previous => ({ ...previous, [entry.id]: result }))
    } catch (cause) { setResults(previous => ({ ...previous, [entry.id]: { status: 'failed', message: cause instanceof Error ? cause.message : '도구를 열지 못했어요.' } })) }
    finally { setPending(null) }
  }
  return <section className="assistant-tools" aria-label="AI 도구">
    <input type="search" placeholder="AI 도구 찾기" aria-label="AI 도구 검색" value={query} onChange={event => setQuery(event.target.value)} />
    {loading && <p role="status">도구를 불러오는 중…</p>}{error && <p role="alert">{error}</p>}
    {packs.filter(entry => `${entry.label} ${entry.description}`.toLowerCase().includes(query.toLowerCase())).map(entry => {
      const result = results[entry.id]
      return <div key={entry.id}><button type="button" disabled={pending !== null || !entry.enabled || !!entry.unavailableReason} title={entry.unavailableReason ?? entry.description} onClick={() => void run(entry)}><strong>{entry.label}</strong><small>{entry.description}</small></button>
        {result?.status === 'started' ? <StudyResultCard artifact={{ courseId: result.binding.courseId, relPath: result.binding.rootRelPath, name: entry.label, kind: 'other', learning: { binding: result.binding, runId: result.runId } }} /> : result?.status === 'dispatched' ? <StudyResultCard artifact={{ courseId: result.courseId, relPath: result.relPath, name: entry.label, kind: 'note', pending: true }} /> : result && <p role={result.status === 'failed' ? 'alert' : 'status'}>{result.message}</p>}
      </div>
    })}
    {!loading && !packs.length && <p>연결된 AI 도구가 없어요.</p>}
  </section>
}
