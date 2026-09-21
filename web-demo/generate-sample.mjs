import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFileSync, writeFileSync } from 'node:fs'
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(readFileSync(process.env.BANDAL_CAPTURE_FONT ?? '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'), { subset: true })
  const bold = regular
  const ink = rgb(.13,.17,.16), muted = rgb(.43,.47,.43), accent = rgb(.30,.43,.34)
  for (const [idx, title] of ['해시 테이블과 충돌 해결', '서로 다른 키, 같은 인덱스', '시간 복잡도 정리'].entries()) {
    const p = doc.addPage([960,720])
    const text = (s,x,y,size=22,font=regular,color=ink) => p.drawText(s,{x,y,size,font,color})
    text('자료구조  /  03',62,651,17,bold,accent)
    text(title,62,577,39,bold)
    text('키를 배열의 인덱스로 바꾸어, 원하는 값을 빠르게 찾습니다.',62,521,22,regular,muted)
    p.drawLine({start:{x:62,y:482},end:{x:898,y:482},thickness:1,color:rgb(.83,.85,.82)})
    text('01  해시 함수',62,428,24,bold)
    text('h(key) → index',62,373,30,bold,accent)
    text('같은 키는 같은 인덱스로 연결됩니다.',62,327,21)
    for (let i=0;i<5;i++) {
      p.drawRectangle({x:535,y:391-i*54,width:310,height:46,color:i===2?rgb(.89,.93,.87):rgb(.96,.96,.94),borderColor:rgb(.84,.87,.83),borderWidth:1})
      text(String(i),556,406-i*54,18,regular,muted)
      text(['김민수','박지우','이서연','최유진','정하늘'][i],615,406-i*54,18)
    }
    text('평균 탐색 시간',62,223,17,regular,muted)
    text('O(1)',62,164,46,bold)
    text('충돌 해결 방식과 적재율에 따라 실제 비용은 달라집니다.',62,98,18,regular,muted)
    text(String(idx+1).padStart(2,'0'),862,40,14,regular,muted)
  }

const bytes = await doc.save(); writeFileSync('web-demo/public/sample.pdf', bytes)
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise
writeFileSync('web-demo/sample.ts', 'export const PDF_FINGERPRINT = '+JSON.stringify(pdf.fingerprints[0])+'\n')
await pdf.destroy()
