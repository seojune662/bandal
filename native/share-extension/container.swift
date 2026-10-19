import Foundation
let configURL = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("config.json")
guard let data = try? Data(contentsOf: configURL), let config = try? JSONSerialization.jsonObject(with: data) as? [String: String],
      let group = config["appGroup"] else {
    fputs("Cannot resolve Bandal App Group\n", stderr)
    exit(1)
}
if CommandLine.arguments.contains("--self-test") { print("bandal-share-inbox:ok"); exit(0) }
guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { fputs("Cannot resolve Bandal App Group\n", stderr); exit(1) }
let inbox = container.appendingPathComponent("ShareInbox", isDirectory: true)
do { try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]); print(inbox.path) }
catch { fputs("Cannot create Bandal share inbox\n", stderr); exit(1) }
