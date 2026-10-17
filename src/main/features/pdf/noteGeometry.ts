export function rotate(x: number, y: number, rotation: number, inverse = false) {
  switch (((inverse ? -rotation : rotation) + 360) % 360) { case 0: return { x, y }; case 90: return { x: y, y: 1 - x }; case 180: return { x: 1 - x, y: 1 - y }; case 270: return { x: 1 - y, y: x }; default: throw new Error('Unsupported PDF rotation') }
}
export function transformBox(box: any, rotation: number, inverse = false) {
  const a = rotate(box.x, box.y, rotation, inverse), b = rotate(box.x + box.width, box.y + box.height, rotation, inverse)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}
export function transformShape(shape: any, geometry: any, inverse = false) {
  const result = structuredClone(shape)
  for (const p of result.data.points ?? []) Object.assign(p, rotate(p.x, p.y, geometry.rotation, inverse))
  if (result.data.box) result.data.box = transformBox(result.data.box, geometry.rotation, inverse)
  if (geometry.rotation === 90 || geometry.rotation === 270) result.style.width *= inverse ? geometry.width / geometry.height : geometry.height / geometry.width
  return result
}
