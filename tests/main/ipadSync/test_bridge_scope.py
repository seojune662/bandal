import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('scope_bridge', ROOT / 'resources/ipad-bridge/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeScopeTests(unittest.TestCase):
    def test_conflict_review_metadata_fits_bounded_runtime_output(self):
        item = {"id":"a"*64,"recordID":"note:one","label":"과목 · 필기","reason":"동시 수정","createdAt":"2026-10-17T00:00:00Z","local":True,"remote":True,
                "variants":{"local":{"exists":True,"deleted":False,"text":"한글"*1000,"objects":32,"revision":"b"*64},"remote":{"exists":True,"deleted":True,"text":"한글"*1000}}}
        items = bridge.conflict_summaries([item]*100)
        self.assertGreater(len(items),0)
        self.assertLess(len(items),100)
        self.assertLessEqual(len(json.dumps(items,ensure_ascii=False).encode("utf8")),200000)
        self.assertEqual(len(items[0]["variants"]["local"]["text"]),500)
        self.assertEqual(items[0]["variants"]["local"]["objects"],32)
        self.assertTrue(items[0]["variants"]["remote"]["deleted"])

    def test_deferred_head_does_not_starve_course_and_pull_preserves_future_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            e = bridge.Exchange(directory)
            try:
                e.export_record('recording:excluded', 'recording', {'id':'excluded','assetRevision':'0'*64,'fileName':'missing.wav'}, {})
                e.export_record('course:included', 'course', {'id':'included'}, {})
                operation = json.loads(e.db.execute("SELECT operation FROM outbox WHERE record_id='course:included'").fetchone()[0])
                deferred = e.db.execute("SELECT operation FROM outbox WHERE record_id='recording:excluded'").fetchone()[0]
                remote_record = {**operation['record'], 'id':'chat:future', 'kind':'chat'}
                remote = Mock(user_id='fixture')
                remote.rpc.side_effect = [{'writeAllowed':True}, {'status':'accepted','record':operation['record']}, {'records':[remote_record],'cursor':99,'hasMore':False}]
                result = bridge.sync_exchange(e, remote)
                self.assertEqual(result['pushed'],1)
                self.assertEqual(result['cursor'],99)
                self.assertEqual(e.db.execute("SELECT operation FROM outbox").fetchone()[0],deferred)
                self.assertIsNotNone(e.get('chat:future'))
                self.assertEqual(bridge.exchange_status(e)['deferred'],1)
                self.assertEqual(bridge.exchange_status(e)['pending'],0)
                remote.request.assert_not_called()
            finally: e.db.close()

    def test_scope_keeps_course_groups_and_all_material_kinds_only(self):
        self.assertTrue(bridge.in_scope({'kind':'artifact','payload':{'recordType':'desktop-course-group'}}))
        self.assertFalse(bridge.in_scope({'kind':'artifact','payload':{'recordType':'desktop-learning-file'}}))
        for kind in ('pdf','note','whiteboard','file','image'):
            self.assertTrue(bridge.in_scope({'kind':'material','payload':{'kind':kind}}))

    def test_hash_cache_invalidates_changed_same_length_source(self):
        with tempfile.TemporaryDirectory() as directory:
            e = bridge.Exchange(Path(directory)/'exchange')
            try:
                source=Path(directory)/'source';source.write_bytes(b'first')
                with patch.object(bridge,'file_hash',wraps=bridge.file_hash) as hasher:
                    first=e.file_digest(source)
                    self.assertEqual(e.file_digest(source),first)
                    self.assertEqual(hasher.call_count,1)
                    source.write_bytes(b'other')
                    self.assertNotEqual(e.file_digest(source),first)
                    self.assertEqual(hasher.call_count,2)
            finally: e.db.close()

    def test_pinned_clip_assets_include_superseded_queued_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            e=bridge.Exchange(directory)
            try:
                import base64
                first={'objects':[{'data':{'clip':{'documentRevision':'a'*64,'documentByteCount':123}}}]}
                second={'objects':[{'data':{'clip':{'documentRevision':'b'*64,'documentByteCount':456}}}]}
                for page in (first,second):
                    e.export_record('drawing:page','drawing',{'data':base64.b64encode(bridge.encoded(page)).decode()},{})
                refs=list(bridge.asset_references(e,scoped=True,include_outbox=True))
                self.assertEqual({ref[1] for ref in refs},{'a'*64,'b'*64})
            finally:e.db.close()

    def test_conflict_resolution_queues_whole_selected_page_bundle_once(self):
        with tempfile.TemporaryDirectory() as directory:
            e=bridge.Exchange(directory)
            try:
                selected={'id':'material:pdf','kind':'material','payload':{'id':'pdf','kind':'pdf','revision':'a'*64},'formatVersion':1,'deleted':False}
                page={'id':'drawing:pdf:a:1','kind':'drawing','payload':{'materialID':'pdf'},'formatVersion':1,'deleted':False}
                conflict={'id':'review','remote':selected,'local':selected,'related':{'remote':[page]},'assets':[]}
                with patch.object(bridge,'projector_call',side_effect=[[conflict],{'applied':1,'resolved':True},[],[]]):
                    self.assertTrue(bridge.resolve_conflict('db',e,'review','remote')['resolved'])
                    self.assertTrue(bridge.resolve_conflict('db',e,'review','remote')['resolved'])
                self.assertEqual(e.db.execute('SELECT count(*) FROM outbox').fetchone()[0],2)
                self.assertEqual(e.get(page['id'])['revision'],1)
            finally:e.db.close()

    def test_pending_ink_recovery_does_not_queue_a_fake_remote_envelope(self):
        with tempfile.TemporaryDirectory() as directory:
            e=bridge.Exchange(directory)
            try:
                conflict={'id':'pending-ink:a','kind':'pending-ink','local':None,'remote':None}
                with patch.object(bridge,'projector_call',side_effect=[[conflict],{'applied':1,'resolved':True,'recovered':{'relPath':'recovered.pdf'}},[]]):
                    result=bridge.resolve_conflict('db',e,conflict['id'],'local')
                    self.assertTrue(result['resolved']);self.assertEqual(result['recovered']['relPath'],'recovered.pdf')
                self.assertEqual(e.db.execute('SELECT count(*) FROM outbox').fetchone()[0],0)
            finally:e.db.close()

    def test_quota_preflight_is_specific_and_no_write_still_pulls(self):
        with tempfile.TemporaryDirectory() as directory:
            e=bridge.Exchange(directory)
            try:
                e.export_record('course:a','course',{'id':'a'},{})
                remote=Mock(user_id='fixture')
                remote.rpc.side_effect=[{'writeAllowed':True,'storageLimitBytes':5,'storageUsedBytes':5},{'records':[],'cursor':0,'hasMore':False}]
                result=bridge.sync_exchange(e,remote)
                self.assertEqual(result['access']['reason'],'sync_storage_quota_exceeded')
                self.assertEqual(bridge.exchange_status(e)['pending'],1)
                self.assertEqual([call.args[0] for call in remote.rpc.call_args_list],['bandal_sync_status','bandal_pull'])
            finally:e.db.close()

if __name__=='__main__':unittest.main()
