import AppKit
import UniformTypeIdentifiers

private let maximumBytes = 1024 * 1024 * 1024

@objc(ShareViewController)
final class ShareViewController: NSViewController {
    private let status = NSTextField(wrappingLabelWithString: "공유한 자료를 반달로 가져옵니다.")
    private var sendButton: NSButton!
    private var delivery: URL?
    private var started = false
    private var cancelled = false
    private var stagingTask: Task<Void, Never>?

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 170))
        let title = NSTextField(labelWithString: "반달에 추가")
        title.font = .boldSystemFont(ofSize: 18)
        status.font = .systemFont(ofSize: 13)
        sendButton = NSButton(title: "과목과 폴더 선택", target: self, action: #selector(send))
        sendButton.bezelStyle = .rounded
        sendButton.keyEquivalent = "\r"
        let cancel = NSButton(title: "취소", target: self, action: #selector(cancelShare))
        cancel.bezelStyle = .rounded
        let buttons = NSStackView(views: [cancel, sendButton])
        buttons.orientation = .horizontal
        let stack = NSStackView(views: [title, status, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22), stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20)])
    }

    @objc private func cancelShare() {
        cancelled = true
        stagingTask?.cancel()
        if let directory = delivery { try? FileManager.default.removeItem(at: directory) }
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    @objc private func send() {
        guard !started else { return }
        started = true
        sendButton.isEnabled = false
        status.stringValue = "자료를 준비하고 있습니다…"
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        stagingTask = Task {
            do {
                let directory: URL
                if let existing = delivery { directory = existing } else { directory = try await stage(items) }
                await MainActor.run {
                    guard !self.cancelled else { try? FileManager.default.removeItem(at: directory); return }
                    self.delivery = directory
                    let url = URL(string: "bandal://share/inbox/\(directory.lastPathComponent)")!
                    // NSWorkspace is extension-safe on macOS; iOS UIApplication is not used.
                    if NSWorkspace.shared.open(url) {
                        self.extensionContext?.completeRequest(returningItems: nil)
                    } else {
                        self.status.stringValue = "반달을 열지 못했습니다. 앱을 연 뒤 다시 시도해 주세요."
                        self.started = false
                        self.sendButton.isEnabled = true
                    }
                }
            } catch {
                await MainActor.run {
                    guard !self.cancelled else { return }
                    self.status.stringValue = error.localizedDescription
                    self.started = false
                    self.sendButton.isEnabled = true
                }
            }
        }
    }

    private func stage(_ items: [NSExtensionItem]) async throws -> URL {
        let manager = FileManager.default
        guard let group = Bundle.main.object(forInfoDictionaryKey: "BandalShareAppGroup") as? String,
              let container = manager.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw failure("공유 공간을 열 수 없습니다. 반달을 한 번 실행한 뒤 다시 시도해 주세요.")
        }
        let id = UUID().uuidString.lowercased()
        let directory = container.appendingPathComponent("ShareInbox", isDirectory: true).appendingPathComponent(id, isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var names: [String] = []
        var texts: [String] = []
        var total = 0
        func save(_ data: Data, name: String) throws {
            total += data.count
            guard total <= maximumBytes else { throw failure("한 번에 1GB까지 공유할 수 있습니다.") }
            let name = uniqueName(name, in: directory)
            try data.write(to: directory.appendingPathComponent(name), options: .atomic)
            names.append(name)
        }
        do {
            let providers = items.flatMap { $0.attachments ?? [] }
            guard providers.count <= 100 else { throw failure("한 번에 100개까지 공유할 수 있습니다.") }
            for item in items {
                if let text = item.attributedContentText?.string, !text.isEmpty { texts.append(text) }
            }
            for provider in providers {
                try Task.checkCancellation()
                if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                    let value = try await load(provider, type: UTType.fileURL.identifier)
                    let url = (value as? URL) ?? (value as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                    guard let url, url.isFileURL else { throw failure("공유 파일을 읽을 수 없습니다.") }
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard values.isRegularFile == true else { throw failure("폴더 대신 파일을 선택해 주세요.") }
                    total += values.fileSize ?? maximumBytes + 1
                    guard total <= maximumBytes else { throw failure("한 번에 1GB까지 공유할 수 있습니다.") }
                    let name = uniqueName(url.lastPathComponent, in: directory)
                    try manager.copyItem(at: url, to: directory.appendingPathComponent(name))
                    names.append(name)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    let value = try await load(provider, type: UTType.url.identifier)
                    if let url = value as? URL { texts.append(url.absoluteString) }
                    else if let text = value as? String { texts.append(text) }
                    else { throw failure("공유 링크를 읽을 수 없습니다.") }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    let type = provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true } ?? UTType.image.identifier
                    let value = try await load(provider, type: type)
                    if let data = value as? Data { try save(data, name: "\(provider.suggestedName ?? "사진").\(UTType(type)?.preferredFilenameExtension ?? "png")") }
                    else if let image = value as? NSImage, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) { try save(png, name: "사진.png") }
                    else if let url = value as? URL { try save(Data(contentsOf: url), name: url.lastPathComponent) }
                    else { throw failure("공유 사진을 읽을 수 없습니다.") }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    let value = try await load(provider, type: UTType.plainText.identifier)
                    if let text = value as? String { texts.append(text) }
                    else if let data = value as? Data, let text = String(data: data, encoding: .utf8) { texts.append(text) }
                    else { throw failure("공유 텍스트를 읽을 수 없습니다.") }
                } else {
                    // PDF/data-only providers (e.g. chat attachments) may not vend a file URL.
                    guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .data) == true }) else { throw failure("이 자료 형식은 공유할 수 없습니다.") }
                    let value = try await load(provider, type: type)
                    if let url = value as? URL { try save(Data(contentsOf: url), name: provider.suggestedName ?? url.lastPathComponent) }
                    else if let data = value as? Data { try save(data, name: "\(provider.suggestedName ?? "공유 자료").\(UTType(type)?.preferredFilenameExtension ?? "bin")") }
                    else { throw failure("공유 자료를 읽을 수 없습니다.") }
                }
            }
            let text = Array(NSOrderedSet(array: texts)) as? [String] ?? texts
            if !text.isEmpty { try save(Data(text.joined(separator: "\n\n").utf8), name: "공유한 내용.md") }
            guard !names.isEmpty, names.count <= 100 else { throw failure("공유할 자료가 없거나 100개를 초과했습니다.") }
            try Task.checkCancellation()
            let manifest: [String: Any] = ["version": 1, "id": id, "createdAt": ISO8601DateFormatter().string(from: Date()), "files": names]
            try JSONSerialization.data(withJSONObject: manifest).write(to: directory.appendingPathComponent("manifest.json"), options: .atomic)
            return directory
        } catch {
            try? manager.removeItem(at: directory)
            throw error
        }
    }
    private func load(_ provider: NSItemProvider, type: String) async throws -> NSSecureCoding {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in
                if let error { continuation.resume(throwing: error) }
                else if let value { continuation.resume(returning: value) }
                else { continuation.resume(throwing: self.failure("공유 자료를 읽을 수 없습니다.")) }
            }
        }
    }
    private func uniqueName(_ value: String, in directory: URL) -> String {
        let cleaned = (value as NSString).lastPathComponent.replacingOccurrences(of: ":", with: "_").replacingOccurrences(of: "\\", with: "_")
        let name = cleaned.isEmpty || cleaned == "." || cleaned == ".." || cleaned == "manifest.json" ? "공유 자료" : cleaned
        let ext = (name as NSString).pathExtension
        let stem = (name as NSString).deletingPathExtension
        var candidate = name
        var index = 2
        while FileManager.default.fileExists(atPath: directory.appendingPathComponent(candidate).path) {
            candidate = "\(stem) (\(index))\(ext.isEmpty ? "" : "." + ext)"
            index += 1
        }
        return candidate
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "com.bandal.share", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
