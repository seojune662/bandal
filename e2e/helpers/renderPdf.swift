// Render using the same CoreGraphics engine as macOS Preview, then recognize
// pixels (not the PDF text layer, which can be correct while glyphs are broken).
import AppKit
import Vision
let pdf = CGPDFDocument(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL)!
let page = pdf.page(at: 1)!
let bounds = page.getBoxRect(.mediaBox)
let width = Int(bounds.width * 2), height = Int(bounds.height * 2)
let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
    bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.setFillColor(CGColor(gray: 1, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: width, height: height))
context.scaleBy(x: 2, y: 2)
context.drawPDFPage(page)
let image = context.makeImage()!
let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["ko-KR", "en-US"]
try VNImageRequestHandler(cgImage: image).perform([request])
print((request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
