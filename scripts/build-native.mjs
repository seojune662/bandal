import calendar from './build-calendar.mjs'
import browserImport from './build-browser-import.mjs'

export default async function beforePack(context) {
  await calendar(context)
  await browserImport(context)
}
