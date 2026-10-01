import Foundation
import Security

// This signed helper performs only an explicit, OS-mediated keychain request.
// Values travel through inherited pipes and are never written to disk or logs.
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 1_048_576,
          let request = try JSONSerialization.jsonObject(with: input) as? [String: String] else { exit(2) }
    if request["operation"] == "self-test" {
        // Packaging verification never requests access to a real keychain item.
        FileHandle.standardOutput.write(Data("{\"protocol\":1,\"platform\":\"darwin\",\"selfTest\":true}".utf8))
        exit(0)
    }
    guard request["operation"] == "keychain",
          let service = request["service"],
          ["Chrome Safe Storage", "Microsoft Edge Safe Storage"].contains(service) else { exit(2) }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else { exit(3) }
    let result = ["data": data.base64EncodedString()]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
} catch {
    exit(2)
}
