import base64
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("bandal_bridge", ROOT / "resources/ipad-bridge/bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
USER = "11111111-1111-4111-8111-111111111111"
TOKEN = "fixture." + base64.urlsafe_b64encode(json.dumps({"sub": USER}).encode()).decode().rstrip("=") + ".fixture"


def http_error(body, status=403):
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    return urllib.error.HTTPError("https://fixture.invalid/private", status, "private transport details", {}, io.BytesIO(data))


class BridgeBillingTests(unittest.TestCase):
    def request_failure(self, body, status=403):
        remote = bridge.Supabase("https://fixture.invalid", "public-fixture", USER, TOKEN)
        with patch.object(bridge.urllib.request, "build_opener", return_value=Mock(open=Mock(side_effect=http_error(body, status)))):
            with self.assertRaises(RuntimeError) as caught:
                remote.rpc("bandal_push", {"p_operation": {}})
        return str(caught.exception)

    def test_subscription_error_is_fixed_guidance_and_preserves_private_fields(self):
        message = self.request_failure({"code": "P0001", "message": "sync_subscription_required", "details": "PRIVATE_TOKEN_AND_FILENAME"})
        self.assertEqual(message, bridge.SYNC_BILLING_MESSAGES["sync_subscription_required"])
        self.assertIn("https://bandal.io/billing", message)
        self.assertNotIn("PRIVATE_TOKEN_AND_FILENAME", message)

    def test_storage_wrapped_code_is_recognized_without_disclosing_wrapper(self):
        message = self.request_failure({"statusCode": "400", "error": "DatabaseError", "message": json.dumps({"message": "sync_storage_quota_exceeded", "details": "PRIVATE_SQL"})}, 400)
        self.assertEqual(message, bridge.SYNC_BILLING_MESSAGES["sync_storage_quota_exceeded"])
        self.assertIn("hi@bandal.io", message)
        self.assertNotIn("PRIVATE_SQL", message)

    def test_unknown_malformed_oversized_and_deceptive_bodies_only_show_http_status(self):
        bodies = [
            {"message": "PRIVATE_SECRET"}, {"details": "sync_subscription_required"},
            {"message": "PRIVATE_SECRET sync_subscription_required"},
            {"message": "sync_subscription_required\nPRIVATE_SECRET"},
            {"message": {"message": "sync_subscription_required"}},
            ["sync_subscription_required"], b"not JSON PRIVATE_SECRET", b"x" * 4097,
        ]
        for body in bodies:
            with self.subTest(body_type=type(body).__name__):
                self.assertEqual(self.request_failure(body, 400), "Supabase HTTP 400")

    def test_body_reads_are_bounded_even_for_large_server_errors(self):
        stream = Mock()
        stream.read.return_value = b"x" * 4097
        stream.code = 500
        self.assertEqual(bridge.safe_sync_error(stream), "Supabase HTTP 500")
        stream.read.assert_called_once_with(4097)

    def test_rejected_push_keeps_pending_operation_and_recovery_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            exchange = bridge.Exchange(directory)
            operation = {"record": {"kind": "course"}}
            exchange.db.execute("INSERT INTO outbox(id,record_id,operation) VALUES(?,?,?)", ("pending", "course:fixture", bridge.encoded(operation)))
            exchange.db.commit()
            remote = Mock(user_id=USER)
            remote.rpc.side_effect = [{"writeAllowed": True}, RuntimeError(bridge.SYNC_BILLING_MESSAGES["sync_subscription_required"]), {"records": [], "cursor": 0, "hasMore": False}]
            try:
                result = bridge.sync_exchange(exchange, remote)
                self.assertEqual(result["access"]["reason"], "sync_subscription_required")
                self.assertEqual(remote.rpc.call_args.args[0], "bandal_pull")
                self.assertEqual(exchange.db.execute("SELECT operation FROM outbox WHERE id='pending'").fetchone()[0], bridge.encoded(operation))
                self.assertTrue(exchange.projection_pending())
            finally:
                exchange.db.close()

    def test_cli_reports_only_safe_guidance_and_keeps_work_after_a_real_http_denial(self):
        class Denied(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                payload = {"records": [], "cursor": 0, "hasMore": False} if self.path.endswith("/bandal_pull") else {"writeAllowed": False, "details": "PRIVATE_SERVER_DETAILS"}
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Denied)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                exchange = bridge.Exchange(directory)
                exchange.db.execute("INSERT INTO outbox(id,record_id,operation) VALUES(?,?,?)", ("pending", "course:fixture", bridge.encoded({"record": {"kind": "course"}})))
                exchange.db.commit()
                exchange.db.close()
                result = subprocess.run([sys.executable, str(ROOT / "resources/ipad-bridge/bridge.py"), "sync", "--exchange", directory], capture_output=True, text=True, encoding="utf-8", timeout=10,
                    env={**os.environ, "PYTHONIOENCODING": "ascii", "BANDAL_SUPABASE_URL": f"http://127.0.0.1:{server.server_port}", "BANDAL_SUPABASE_KEY": "public-fixture", "BANDAL_USER_ID": USER, "BANDAL_ACCESS_TOKEN": TOKEN})
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stderr.strip(), bridge.SYNC_BILLING_MESSAGES["sync_subscription_required"])
                self.assertNotIn("PRIVATE_SERVER_DETAILS", result.stderr + result.stdout)
                restored = bridge.Exchange(directory)
                try:
                    self.assertEqual(restored.db.execute("SELECT count(*) FROM outbox").fetchone()[0], 1)
                    self.assertTrue(restored.projection_pending())
                finally:
                    restored.db.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_expired_access_preserves_pending_writes_and_still_pulls_remote_records(self):
        with tempfile.TemporaryDirectory() as directory:
            exchange = bridge.Exchange(directory)
            operation = bridge.encoded({"record": {"kind": "course"}})
            exchange.db.execute("INSERT INTO outbox(id,record_id,operation) VALUES(?,?,?)", ("pending", "course:local", operation))
            exchange.db.commit()
            record = {"id": "course:remote", "kind": "course", "payload": base64.b64encode(bridge.encoded({"id": "remote"})).decode(), "revision": 1, "deleted": False, "formatVersion": 1}
            remote = Mock(user_id=USER)
            remote.rpc.side_effect = [{"writeAllowed": False}, {"records": [record], "cursor": 1, "hasMore": False}]
            try:
                result = bridge.sync_exchange(exchange, remote)
                self.assertEqual(result["pushed"], 0)
                self.assertEqual(result["accessWarning"], bridge.SYNC_BILLING_MESSAGES["sync_subscription_required"])
                self.assertEqual(exchange.db.execute("SELECT operation FROM outbox WHERE id='pending'").fetchone()[0], operation)
                self.assertIsNotNone(exchange.get("course:remote"))
                self.assertEqual([call.args[0] for call in remote.rpc.call_args_list], ["bandal_sync_status", "bandal_pull"])
            finally:
                exchange.db.close()

    def test_cycle_imports_remote_changes_before_reporting_expired_access(self):
        with tempfile.TemporaryDirectory() as directory:
            exchange = bridge.Exchange(directory)
            exchange.db.execute("INSERT INTO outbox(id,record_id,operation) VALUES(?,?,?)", ("pending", "course:local", bridge.encoded({"record": {"kind": "course"}})))
            exchange.db.commit()
            exchange.db.close()
            remote = Mock(user_id=USER)
            remote.rpc.side_effect = [{"writeAllowed": False}, {"records": [], "cursor": 1, "hasMore": False}]
            stages = []

            def imported(_desktop, active_exchange, _root):
                stages.append("import")
                active_exchange.finish_projection()
                return {}

            active = bridge.Exchange(directory)
            with contextlib.closing(active.db), patch.object(bridge, "Exchange", return_value=active), \
                    patch.object(sys, "argv", ["bridge.py", "cycle", "--desktop-db", "unused-fixture.sqlite", "--exchange", directory]), \
                    patch.dict(os.environ, {"BANDAL_SUPABASE_URL": "https://fixture.invalid", "BANDAL_SUPABASE_KEY": "public-fixture", "BANDAL_USER_ID": USER, "BANDAL_ACCESS_TOKEN": TOKEN}), \
                    patch.object(bridge, "Supabase", return_value=remote), \
                    patch.object(bridge, "projector_call", return_value=[]), \
                    patch.object(bridge, "export_desktop", side_effect=lambda *_: stages.append("export") or {}), \
                    patch.object(bridge, "import_desktop", side_effect=imported), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, "Bandal Sync 구독"):
                    bridge.main()
            self.assertEqual(stages, ["export", "import"])
            restored = bridge.Exchange(directory)
            try:
                self.assertEqual(restored.db.execute("SELECT count(*) FROM outbox").fetchone()[0], 1)
                self.assertFalse(restored.projection_pending())
            finally:
                restored.db.close()

    def test_empty_outbox_can_still_pull_after_access_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            exchange = bridge.Exchange(directory)
            remote = Mock(user_id=USER)
            remote.rpc.side_effect = [{"writeAllowed":False}, {"records": [], "cursor": 0, "hasMore": False}]
            try:
                self.assertEqual(bridge.sync_exchange(exchange, remote)["cursor"], 0)
                self.assertEqual([call.args[0] for call in remote.rpc.call_args_list], ["bandal_sync_status", "bandal_pull"])
            finally:
                exchange.db.close()

    def test_quota_400_is_not_mistaken_for_an_existing_asset_collision(self):
        with tempfile.TemporaryDirectory() as directory:
            exchange = bridge.Exchange(directory)
            data = b"unchanged local file"
            sha = bridge.digest(data)
            (exchange.assets / sha).write_bytes(data)
            exchange.db.execute("INSERT INTO asset_metadata(hash,metadata) VALUES(?,?)", (sha, bridge.encoded({"contentType": "application/pdf"})))
            exchange.db.commit()
            remote = bridge.Supabase("https://fixture.invalid", "public-fixture", USER, TOKEN)
            exchange.export_record("material:fixture", "material", {"id":"fixture","revision":sha,"kind":"pdf","fileName":"a.pdf","byteCount":len(data)}, {})
            opener = Mock(open=Mock(side_effect=[io.BytesIO(b'{"writeAllowed":true}'), http_error({"message": "sync_storage_quota_exceeded"}, 400), io.BytesIO(b'{"records":[],"cursor":0,"hasMore":false}')]))
            try:
                with patch.object(bridge.urllib.request, "build_opener", return_value=opener):
                    result = bridge.sync_exchange(exchange, remote)
                    self.assertEqual(result["access"]["reason"], "sync_storage_quota_exceeded")
                self.assertEqual(opener.open.call_count, 3)
                self.assertEqual((exchange.assets / sha).read_bytes(), data)
                self.assertIsNone(exchange.db.execute("SELECT value FROM metadata WHERE key=?", ("asset_uploaded:" + sha,)).fetchone())
            finally:
                exchange.db.close()


if __name__ == "__main__":
    unittest.main()
