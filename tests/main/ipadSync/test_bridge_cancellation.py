import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
BRIDGE = ROOT / 'resources/ipad-bridge/bridge.py'
spec = importlib.util.spec_from_file_location('cancel_bridge', BRIDGE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeCancellationTests(unittest.TestCase):
    def test_cancel_marker_prevents_next_network_request(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'cancel.flag'
            marker.touch()
            remote = bridge.Supabase.__new__(bridge.Supabase)
            with patch.dict(os.environ, {'BANDAL_CANCEL_FILE': str(marker)}), patch.object(bridge.urllib.request, 'build_opener') as opener:
                with self.assertRaises(InterruptedError): remote.request('rest/v1/rpc/bandal_push')
                opener.assert_not_called()

    def test_cancel_during_projector_waits_for_writer_before_parent_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper, started, finished, marker = [root / name for name in ('projector.py', 'started', 'finished', 'cancel.flag')]
            helper.write_text("import os,time\nfrom pathlib import Path\nroot=Path(os.environ['TEST_ROOT'])\n(root/'started').touch()\ntime.sleep(0.35)\n(root/'finished').touch()\nprint('[]')\n")
            runner = "import importlib.util,sys\ns=importlib.util.spec_from_file_location('b',sys.argv[1]);b=importlib.util.module_from_spec(s);s.loader.exec_module(b)\ne=b.Exchange(sys.argv[2]);b.projector_call(sys.argv[3],e,'conflicts')\n"
            environment = {**os.environ, 'BANDAL_DESKTOP_PROJECTOR': str(helper), 'BANDAL_DESKTOP_BACKEND': str(helper),
                           'BANDAL_DESKTOP_RUNTIME': sys.executable, 'BANDAL_DESKTOP_MODULE_ROOT': str(root),
                           'BANDAL_CANCEL_FILE': str(marker), 'TEST_ROOT': str(root)}
            process = subprocess.Popen([sys.executable, '-c', runner, str(BRIDGE), str(root / 'exchange'), str(root / 'desktop.db')], env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 5
                while not started.exists() and process.poll() is None and time.monotonic() < deadline: time.sleep(0.01)
                self.assertTrue(started.exists())
                marker.touch()
                self.assertIsNone(process.poll())
                _, errors = process.communicate(timeout=5)
                self.assertNotEqual(process.returncode, 0)
                self.assertIn(b'InterruptedError', errors)
                self.assertTrue(finished.exists(), 'the projector must finish before the parent reports cancellation')
            finally:
                if process.poll() is None: process.kill(); process.communicate()


if __name__ == '__main__': unittest.main()
