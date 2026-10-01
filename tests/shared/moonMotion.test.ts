import { expect, test } from 'vitest'
import { createCanvas } from 'canvas'
import geometry from '../../src/shared/moonGeometry.json'
import { moonPose, MOON_LOOP_MS, MOON_INTRO_MS } from '../../src/shared/brandMark'
test('approved 80% moons keep separate fixed pivots with no overlap through the loop', () => {
  expect(MOON_LOOP_MS).toBe(4000); expect(MOON_INTRO_MS).toBe(2000)
  expect(geometry.motion.scale).toBe(.8)
  const canvas = createCanvas(226,224), ctx = canvas.getContext('2d')
  for (let frame=0; frame<=128; frame++) {
    const pose = moonPose(frame/128), masks: Uint8ClampedArray[] = []
    geometry.shapes.forEach((shape,index) => {
      ctx.clearRect(0,0,226,224); ctx.save(); ctx.scale(.5,.5)
      const [x,y]=shape.pivot; ctx.translate(x!,y!); ctx.rotate(pose[index]! * Math.PI/180); ctx.scale(.8,.8); ctx.translate(-x!,-y!); ctx.beginPath()
      shape.points.forEach(([px,py],i) => i ? ctx.lineTo(px!,py!) : ctx.moveTo(px!,py!)); ctx.closePath(); ctx.fill(); ctx.restore(); masks.push(ctx.getImageData(0,0,226,224).data)
    })
    for(let pixel=3;pixel<masks[0]!.length;pixel+=4) if(masks[0]![pixel]! > 128) expect(masks[1]![pixel]).toBeLessThan(128)
  }
  const start = moonPose(.0001), end = moonPose(.9999)
  expect(Math.abs(start[0]/.0001-(360-end[0])/.0001)).toBeLessThan(1)
  expect(Math.abs(start[1]/.0001-(-360-end[1])/.0001)).toBeLessThan(1)
})
