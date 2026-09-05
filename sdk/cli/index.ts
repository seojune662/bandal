import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { inspectPluginArchive } from '../../src/shared/plugins/archive'
import { PLUGIN_ID_PATTERN } from '../../src/shared/types/plugin'

const [command, input, output] = process.argv.slice(2)
async function main(): Promise<void> {
  if (!input || !['create', 'validate', 'pack'].includes(command ?? ''))
    throw new Error(
      'Usage: pnpm plugin <create|validate|pack> <folder> [plugin-id|output.zip]',
    )
  const folder = resolve(input)
  if (command === 'create') {
    const id = output ?? `local.${basename(folder)}`
    if (!PLUGIN_ID_PATTERN.test(id) || id.length > 128)
      throw new Error('Invalid plugin id')
    if (existsSync(folder)) throw new Error('Destination already exists')
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify(
        {
          manifestVersion: 2,
          id,
          name: basename(folder),
          version: '1.0.0',
          minAppVersion: '0.42.0',
          author: 'Local developer',
          description: 'My Bandal plugin',
          main: 'main.js',
          permissions: ['commands', 'notices', 'settings'],
          contributes: {
            commands: [{ id: 'hello', title: 'Hello from my plugin' }],
            settings: [
              {
                key: 'greeting',
                title: 'Greeting',
                type: 'string',
                default: 'Hello!',
              },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    )
    writeFileSync(
      join(folder, 'main.js'),
      "module.exports = {\n  async activate(bandal) {\n    bandal.commands.register('hello', async () => {\n      await bandal.notices.show(await bandal.settings.get('greeting'));\n    });\n  }\n};\n",
    )
    console.info(`Created ${id} in ${folder}`)
    return
  }
  const zip = new JSZip()
  let fileCount = 0
  let totalBytes = 0
  let directoryCount = 0
  function add(directory: string, prefix = ''): void {
    if (++directoryCount > 200 || prefix.split('/').length > 32)
      throw new Error('Too many directories or nesting levels')
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist'
      )
        continue
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported')
      if (entry.isDirectory())
        add(join(directory, entry.name), `${prefix}${entry.name}/`)
      else if (
        /\.(js|mjs|json|html|css|svg|png|jpe?g|gif|webp|woff2|txt|md)$/i.test(
          entry.name,
        )
      ) {
        totalBytes += statSync(join(directory, entry.name)).size
        if (++fileCount > 200 || totalBytes > 8 * 1024 * 1024)
          throw new Error('Plugin exceeds 200 files or 8 MiB expanded size')
        zip.file(
          `${prefix}${entry.name}`,
          readFileSync(join(directory, entry.name)),
          { date: new Date('1980-01-01T00:00:00Z') },
        )
      }
    }
  }
  add(folder)
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })
  const { manifest, files } = await inspectPluginArchive(bytes)
  console.info(
    `Valid: ${manifest.id}@${manifest.version}, ${files.size} files, ${bytes.length} bytes`,
  )
  if (command === 'pack') {
    const destination = resolve(
      output ?? `${manifest.id}-${manifest.version}.zip`,
    )
    writeFileSync(destination, bytes, { flag: 'wx' })
    console.info(
      `Packed ${destination}\nSHA-256 ${createHash('sha256').update(bytes).digest('hex')}`,
    )
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
