import shareExtension from './build-share-extension.mjs'
import photoPicker from './build-photo-picker.mjs'
import ipadBridge from './build-ipad-bridge.mjs'
import calendar from './build-calendar.mjs'
import browserImport from './build-browser-import.mjs'

export default async function beforePack(context) {
  await ipadBridge(context)
  await calendar(context)
  await browserImport(context)
  await photoPicker(context)
  await shareExtension(context)
}
