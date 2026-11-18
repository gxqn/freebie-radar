const LIMIT=1000, MAX_BYTES=2*1024*1024;
const str=(v,n=2000,d=null)=>typeof v==='string'?v.slice(0,n):d;
const num=(v,d=0)=>typeof v==='number'&&Number.isFinite(v)?v:d;
const strings=(v)=>Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,16).map(x=>x.slice(0,100)):[];
const safeUrl=(v)=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?str(v):null;}catch{return null;}};
export function publicItem(row){
 if(!row || !Number.isSafeInteger(row.id) || row.id<1 || row.status!=='active' || !safeUrl(row.url) || !str(row.title,500,''))return null;
 const item={id:row.id};
 for(const [key,max] of Object.entries({source_id:100,external_id:200,title:500,summary:1200,author:120,category:80,kind:60,obtain:40,expires_at:40,published_at:40,first_seen_at:40,last_seen_at:40}))item[key]=str(row[key],max);
 Object.assign(item,{url:safeUrl(row.url),image_url:safeUrl(row.image_url),score:num(row.score),price:num(row.price,null),ai_quality:num(row.ai_quality,null),is_free:row.is_free?1:0,tags:strings(row.tags),codes:strings(row.codes),status:'active',starred:false,read:false,read_at:null,pushed_at:null,content:null,matched:[],blockedBy:null,dupCount:1});
 const a=row.ai;item.ai=!a||typeof a!=='object'?null:{keep:typeof a.keep==='boolean'?a.keep:null,reason:str(a.reason,300),category:str(a.category,80),obtain:str(a.obtain,40),quality:num(a.quality,null)};
 return item;
}
export function sanitizeSnapshot(raw,now=Date.now()){
 if(!raw||raw.schema!==1||!Array.isArray(raw.items)||raw.items.length>LIMIT||!Array.isArray(raw.sources)||raw.sources.length>200)throw Error('invalid_snapshot_schema');
 const generated=Date.parse(raw.generatedAt||'');
 if(!Number.isFinite(generated)||generated>now+300000||generated<now-31*86400000)throw Error('invalid_snapshot_timestamp');
 if(new TextEncoder().encode(JSON.stringify(raw)).length>MAX_BYTES)throw Error('snapshot_too_large');
 const b=raw.bootstrap||{},o=b.onboarding||{};
 const doc={schema:1,generatedAt:new Date(generated).toISOString(),lastCollectionAt:Number.isFinite(Date.parse(raw.lastCollectionAt||''))?new Date(raw.lastCollectionAt).toISOString():null,release:str(raw.release,100,'unknown'),items:raw.items.map(publicItem).filter(Boolean),sources:raw.sources.filter(s=>s&&typeof s.id==='string').map(s=>({id:str(s.id,100),name:str(s.name,160),kind:str(s.kind,60),enabled:Boolean(s.enabled),builtIn:Boolean(s.builtIn),interval_sec:3600,last_run_at:str(s.last_run_at,40),last_status:str(s.last_status,40),last_error:null,config:{},items:num(s.items),latest_item_at:str(s.latest_item_at,40)})),bootstrap:{siteMode:'public',loginEnabled:false,registrationMode:'closed',suspendUserSessionsOnClose:false,minTrustLevel:0,oauthConfigured:false,githubConfigured:false,devMockEnabled:false,adminConfigured:b.adminConfigured!==false,adminLocked:Boolean(b.adminLocked),isAdmin:false,user:null,onboarding:{enabled:Boolean(o.enabled),title:str(o.title,160,''),content:str(o.content,8000,''),showGuideCards:Boolean(o.showGuideCards),version:num(o.version,1)},features:{rss:true,userPush:false}},stats:{features:{ai:Boolean(raw.stats?.features?.ai),push:false,pushChannel:'none'}},digests:[],truncated:Boolean(raw.truncated)};
 if(!doc.items.length && raw.items.length)throw Error('snapshot_has_no_valid_public_items');
 return doc;
}
export async function loadSnapshot(env){
 const kv=env.FREEBIE_PUBLIC_SNAPSHOTS;if(!kv)return null;
 try{
  const manifest=await kv.get('current','json');
  if(!manifest || typeof manifest.key!=='string' || !manifest.key.startsWith('snapshot:v1:'))return null;
  for(const key of [manifest.key,manifest.previousKey]){
   if(typeof key!=='string'||!key.startsWith('snapshot:v1:'))continue;
   const doc=await kv.get(key,'json');
   if(doc?.schema===1&&Array.isArray(doc.items)&&doc.items.length<=LIMIT&&typeof doc.generatedAt==='string')return doc;
  }
 }catch{}
 return null;
}
export async function saveSnapshot(env,raw){
 const kv=env.FREEBIE_PUBLIC_SNAPSHOTS;if(!kv)throw Error('snapshot_store_not_configured');
 const doc=sanitizeSnapshot(raw);
 const old=await kv.get('current','json');
 if(old?.generatedAt && Date.parse(old.generatedAt)>Date.parse(doc.generatedAt))throw Error('older_snapshot_rejected');
 // Include a digest so a second export in the same millisecond cannot mutate an immutable version.
 const body=JSON.stringify(doc);
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('');
 const key='snapshot:v1:'+Date.parse(doc.generatedAt)+':'+digest;
 await kv.put(key,body);
 await kv.put('current',JSON.stringify({key,previousKey:old?.key||null,generatedAt:doc.generatedAt,release:doc.release}));
 // Keep current and previous versions; an incomplete new version never removes the last good one.
 if(old?.previousKey && old.previousKey!==key && old.previousKey!==old.key){try{await kv.delete(old.previousKey);}catch{}}
 return {ok:true,generatedAt:doc.generatedAt,items:doc.items.length,release:doc.release};
}
const integer=(v,d,min,max)=>{const n=Number(v);return v!==null&&Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):d;};
const timestamp=(i)=>Date.parse(i.published_at||i.first_seen_at||'')||0;
function channelQuery(input){
 const p=new URLSearchParams(input);const preset=p.get('preset');
 const defaults={verified:{aiOnly:'1',unexpired:'1',kind:'freebie',obtain:'free,conditional',maxAgeDays:'7',excludeCategory:'pan,course'},all:{hideRejected:'1'},opensource:{kind:'opensource',hideRejected:'1'},news:{kind:'news',hideRejected:'1'},info:{kind:'info',hideRejected:'1'},deal:{kind:'deal',hideRejected:'1',unexpired:'1'},offline:{category:'offline',hideRejected:'1',unexpired:'1'},pan:{category:'pan,course',hideRejected:'1'},codes:{hasCodes:'1',unexpired:'1'},urgent:{expiring:'1'}}[preset]||{};
 for(const [k,v]of Object.entries(defaults))if(!p.has(k))p.set(k,v);
 return p;
}
function filtered(snapshot,input,now){
 const p=channelQuery(input), has=(k)=>p.get(k)==='1', values=(k)=>(p.get(k)||'').split(',').map(v=>v.trim()).filter(Boolean);
 const ids=values('ids').map(Number),q=(p.get('search')||'').trim().toLocaleLowerCase();
 const age=Number(p.get('maxAgeDays')),since=Date.parse(p.get('since')||'');
 return snapshot.items.filter(i=>{
  if(ids.length&&!ids.includes(i.id))return false;
  if(has('starred')&&!ids.length)return false;
  if(p.get('source')&&i.source_id!==p.get('source'))return false;
  for(const k of ['category','kind','obtain']){const allowed=values(k);if(allowed.length&&!allowed.includes(i[k]))return false;}
  if(values('excludeCategory').includes(i.category))return false;
  if(q&&!`${i.title} ${i.summary||''} ${i.tags.join(' ')} ${i.codes.join(' ')}`.toLocaleLowerCase().includes(q))return false;
  const zh=/[\u3400-\u9fff]/u.test(i.title);if(p.get('lang')==='zh'&&!zh||p.get('lang')==='en'&&zh)return false;
  if(has('aiOnly')&&i.ai?.keep!==true||has('hideRejected')&&i.ai?.keep===false)return false;
  if(has('freeOnly')&&!(i.is_free===1||i.price===0))return false;
  if(p.has('maxPrice')&&p.get('maxPrice')!==''&&(i.price===null||i.price>Number(p.get('maxPrice'))))return false;
  if(p.has('minScore')&&i.score<Number(p.get('minScore')))return false;
  const expiry=Date.parse(i.expires_at||'');
  if(has('unexpired')&&Number.isFinite(expiry)&&expiry<=now)return false;
  if(has('expiring')&&(!Number.isFinite(expiry)||expiry<now||expiry>now+86400000))return false;
  if(has('hasCodes')&&!i.codes.length)return false;
  if(Number.isFinite(since)&&timestamp(i)<since||age>0&&timestamp(i)<now-age*86400000)return false;
  return true;
 });
}
export function queryItems(snapshot,input,now=Date.now()){
 const p=new URLSearchParams(input);let rows=filtered(snapshot,p,now);
 const sort=p.get('sort')||'newest';
 rows.sort((a,b)=>sort==='score'?b.score-a.score||timestamp(b)-timestamp(a):sort==='oldest'?timestamp(a)-timestamp(b):sort==='price'?(a.price??Infinity)-(b.price??Infinity):sort==='expiring'?(Date.parse(a.expires_at)||Infinity)-(Date.parse(b.expires_at)||Infinity):timestamp(b)-timestamp(a)||b.id-a.id);
 if(p.get('merge')!=='0'&&!p.get('source')&&p.get('starred')!=='1'){
  const seen=new Map();rows=rows.filter(i=>{const key=`${i.kind}:${i.category}:${i.title.toLowerCase().trim()}`;const existing=seen.get(key);if(existing){existing.dupCount++;return false;}const copy={...i,dupCount:1};seen.set(key,copy);return true;}).map(i=>seen.get(`${i.kind}:${i.category}:${i.title.toLowerCase().trim()}`));
 }
 const limit=integer(p.get('limit'),40,1,200),offset=integer(p.get('offset'),0,0,LIMIT);
 return {total:rows.length,limit,offset,items:rows.slice(offset,offset+limit),snapshotAt:snapshot.generatedAt,truncated:snapshot.truncated};
}
function buckets(rows,key){const m=new Map();for(const i of rows){const value=i[key]||'other';m.set(value,(m.get(value)||0)+1);}return [...m].map(([k,n])=>({[key]:k,n})).sort((a,b)=>b.n-a.n);}
function stats(snapshot,q,now){
 const rows=snapshot.items,selected=filtered(snapshot,q,now);
 return {totals:{total:rows.length,active:rows.length,starred:0,expired:rows.filter(i=>Date.parse(i.expires_at)<=now).length,withCodes:rows.filter(i=>i.codes.length).length,unread:rows.length,last24h:rows.filter(i=>timestamp(i)>=now-86400000).length,blockRules:0,aiKept:rows.filter(i=>i.ai?.keep===true).length,aiRejected:rows.filter(i=>i.ai?.keep===false).length,cleanFree:rows.filter(i=>i.ai?.keep===true&&i.obtain==='free').length},byCategory:buckets(selected,'category'),byKind:buckets(rows,'kind'),bySource:buckets(rows,'source_id'),price:{free:rows.filter(i=>i.price===0).length,under5:rows.filter(i=>i.price!==null&&i.price<=5).length,under10:rows.filter(i=>i.price!==null&&i.price<=10).length,known:rows.filter(i=>i.price!==null).length},features:snapshot.stats.features};
}
function hot(snapshot,q,now){const hours=integer(q.get('hours'),24,1,168),scope=['all','deals','news','info'].includes(q.get('scope'))?q.get('scope'):'all';const rows=snapshot.items.filter(i=>timestamp(i)>=now-hours*3600000&&(scope==='all'||scope==='deals'&&['deal','freebie'].includes(i.kind)||i.kind===scope));const top=rows.toSorted((a,b)=>b.score-a.score).slice(0,20).map(i=>({id:i.id,title:i.title,url:i.url,source_id:i.source_id,category:i.category,kind:i.kind,obtain:i.obtain,score:i.score,quality:i.ai_quality,dupCount:1}));return {windowHours:hours,scope,from:new Date(now-hours*3600000).toISOString(),to:new Date(now).toISOString(),scanned:rows.length,prevScanned:0,words:[],categories:buckets(rows,'category').map(x=>({key:x.category,n:x.n,prev:0,delta:x.n})),kinds:buckets(rows,'kind').map(x=>({key:x.kind,n:x.n,prev:0,delta:x.n})),top,topNews:top.filter(i=>i.kind==='news')};}
export function snapshotResponse(request,snapshot,now=Date.now()){
 if(!['GET','HEAD'].includes(request.method))return null;
 const u=new URL(request.url),p=u.pathname,q=u.searchParams;
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=30, stale-while-revalidate=60','Vary':'Authorization, Cookie','X-Radar-Mode':'snapshot','X-Radar-Snapshot-At':snapshot.generatedAt,'X-Content-Type-Options':'nosniff'};
 const json=(value,status=200)=>new Response(request.method==='HEAD'?null:JSON.stringify(value),{status,headers});
 if(p==='/api/items')return json(queryItems(snapshot,q,now));
 if(p==='/api/stats')return json(stats(snapshot,q,now));
 if(p==='/api/sources')return json({sources:snapshot.sources});
 if(p==='/api/site/bootstrap')return json(snapshot.bootstrap);
 if(p==='/api/auth/check')return json({ok:true,protected:true,isAdmin:false,adminHostAllowed:true,adminLocked:snapshot.bootstrap.adminLocked});
 if(p==='/api/auth/me')return json({user:null,isAdmin:false,siteMode:'public'});
 if(p==='/api/digests')return json({digests:snapshot.digests});
 if(p==='/api/hot')return json(hot(snapshot,q,now));
 if(p==='/health')return json({ok:true,mode:'snapshot',snapshotAt:snapshot.generatedAt,release:snapshot.release,backendChecked:false});
 const detail=p.match(/^\/api\/items\/(\d+)(\/related)?$/);
 if(detail){const item=snapshot.items.find(i=>i.id===Number(detail[1]));if(!item)return json({error:'snapshot_item_not_available',message:'该条目不在最近1000条公开快照中。'},404);return json(detail[2]?{items:snapshot.items.filter(i=>i.id!==item.id&&i.title===item.title).slice(0,20)}:item);}
 if(p==='/rss.xml'){
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const items=queryItems(snapshot,q,now).items;
  return new Response(request.method==='HEAD'?null:`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>资源雷达 · 公开快照</title><link>${escape(u.origin)}</link><description>更新于 ${escape(snapshot.generatedAt)}</description>${items.map(i=>`<item><title>${escape(i.title)}</title><link>${escape(i.url)}</link><guid>${escape(i.url)}</guid><description>${escape(i.summary)}</description></item>`).join('')}</channel></rss>`,{headers:{...headers,'Content-Type':'application/rss+xml; charset=utf-8'}});
 }
 if(/^\/api\/digests\//.test(p))return json({error:'snapshot_digest_not_available'},404);
 return null;
}
export function isPublicSnapshotPath(path){return ['/api/items','/api/stats','/api/sources','/api/site/bootstrap','/api/auth/check','/api/auth/me','/api/digests','/api/hot','/health','/rss.xml'].includes(path)||/^\/api\/items\/\d+(?:\/related)?$/.test(path)||/^\/api\/digests\//.test(path);}
