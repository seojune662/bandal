import AppKit
import PhotosUI
import UniformTypeIdentifiers

if CommandLine.arguments.contains("--self-test") {
    let payload: [String: Any] = ["protocol": 1, "selfTest": true, "platform": "darwin", "format": "png"]
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: payload))
    exit(0)
}
guard CommandLine.arguments.count == 2 else { exit(2) }
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let application = NSApplication.shared
application.setActivationPolicy(.accessory)

func finish(_ paths: [String]) {
    let data = try! JSONSerialization.data(withJSONObject: paths)
    FileHandle.standardOutput.write(data)
    application.terminate(nil)
}

func exportImage(_ source: URL, _ index: Int) throws -> String {
    guard let image = NSImage(contentsOf: source), let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "BandalPhotos", code: 1)
    }
    let name = source.deletingPathExtension().lastPathComponent
    let output = destination.appendingPathComponent("\(index + 1)-\(name.isEmpty ? "사진" : name).png")
    try png.write(to: output, options: .atomic)
    return output.path
}

@available(macOS 13.0, *)
final class PickerDelegate: NSObject, PHPickerViewControllerDelegate, NSWindowDelegate {
    var window: NSWindow!
    var exporting = false
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        finish([])
        return false
    }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard !exporting else { return }
        if results.isEmpty { finish([]); return }
        exporting = true
        window.title = "사진 가져오는 중…"
        var paths: [String] = []
        var failures = 0
        // Load one asset at a time: full-resolution photos may be very large.
        func loadNext(_ index: Int) {
            if index == results.count {
                if failures > 0 {
                    let alert = NSAlert()
                    alert.messageText = "일부 사진을 가져오지 못했습니다."
                    alert.informativeText = "iCloud 사진이 다운로드되었는지 확인해 주세요. 가져온 사진은 반달에 표시됩니다."
                    alert.runModal()
                }
                finish(paths)
                return
            }
            results[index].itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, error in
                let path: String?
                if let url = url { path = try? exportImage(url, index) } else { path = nil }
                DispatchQueue.main.async {
                    if let path = path { paths.append(path) } else { failures += 1 }
                    loadNext(index + 1)
                }
            }
        }
        loadNext(0)
    }
}

var retainedDelegate: AnyObject?
if #available(macOS 13.0, *) {
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = 100
    let picker = PHPickerViewController(configuration: configuration)
    let delegate = PickerDelegate()
    picker.delegate = delegate
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 560), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.title = "반달에 사용할 사진 선택"
    window.contentViewController = picker
    window.delegate = delegate
    delegate.window = window
    retainedDelegate = delegate
    window.center()
    window.makeKeyAndOrderFront(nil)
    application.activate(ignoringOtherApps: true)
} else {
    DispatchQueue.main.async {
        let panel = NSOpenPanel()
        panel.title = "반달에 사용할 사진 선택"
        panel.message = "macOS 12에서는 이미지 파일을 선택해 주세요. 사진 앱에서는 이미지를 반달로 직접 끌어올 수 있습니다."
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        application.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK else { finish([]); return }
        finish(panel.urls.prefix(100).enumerated().compactMap { try? exportImage($0.element, $0.offset) })
    }
}
application.run()
