"""Explicit public DTO export. Never send credentials, DB rows, or authenticated responses."""
import datetime
import http.client
import json
import math
import os
import urllib.request
from urllib.parse import urlsplit, quote

LIMIT=1000
MAX_BYTES=2*1024*1024

def text(value,limit=2000,default=None):
    return value[:limit] if isinstance(value,str) else default

def number(value,default=0):
    return value if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) else default

def public_item(row):
    if not isinstance(row,dict) or not isinstance(row.get('id'),int) or row['id']<=0: return None
    url=text(row.get('url'))
    if not url or urlsplit(url).scheme not in ('http','https') or row.get('status','active')!='active':return None
    item={k:text(row.get(k),limit) for k,limit in [('source_id',100),('external_id',200),('url',2000),('title',500),('summary',1200),('author',120),('category',80),('kind',60),('image_url',2000),('obtain',40),('expires_at',40),('published_at',40),('first_seen_at',40),('last_seen_at',40)]}
    item.update(id=row['id'],score=number(row.get('score')),price=number(row.get('price'),None),ai_quality=number(row.get('ai_quality'),None),is_free=1 if row.get('is_free') else 0,status='active',starred=False,read=False,read_at=None,pushed_at=None,content=None,matched=[],blockedBy=None,dupCount=1)
    for key in ['tags','codes']:item[key]=[v[:100] for v in row.get(key,[]) if isinstance(v,str)][:16] if isinstance(row.get(key),list) else []
    ai=row.get('ai')
    item['ai']=None if not isinstance(ai,dict) else {'keep':ai.get('keep') if isinstance(ai.get('keep'),bool) else None,'reason':text(ai.get('reason'),300),'category':text(ai.get('category'),80),'obtain':text(ai.get('obtain'),40),'quality':number(ai.get('quality'),None)}
    return item

def public_source(row):
    return {'id':text(row.get('id'),100),'name':text(row.get('name'),160),'kind':text(row.get('kind'),60),'enabled':bool(row.get('enabled')),'builtIn':bool(row.get('builtIn')),'interval_sec':3600,'last_run_at':text(row.get('last_run_at'),40),'last_status':text(row.get('last_status'),40),'last_error':None,'config':{},'items':number(row.get('items')),'latest_item_at':text(row.get('latest_item_at'),40)}

def _get_json(path):
    c=http.client.HTTPConnection('127.0.0.1',8788,timeout=8)
    try:
        c.request('GET',path,headers={'Accept':'application/json','Connection':'close'})
        r=c.getresponse();data=r.read(4*1024*1024+1)
        if r.status!=200 or len(data)>4*1024*1024:raise ValueError('anonymous_export_failed')
        return json.loads(data)
    finally:c.close()

def export_snapshot(get_json=_get_json,release=None):
    now=datetime.datetime.now(datetime.timezone.utc)
    cutoff=(now-datetime.timedelta(days=30)).isoformat()
    items=[];total=0
    for offset in range(0,LIMIT,200):
        data=get_json('/api/items?limit=200&offset='+str(offset)+'&merge=0&status=active&since='+quote(cutoff,safe=''))
        rows=data.get('items')
        if not isinstance(rows,list):raise ValueError('invalid_public_items')
        total=number(data.get('total'))
        for row in rows:
            item=public_item(row)
            if item is not None:items.append(item)
        if len(rows)<200 or offset+len(rows)>=total:break
    sources=[public_source(s) for s in get_json('/api/sources').get('sources',[]) if isinstance(s,dict)]
    boot=get_json('/api/site/bootstrap');notice=boot.get('onboarding') or {};features=get_json('/api/stats').get('features') or {}
    bootstrap={'siteMode':'public','loginEnabled':False,'registrationMode':'closed','suspendUserSessionsOnClose':False,'minTrustLevel':0,'oauthConfigured':False,'githubConfigured':False,'devMockEnabled':False,'adminConfigured':bool(boot.get('adminConfigured',True)),'adminLocked':bool(boot.get('adminLocked')),'isAdmin':False,'user':None,'onboarding':{'enabled':bool(notice.get('enabled')),'title':text(notice.get('title'),160,''),'content':text(notice.get('content'),8000,''),'showGuideCards':bool(notice.get('showGuideCards')),'version':number(notice.get('version'),1)},'features':{'rss':True,'userPush':False}}
    times=[s['last_run_at'] for s in sources if s.get('last_run_at')]
    snapshot={'schema':1,'generatedAt':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),'lastCollectionAt':max(times) if times else None,'release':text(release or os.environ.get('RADAR_RELEASE','unknown'),100),'items':items[:LIMIT],'sources':sources[:200],'bootstrap':bootstrap,'stats':{'features':{'ai':bool(features.get('ai')),'push':False,'pushChannel':'none'}},'digests':[],'truncated':total>len(items)}
    while len(json.dumps(snapshot,ensure_ascii=False).encode())>MAX_BYTES-8192:
        if not snapshot['items']:raise ValueError('snapshot_metadata_too_large')
        snapshot['items']=snapshot['items'][:max(0,len(snapshot['items'])*9//10)];snapshot['truncated']=True
    return snapshot

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def publish_snapshot(snapshot,url=None,secret=None):
    url=url or os.environ.get('SNAPSHOT_PUBLISH_URL','');secret=secret or os.environ.get('SNAPSHOT_SECRET','')
    u=urlsplit(url)
    if u.scheme!='https' or u.hostname!='zoomzero.pages.dev' or u.path!='/internal/snapshot' or u.query or u.fragment or u.username or u.password or u.port not in (None,443) or not secret:raise ValueError('invalid_snapshot_publisher_configuration')
    data=json.dumps(snapshot,ensure_ascii=False).encode()
    if len(data)>MAX_BYTES:raise ValueError('snapshot_too_large')
    req=urllib.request.Request(url,data=data,method='POST',headers={'Content-Type':'application/json','x-radar-snapshot-secret':secret,'User-Agent':'Mozilla/5.0 FreebieRadarSnapshot/1.0'})
    with urllib.request.build_opener(_NoRedirect).open(req,timeout=20) as r:
        if r.status not in (200,201):raise ValueError('snapshot_publish_failed')
        reply=json.loads(r.read(4096))
        if not reply.get('ok'):raise ValueError('snapshot_publish_not_confirmed')
    return True
