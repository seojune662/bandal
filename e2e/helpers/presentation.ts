const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

export async function buildPptx(text: string, count = 1): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
      ${Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
    </Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?>
    <p:presentation ${P_NS} ${R_NS}>
      <p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst>
      <p:sldSz cx="9144000" cy="6858000"/>
    </p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}
    </Relationships>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  for (let index = 0; index < count; index++) zip.file(`ppt/slides/slide${index + 1}.xml`, `<?xml version="1.0"?>
    <p:sld ${P_NS} ${A_NS}>
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6858000" cy="1143000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>${text}</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}
