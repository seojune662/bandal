using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

internal static class Program {
    // No elevation or app-bound decryption: only the current user's ordinary DPAPI.
    private static int Main() {
        byte[] encrypted = null;
        byte[] plain = null;
        try {
            var text = Console.In.ReadToEnd();
            if (text.Length > 1048576) return 2;
            var serializer = new JavaScriptSerializer();
            var request = serializer.Deserialize<Dictionary<string, string>>(text);
            if (request["operation"] == "self-test") {
                // Packaging verification never decrypts user data.
                Console.Out.Write("{\"protocol\":1,\"platform\":\"win32\",\"selfTest\":true}");
                return 0;
            }
            if (request["operation"] != "unprotect") return 2;
            encrypted = Convert.FromBase64String(request["data"]);
            plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
            Console.Out.Write(serializer.Serialize(new Dictionary<string, string> { { "data", Convert.ToBase64String(plain) } }));
            return 0;
        } catch { return 3; }
        finally {
            if (encrypted != null) Array.Clear(encrypted, 0, encrypted.Length);
            if (plain != null) Array.Clear(plain, 0, plain.Length);
        }
    }
}
