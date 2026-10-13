export const LIMITS = { file: 50 * 1024 * 1024, bundle: 200 * 1024 * 1024, count: 100, previews: 3 } as const
export class MarketError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MarketError('invalid_text')
  return value.normalize('NFC').trim()
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new MarketError('invalid_id')
  return value
}
export const MIME: Record<string, string> = {
  pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}
export function safePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 400) throw new MarketError('invalid_path')
  const path = value
  if (/[\\\x00-\x1f\x7f:*?"<>|]/.test(path) || path.startsWith('/') || path.split('/').length > 12 || path.split('/').some(p => !p || p.startsWith('.') || /[. ]$/.test(p) || p.length > 120 || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new MarketError('invalid_path')
  const ext = path.split('.').pop()!.toLowerCase()
  if (!MIME[ext]) throw new MarketError('unsupported_file')
  return path
}
export interface FileInput { id: string; path: string; bytes: number; sha256: string; mime: string; preview?: boolean }
export function validateFiles(value: unknown): FileInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.count + LIMITS.previews) throw new MarketError('invalid_file_count')
  let bytes = 0, previews = 0
  const paths = new Set<string>(), ids = new Set<string>()
  const files = value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new MarketError('invalid_file')
    const f = raw as FileInput, path = safePath(f.path), id = uuid(f.id), mime = MIME[path.split('.').pop()!.toLowerCase()]!
    const pathKey = path.normalize('NFC').toLowerCase()
    if (paths.has(pathKey) || ids.has(id) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > LIMITS.file || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new MarketError('invalid_file')
    if (f.preview && (mime !== 'image/png' || f.bytes > 4*1024*1024)) throw new MarketError('preview_must_be_image')
    for (const existing of paths) if (existing.startsWith(`${pathKey}/`) || pathKey.startsWith(`${existing}/`)) throw new MarketError('path_collision')
    paths.add(pathKey); ids.add(id); bytes += f.bytes; previews += f.preview ? 1 : 0
    return { id, path, bytes: f.bytes, sha256: f.sha256, mime, preview: f.preview === true }
  })
  if (bytes > LIMITS.bundle || previews > LIMITS.previews || files.length-previews > LIMITS.count || files.every(f => f.preview)) throw new MarketError('bundle_limit')
  return files
}
export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const digest = await crypto.subtle.digest('SHA-256', raw as BufferSource)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
export function base64url(bytes: Uint8Array): string {
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
export function randomToken(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))) }
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
/** Validate structure, never claim this is antivirus scanning. */
export function inspectBytes(path: string, bytes: Uint8Array): void {
  const ext = safePath(path).split('.').pop()!.toLowerCase()
  const begins = (...expected: number[]) => expected.every((v, i) => bytes[i] === v)
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end))
  if (ext === 'pdf' && ascii(0, 5) === '%PDF-') return
  if (ext === 'png' && begins(137,80,78,71,13,10,26,10)) return
  if (['jpg','jpeg'].includes(ext) && begins(255,216,255)) return
  if (ext === 'webp' && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return
  if (ext === 'txt' || ext === 'md') {
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (!text.includes('\0')) return } catch { /* reject */ }
  }
  if (['docx','pptx','xlsx'].includes(ext) && begins(80,75,3,4)) { inspectOfficeZip(bytes, ext); return }
  throw new MarketError('file_content_mismatch')
}
function inspectOfficeZip(bytes: Uint8Array, ext: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i,true) === 0x06054b50) { end = i; break }
  if (end < 0 || view.getUint16(end+4,true) || view.getUint16(end+6,true)) throw new MarketError('invalid_office_archive')
  const count = view.getUint16(end+10,true); let pos = view.getUint32(end+16,true), unpacked = 0
  if (count < 1 || count > 10000 || pos >= end) throw new MarketError('invalid_office_archive')
  const names = new Set<string>()
  for (let i=0; i<count; i++) {
    if (pos+46>end || view.getUint32(pos,true)!==0x02014b50 || view.getUint16(pos+8,true)&1) throw new MarketError('invalid_office_archive')
    const packed=view.getUint32(pos+20,true), size=view.getUint32(pos+24,true), n=view.getUint16(pos+28,true), extra=view.getUint16(pos+30,true), comment=view.getUint16(pos+32,true)
    if (pos+46+n+extra+comment>end) throw new MarketError('invalid_office_archive')
    const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos+46,pos+46+n)).toLowerCase()
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /vba|activex|embeddings\/|\.(exe|dll|bin|js|vbs|ps1|com|bat)$/.test(name)) throw new MarketError('active_office_content')
    if (names.has(name) || size > LIMITS.bundle || (size>1024*1024 && size>Math.max(packed,1)*200)) throw new MarketError('office_archive_limit')
    names.add(name); unpacked+=size; if (unpacked>LIMITS.bundle) throw new MarketError('office_archive_limit')
    pos+=46+n+extra+comment
  }
  const main={docx:'word/document.xml',pptx:'ppt/presentation.xml',xlsx:'xl/workbook.xml'}[ext]!
  if (!names.has('[content_types].xml') || !names.has(main)) throw new MarketError('file_content_mismatch')
}
export function koreaDate(now: Date): string { return new Date(now.getTime()+9*3600000).toISOString().slice(0,10) }
/** Friday noon KST, postponed until first verified banking day. Unknown = no payout. */
export function settlementDue(now: Date, calendar: ReadonlyMap<string,boolean>): boolean {
  const local=new Date(now.getTime()+9*3600000)
  if (local.getUTCHours() < 12 || local.getUTCHours() >= 15) return false
  const date=koreaDate(now), friday=new Date(`${date}T00:00:00Z`)
  friday.setUTCDate(friday.getUTCDate()-((friday.getUTCDay()+2)%7))
  for (let n=0;n<7;n++) {
    const candidate=friday.toISOString().slice(0,10), business=calendar.get(candidate)
    if (business===undefined) return false
    if (business) return candidate===date
    friday.setUTCDate(friday.getUTCDate()+1)
  }
  return false
}
