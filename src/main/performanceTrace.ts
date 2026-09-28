/** Opt-in, bounded diagnostics: counts/durations only, never paths or content. */
interface Trace { startedAt: number; marks: Record<string, number>; ipc: Record<string, { count: number; totalMs: number; maxMs: number }> }
const trace: Trace | null = process.env['BANDAL_PERF_TRACE'] === '1'
  ? { startedAt: performance.now(), marks: {}, ipc: {} } : null
if (trace) (globalThis as typeof globalThis & { __bandalPerformance?: Trace }).__bandalPerformance = trace
export function markStartup(name: string): void { if (trace) trace.marks[name] = performance.now() - trace.startedAt }
export function traceIpc(channel: string, duration: number): void {
  if (!trace) return
  const metric = trace.ipc[channel] ??= { count: 0, totalMs: 0, maxMs: 0 }
  metric.count += 1
  metric.totalMs += duration
  metric.maxMs = Math.max(metric.maxMs, duration)
}
