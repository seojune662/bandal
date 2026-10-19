/** A durable share-sheet delivery; source paths never cross into the renderer. */
export interface SharedMaterialRequest {
  id: string
  createdAt: string
  files: { name: string; size: number }[]
}
