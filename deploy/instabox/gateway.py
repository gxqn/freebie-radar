"""Private Instabox ingress. Platform auth and application auth stay separate."""
import datetime
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import threading
import sys
from urllib.parse import urlsplit
sys.path.insert(0,str(Path(__file__).resolve().parent))
from snapshot import export_snapshot, publish_snapshot

HOP = {'connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length'}

class BoundedServer(ThreadingHTTPServer):
    def __init__(self,*args,**kwargs):
        self.request_slots=threading.BoundedSemaphore(8)
        super().__init__(*args,**kwargs)
    def process_request(self,request,address):
        if not self.request_slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nRetry-After: 30\r\nConnection: close\r\n\r\n')
            finally:self.shutdown_request(request)
            return
        try:super().process_request(request,address)
        except BaseException:self.request_slots.release();raise
    def process_request_thread(self,request,address):
        try:super().process_request_thread(request,address)
        finally:self.request_slots.release()

def collect():
    # timeout executes INSIDE the container so disconnecting docker exec cannot orphan a collector.
    cmd=['docker','exec','freebie-radar-radar-1','flock','-n','/data/.collection.lock','timeout','-s','TERM','-k','10','720','node','--no-warnings','src/server/cli.ts','collect']
    result=subprocess.run(cmd,timeout=750)
    return result.returncode

