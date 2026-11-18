import importlib.util
import pathlib
import unittest
import tempfile
import threading
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('gateway',pathlib.Path(__file__).with_name('gateway.py'))
        cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.server=self.module.make_server(('127.0.0.1',0),'secret',self.temp.name,runner=lambda:0)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.temp.cleanup()
    def req(self,path,body=None,headers=None):
        try:return urllib.request.urlopen(urllib.request.Request(self.url+path,data=body,headers=headers or {}),timeout=3)
        except urllib.error.HTTPError as e:return e
    def test_collection_lock_is_held_inside_container(self):
        from unittest.mock import patch
        import types
        with patch.object(self.module.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)) as run:
            self.module.collect()
        command=run.call_args[0][0]
        self.assertEqual(command[3:6],['flock','-n','/data/.collection.lock'])
        self.assertIn('timeout',command)
        self.assertEqual(command[-1],'collect', 'scheduled collection must respect enabled source settings')
    def test_failed_slot_is_not_reported_as_success(self):
        import sqlite3,datetime,json
        slot=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H')
        with sqlite3.connect(pathlib.Path(self.temp.name)/'jobs.sqlite') as con:
            con.execute('INSERT INTO jobs VALUES(?,?,NULL)',(slot,'failed'))
        r=self.req('/internal/collect',json.dumps({'slot':slot}).encode(),{'x-radar-gateway':'secret'})
        self.assertEqual(r.code,500)
        self.assertIn(b'failed',r.read())
    def test_overload_is_rejected_before_creating_a_handler_thread(self):
        slots=self.server.request_slots
        for _ in range(8):self.assertTrue(slots.acquire(blocking=False))
        try:self.assertEqual(self.req('/health').code,503)
        finally:
            for _ in range(8):slots.release()
    def test_requires_gateway_secret(self):
        self.assertEqual(self.req('/health').code,401)
    def test_internal_only_accepts_recent_scheduled_slots(self):
        self.assertEqual(self.req('/internal/collect',b'{"slot":"2020-01-01T00"}',{'x-radar-gateway':'secret'}).code,400)
    def test_duplicate_slot_runs_once(self):
        import datetime,json,time
        slot=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H')
        data=json.dumps({'slot':slot}).encode()
        r=self.req('/internal/collect',data,{'x-radar-gateway':'secret'})
        self.assertEqual(r.code,202)
        r=self.req('/internal/collect',data,{'x-radar-gateway':'secret'})
        self.assertIn(r.code,(200,202))
        self.assertIn(b'duplicate',r.read())
    def test_app_authorization_not_platform_token(self):
        observed=[]
        class Upstream(__import__('http.server',fromlist=['BaseHTTPRequestHandler']).BaseHTTPRequestHandler):
            def do_GET(self):
                observed.append(dict(self.headers));self.send_response(200);self.end_headers();self.wfile.write(b'ok')
            def log_message(self,*args):pass
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        threading.Thread(target=upstream.serve_forever,daemon=True).start()
        self.server.upstream_port=upstream.server_port
        try:
            r=self.req('/health',headers={'x-radar-gateway':'secret','x-radar-auth':'Bearer admin','Authorization':'Bearer platform'})
            self.assertEqual(r.read(),b'ok')
            h={k.lower():v for k,v in observed[0].items()}
            self.assertEqual(h['authorization'],'Bearer admin')
            self.assertNotIn('x-radar-gateway',h)
        finally:upstream.shutdown();upstream.server_close()
if __name__=='__main__':unittest.main()
