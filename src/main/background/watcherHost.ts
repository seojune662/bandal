import { createMaterialsWatcher } from '../features/materials/watcher'
const folders = new Map<string, string>()
const notify = (courseId: string, changes: { structural: boolean; paths: string[] }): void => {
  process.parentPort?.postMessage({ courseId, folder: folders.get(courseId), ...changes })
}
const watcher = createMaterialsWatcher({
  getCourseFolder: id => folders.get(id)!,
  onChange: notify,
  onReady: id => notify(id, { structural: true, paths: [] })
})
process.parentPort?.on('message', ({ data }: { data: { action: 'watch' | 'unwatch'; courseId: string; folder?: string } }) => {
  if (data.action === 'unwatch') { watcher.unwatch(data.courseId); folders.delete(data.courseId); return }
  if (folders.get(data.courseId) !== data.folder) watcher.unwatch(data.courseId)
  folders.set(data.courseId, data.folder!)
  watcher.watch(data.courseId)
})
