"""Real Python/Node pipe regression; synthetic fixtures only, no network."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
BRIDGE = Path(os.environ.get('BANDAL_TEST_BRIDGE_SOURCE', ROOT / 'resources/ipad-bridge/bridge.py'))


class BridgeStdioTests(unittest.TestCase):
    def test_conflict_json_is_utf8_with_non_utf8_python_stdio(self):
        with tempfile.TemporaryDirectory(prefix='bandal-stdio-') as directory:
            root = Path(directory) / '한글 자료 📝'
            root.mkdir()
            helper = root / 'projector.cjs'
            helper.write_text("""
let input='';process.stdin.setEncoding('utf8');
process.stdin.on('data',part=>input+=part);
process.stdin.on('end',()=>{
 const value=JSON.parse(input);
 if(!value.database.includes('한글 자료 📝'))throw new Error('UTF-8 input path was corrupted');
 process.stdout.write(JSON.stringify([{id:'synthetic',recordID:'note:synthetic',kind:'note',label:'한글 노트 📝',reason:'변경된 페이지의 필기',createdAt:'2026-10-17T00:00:00Z',local:true,remote:true}]));
});
""", encoding='utf-8')
            for encoding in ('cp1252', 'ascii'):
                with self.subTest(encoding=encoding):
                    environment = {**os.environ, 'PYTHONIOENCODING': encoding, 'PYTHONUTF8': '0',
                                   'BANDAL_DESKTOP_PROJECTOR': str(helper), 'BANDAL_DESKTOP_BACKEND': str(helper),
                                   'BANDAL_DESKTOP_RUNTIME': shutil.which('node'), 'BANDAL_DESKTOP_MODULE_ROOT': str(root)}
                    result = subprocess.run([sys.executable, str(BRIDGE), 'conflicts', '--desktop-db', str(root / '자료.db'),
                                             '--exchange', str(root / '교환'), '--course-root', str(root / '강의')],
                                            env=environment, capture_output=True, timeout=20)
                    self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
                    self.assertIn('한글 노트 📝'.encode('utf-8'), result.stdout)
                    value = json.loads(result.stdout.decode('utf-8'))
                    self.assertEqual(value['conflicts'][0]['label'], '한글 노트 📝')
                    self.assertEqual(value['conflicts'][0]['reason'], '변경된 페이지의 필기')
                    self.assertEqual(value['status']['conflicts'], 1)

    def test_projector_request_and_response_preserve_unicode_and_reject_non_utf8(self):
        with tempfile.TemporaryDirectory(prefix='bandal-wire-') as directory:
            root = Path(directory)
            helper = root / 'projector.cjs'
            helper.write_text("""
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>input+=part);
process.stdin.on('end',()=>process.stdout.write(process.env.INVALID_WIRE==='1'?Buffer.from([0xff]):JSON.stringify(JSON.parse(input).request)));
""", encoding='utf-8')
            runner = """
import importlib.util,sys
s=importlib.util.spec_from_file_location('bridge',sys.argv[1]);b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
value=b.projector_call(sys.argv[2],b.Exchange(sys.argv[3]),'synthetic',{'title':'한글 제목 📝','path':'강의/노트.md','markdown':'내용 → 수정'})
sys.stdout.buffer.write(b.encoded(value))
"""
            environment = {**os.environ, 'PYTHONIOENCODING': 'cp1252', 'PYTHONUTF8': '0',
                           'BANDAL_DESKTOP_PROJECTOR': str(helper), 'BANDAL_DESKTOP_BACKEND': str(helper),
                           'BANDAL_DESKTOP_RUNTIME': shutil.which('node'), 'BANDAL_DESKTOP_MODULE_ROOT': str(root)}
            command = [sys.executable, '-c', runner, str(BRIDGE), str(root / '자료.db'), str(root / 'exchange')]
            result = subprocess.run(command, env=environment, capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            self.assertEqual(json.loads(result.stdout.decode('utf-8')), {'title': '한글 제목 📝', 'path': '강의/노트.md', 'markdown': '내용 → 수정'})
            invalid = subprocess.run(command, env={**environment, 'INVALID_WIRE': '1'}, capture_output=True, timeout=20)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn(b'UnicodeDecodeError', invalid.stderr)
            self.assertEqual(invalid.stdout, b'')


if __name__ == '__main__': unittest.main()
