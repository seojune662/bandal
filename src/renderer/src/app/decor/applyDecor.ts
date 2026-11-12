/**
 * Paints the decor onto <html>: the glass custom properties (rail, panel,
 * selection, popup, sheet, accent, mark) plus two images the backdrop uses —
 * the 3 × 3 mesh and a tile of grain. Both apps draw the window's colour
 * themselves (an Electron window, like an iPad app, does not show the
 * wallpaper), so this is the CSS translation of the iPad's
 * `NativeWorkspaceBackdrop` / `NativeGrain`.
 */

import {
  DECOR_MESH_POINTS,
  decorMeshLab,
  decorPalette,
  decorSaturation,
  decorVariables,
  oklabToRgb,
  type DecorSettings,
  type Lab
} from '../../../../shared/decor'

const meshCache = new Map<string, string>()
let grainUrl: string | null = null

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
function lerpLab(a: Lab, b: Lab, t: number): Lab { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] }
function smooth(t: number): number { return t * t * (3 - 2 * t) }

/**
 * The mesh, drawn forward: each of the four patches is cut into small cells
 * whose position follows the bowed control points and whose colour is blended
 * in OKLab with eased weights (SwiftUI's mesh uses smooth tangents, not a
 * straight bilinear ramp). Drawn small; the browser's upscale smooths it.
 */
function paintMesh(colors: Lab[]): string {
  const width = 96, height = 64, steps = 16
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return ''
  const point = (row: number, column: number): readonly [number, number] => DECOR_MESH_POINTS[row * 3 + column]!
  const color = (row: number, column: number): Lab => colors[row * 3 + column]!
  for (let patchRow = 0; patchRow < 2; patchRow++) {
    for (let patchColumn = 0; patchColumn < 2; patchColumn++) {
      const p00 = point(patchRow, patchColumn), p01 = point(patchRow, patchColumn + 1)
      const p10 = point(patchRow + 1, patchColumn), p11 = point(patchRow + 1, patchColumn + 1)
      const c00 = color(patchRow, patchColumn), c01 = color(patchRow, patchColumn + 1)
      const c10 = color(patchRow + 1, patchColumn), c11 = color(patchRow + 1, patchColumn + 1)
      const at = (u: number, v: number): [number, number] => [
        lerp(lerp(p00[0], p01[0], u), lerp(p10[0], p11[0], u), v) * width,
        lerp(lerp(p00[1], p01[1], u), lerp(p10[1], p11[1], u), v) * height
      ]
      for (let i = 0; i < steps; i++) {
        for (let j = 0; j < steps; j++) {
          const u0 = j / steps, u1 = (j + 1) / steps, v0 = i / steps, v1 = (i + 1) / steps
          const u = smooth((u0 + u1) / 2), v = smooth((v0 + v1) / 2)
          const [r, g, b] = oklabToRgb(lerpLab(lerpLab(c00, c01, u), lerpLab(c10, c11, u), v))
          context.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`
          context.beginPath()
          const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
          context.moveTo(corners[0]![0], corners[0]![1])
          for (const [x, y] of corners.slice(1)) context.lineTo(x, y)
          context.closePath()
          context.fill()
          // A hairline of the same colour hides the seams anti-aliasing leaves between cells.
          context.strokeStyle = context.fillStyle
          context.lineWidth = 0.6
          context.stroke()
        }
      }
    }
  }
  return canvas.toDataURL('image/png')
}

/** A 128 px tile of grey noise, made once. */
function paintGrain(): string {
  if (grainUrl !== null) return grainUrl
  const side = 128
  const canvas = document.createElement('canvas')
  canvas.width = side; canvas.height = side
  const context = canvas.getContext('2d')
  if (!context) return (grainUrl = '')
  const image = context.createImageData(side, side)
  for (let index = 0; index < side * side; index++) {
    const value = Math.floor(Math.random() * 256)
    image.data[index * 4] = value
    image.data[index * 4 + 1] = value
    image.data[index * 4 + 2] = value
    image.data[index * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return (grainUrl = canvas.toDataURL('image/png'))
}

export function decorMeshUrl(decor: DecorSettings, dark: boolean): string {
  const key = `${decor.palette}:${decor.intensity.toFixed(3)}:${dark ? 'd' : 'l'}`
  let url = meshCache.get(key)
  if (url === undefined) {
    url = paintMesh(decorMeshLab(decorPalette(decor.palette), dark, decorSaturation(decor)))
    if (meshCache.size > 24) meshCache.clear()
    meshCache.set(key, url)
  }
  return url
}

function prefersSolidGlass(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-transparency: reduce)').matches
}

export function applyDecor(root: HTMLElement, decor: DecorSettings, dark: boolean): void {
  const variables = decorVariables(decor, dark, prefersSolidGlass())
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
  root.dataset['decor'] = decor.palette
  // Layout-free work only: canvases are tiny and cached per palette × strength × mode.
  try {
    root.style.setProperty('--decor-mesh', `url("${decorMeshUrl(decor, dark)}")`)
    root.style.setProperty('--decor-grain', `url("${paintGrain()}")`)
  } catch {
    root.style.setProperty('--decor-mesh', 'none')
  }
}