def make_server(address,secret,state_dir,runner=collect):
    if not secret:raise ValueError('gateway secret is required')
    state=Path(state_dir);state.mkdir(parents=True,exist_ok=True)
    db=state/'jobs.sqlite'
    with sqlite3.connect(db) as con:
        con.execute('CREATE TABLE IF NOT EXISTS jobs(slot TEXT PRIMARY KEY,status TEXT,finished_at TEXT)')
        con.execute("UPDATE jobs SET status='interrupted',finished_at=? WHERE status='running'",(datetime.datetime.now(datetime.timezone.utc).isoformat(),))
    lock=threading.Lock()
    def perform(slot):
        try:
            rc=runner();status='succeeded' if rc==0 else 'failed'
            if rc==0 and os.environ.get('SNAPSHOT_PUBLISH_URL'):
                try:publish_snapshot(export_snapshot())
                except Exception as exc:
                    status='collected_snapshot_failed'
                    print('snapshot_publish_failed',type(exc).__name__,flush=True)
        except Exception:status='failed'
        finally:
            try:
                with sqlite3.connect(db) as con:con.execute('UPDATE jobs SET status=?,finished_at=? WHERE slot=?',(locals().get('status','failed'),datetime.datetime.now(datetime.timezone.utc).isoformat(),slot))
            finally:lock.release()
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args):pass
        def setup(self):super().setup();self.connection.settimeout(35)
        def respond(self,status,value):
            body=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('Connection','close');self.end_headers()
            if self.command!='HEAD':self.wfile.write(body)
            self.close_connection=True
        def route(self):
            if not hmac.compare_digest(self.headers.get('x-radar-gateway',''),secret):return self.respond(401,{'error':'unauthorized'})
            if self.headers.get('Transfer-Encoding'):return self.respond(400,{'error':'unsupported_framing'})
            lengths=self.headers.get_all('Content-Length',[])
            if len(lengths)>1:return self.respond(400,{'error':'ambiguous_framing'})
            try:length=int(lengths[0]) if lengths else 0
            except ValueError:return self.respond(400,{'error':'invalid_length'})
            if length<0 or length>2*1024*1024:return self.respond(413,{'error':'body_too_large'})
            body=self.rfile.read(length)
            if len(body)!=length:return self.respond(400,{'error':'truncated_body'})
            path=urlsplit(self.path)
            if path.scheme or path.netloc:return self.respond(400,{'error':'invalid_target'})
            if path.path=='/internal/snapshot':
                if self.command!='GET':return self.respond(405,{'error':'method_not_allowed'})
                if lock.locked():return self.respond(409,{'error':'collection_busy'})
                try:return self.respond(200,export_snapshot())
                except Exception:return self.respond(503,{'error':'snapshot_export_failed'})
            if path.path=='/internal/publish':
                if self.command!='POST':return self.respond(405,{'error':'method_not_allowed'})
                if not lock.acquire(blocking=False):return self.respond(409,{'error':'collection_busy'})
                try:
                    doc=export_snapshot();publish_snapshot(doc)
                    return self.respond(200,{'ok':True,'generatedAt':doc['generatedAt'],'items':len(doc['items'])})
                except Exception:return self.respond(503,{'ok':False,'error':'snapshot_publish_failed'})
                finally:lock.release()
            if path.path=='/internal/collect':
                if self.command!='POST':return self.respond(405,{'error':'method_not_allowed'})
                try:
                    slot=json.loads(body)['slot'];when=datetime.datetime.strptime(slot,'%Y-%m-%dT%H').replace(tzinfo=datetime.timezone.utc)
                    age=(datetime.datetime.now(datetime.timezone.utc)-when).total_seconds()
                    if age < -60 or age>7200:raise ValueError()
                except (ValueError,KeyError,TypeError):return self.respond(400,{'error':'invalid_slot'})
                with sqlite3.connect(db) as con:
                    existing=con.execute('SELECT status FROM jobs WHERE slot=?',(slot,)).fetchone()
                    if existing:
                        status=existing[0]
                        code=200 if status=='succeeded' else 202 if status=='running' else 500
                        return self.respond(code,{'duplicate':True,'slot':slot,'status':status})
                    if not lock.acquire(blocking=False):return self.respond(409,{'error':'collection_busy'})
                    try:con.execute('INSERT INTO jobs VALUES(?,?,NULL)',(slot,'running'))
                    except Exception:lock.release();raise
                try:threading.Thread(target=perform,args=(slot,),daemon=True).start()
                except RuntimeError:
                    lock.release()
                    with sqlite3.connect(db) as con:con.execute("UPDATE jobs SET status='failed' WHERE slot=?",(slot,))
                    return self.respond(503,{'error':'job_start_failed'})
                return self.respond(202,{'accepted':True,'slot':slot,'status':'running'})
            if not(path.path.startswith('/api/') or path.path.startswith('/rss') or path.path=='/health'):return self.respond(404,{'error':'not_found'})
            headers={k:v for k,v in self.headers.items() if k.lower() not in HOP and not k.lower().startswith('x-radar-') and k.lower()!='authorization'}
            if self.headers.get('x-radar-auth'):headers['Authorization']=self.headers['x-radar-auth']
            headers['Host']='127.0.0.1:8788';headers['Content-Length']=str(len(body))
            connection=http.client.HTTPConnection('127.0.0.1',self.server.upstream_port,timeout=30)
            try:
                connection.request(self.command,self.path,body=body,headers=headers);r=connection.getresponse();data=r.read(4*1024*1024+1)
                if len(data)>4*1024*1024:return self.respond(502,{'error':'response_too_large'})
                self.send_response(r.status)
                for k,v in r.getheaders():
                    if k.lower() not in HOP:self.send_header(k,v)
                self.send_header('Content-Length',str(len(data)));self.send_header('Connection','close');self.end_headers()
                if self.command!='HEAD':self.wfile.write(data)
                self.close_connection=True
            except (OSError,http.client.HTTPException):return self.respond(502,{'error':'backend_unavailable'})
            finally:connection.close()
        do_GET=route;do_HEAD=route;do_POST=route;do_PATCH=route;do_PUT=route;do_DELETE=route;do_OPTIONS=route
    server=BoundedServer(address,Handler);server.upstream_port=8788;return server

if __name__=='__main__':
    make_server(('0.0.0.0',8789),os.environ['GATEWAY_SECRET'],os.environ.get('STATE_DIR','/data/workspace/freebie-radar/gateway-state')).serve_forever()
