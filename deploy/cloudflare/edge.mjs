import {loadSnapshot,saveSnapshot,snapshotResponse,isPublicSnapshotPath} from './snapshot.mjs';
import {fetchMachine,machineState,collectionDecision,deploymentStatus} from './platform.mjs';
const messages={snapshot_unavailable:'公开快照暂不可用。设备可能正在休眠，页面不会自动反复唤醒设备。',machine_cooldown:'设备处于平台冷却中，请等待倒计时结束；仍可浏览公开快照。',machine_waking:'设备正在唤醒，请稍后重试；已有快照仍可浏览。',origin_unavailable:'实时服务暂不可用，公开快照不受影响。',live_connection_required:'该操作需要实时服务和相应登录权限。'};
const error=(code,status=503,retry='60')=>Response.json({error:code,message:messages[code]||'该操作暂不可用，请稍后再试。'},{status,headers:{'Cache-Control':'no-store','Retry-After':String(retry)}});
function target(env,path){
 const base=new URL(env.VM_BASE_URL);
 if(base.protocol!=='https:'||!base.hostname.endsWith('.instabox.tech')||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('invalid_origin');
 return new URL(path,base);
}
async function bodyBytes(request,max,signal=AbortSignal.timeout(5000)){
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 const chunks=[];let size=0;let stop;
 const aborted=new Promise((_,reject)=>{stop=()=>reject(Error('request_deadline'));if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});
 try{
  for(;;){const {done,value}=await Promise.race([reader.read(),aborted]);if(done)break;size+=value.byteLength;if(size>max)throw Error('body_too_large');chunks.push(value);}
  const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.byteLength;}return data;
 }catch(e){await reader.cancel().catch(()=>{});throw e;}finally{signal.removeEventListener('abort',stop);reader.releaseLock();}
}
async function upstream(request,env,path,send,timeout=25000){
 if(!env.VM_PORT_TOKEN||!env.GATEWAY_SECRET)return error('origin_not_configured');
 const deadline=AbortSignal.timeout(timeout),headers=new Headers(request.headers);
 for(const key of [...headers.keys()])if(['host','connection','content-length'].includes(key)||key.startsWith('x-radar-'))headers.delete(key);
 headers.set('x-radar-auth',request.headers.get('Authorization')||'');headers.set('x-radar-gateway',env.GATEWAY_SECRET);headers.set('Authorization',`Bearer ${env.VM_PORT_TOKEN}`);headers.set('x-forwarded-proto','https');headers.set('x-forwarded-for',request.headers.get('CF-Connecting-IP')||'');
 try{
  let body;if(!['GET','HEAD'].includes(request.method)){body=await bodyBytes(request,2*1024*1024,deadline);headers.set('Content-Length',String(body.byteLength));}
  const r=await send(new Request(target(env,path),{method:request.method,headers,body,redirect:'manual',signal:deadline}));
  if(r.status===409){const text=(await r.text()).slice(0,4096);if(/machine_cooldown/.test(text))return error('machine_cooldown',503,r.headers.get('Retry-After')||'60');if(/operation_in_progress|operation_conflict|not_ready/.test(text))return error('machine_waking',503,r.headers.get('Retry-After')||'10');return new Response(text,{status:409,headers:{'Content-Type':r.headers.get('Content-Type')||'application/json','Cache-Control':'private, no-store'}});}
  if([502,503,504].includes(r.status)){await r.body?.cancel();return error('origin_unavailable',503,r.headers.get('Retry-After')||'60');}
  const out=new Response(r.body,r);out.headers.set('Cache-Control','private, no-store');out.headers.set('X-Radar-Mode','live');out.headers.delete('Access-Control-Allow-Origin');return out;
 }catch(e){return error(e.message==='body_too_large'?'body_too_large':'origin_unavailable',e.message==='body_too_large'?413:503);}
}
async function sameSecret(a,b){if(!a||!b||b.length>256)return false;const hashes=await Promise.all([a,b].map(x=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))));const x=new Uint8Array(hashes[0]),y=new Uint8Array(hashes[1]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
async function statusResponse(request,env,snapshot,send){
 const cache=globalThis.caches?.default,key=new Request(new URL('/_radar-status-cache',request.url).href);
 try{const cached=await cache?.match(key);if(cached)return cached;}catch{}
 const response=Response.json(await deploymentStatus(env,snapshot,send),{headers:{'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
 try{await cache?.put(key,response.clone());}catch{}return response;
}
async function connect(request,env,snapshot,send){
 if(request.method!=='POST')return error('method_not_allowed',405);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return error('origin_forbidden',403);
 const status=await deploymentStatus(env,snapshot,send);
 if(!['running','sleeping'].includes(status.state))return Response.json(status,{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(status.retryAfterSeconds||60)}});
 if(status.reason==='runtime_budget_guard')return Response.json({...status,reason:'runtime_budget_guard',message:'设备接近连续运行预算，暂不发起实时连接。公开快照仍可使用。'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'1800'}});
 const r=await upstream(new Request(request.url),env,'/health',send,16000);
 if(!r.ok){const detail=await r.json().catch(()=>({}));const retry=Number(r.headers.get('Retry-After'))||60;return Response.json({...status,state:detail.error==='machine_cooldown'?'cooldown':detail.error==='machine_waking'?'waking':'error',cooldownUntil:detail.error==='machine_cooldown'?new Date(Date.now()+retry*1000).toISOString():null,retryAfterSeconds:retry,reason:detail.error||'origin_unavailable'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(retry)}});}
 await r.body?.cancel();try{await globalThis.caches?.default?.delete(new Request(new URL('/_radar-status-cache',request.url).href));}catch{}
 return Response.json({...status,state:'running',checkedAt:new Date().toISOString(),reason:'live_connection_ok'},{headers:{'Cache-Control':'no-store'}});
}
export async function handle(request,env,send=fetch){
 const u=new URL(request.url),path=u.pathname;
 if(path==='/internal/snapshot'&&request.method==='POST'){
  if(!await sameSecret(env.SNAPSHOT_SECRET,request.headers.get('x-radar-snapshot-secret')))return new Response('Not found',{status:404});
  try{const data=await bodyBytes(request,2*1024*1024);return Response.json(await saveSnapshot(env,JSON.parse(new TextDecoder().decode(data))),{headers:{'Cache-Control':'no-store'}});}catch(e){return error('snapshot_publish_rejected',e.message==='body_too_large'?413:503);}
 }
 if(path.startsWith('/internal/')||path.startsWith('/_'))return new Response('Not found',{status:404});
 if(path==='/api/deployment/status'&&['GET','HEAD'].includes(request.method))return statusResponse(request,env,await loadSnapshot(env),send);
 if(path==='/api/deployment/connect')return connect(request,env,await loadSnapshot(env),send);
 const personal=Boolean(request.headers.get('Authorization'))||/(?:^|;\s*)(?:radar_session|radar_pending_reg)=/.test(request.headers.get('Cookie')||'');
 if(['GET','HEAD'].includes(request.method)&&isPublicSnapshotPath(path)&&!personal){const snapshot=await loadSnapshot(env);return snapshot?snapshotResponse(request,snapshot):error('snapshot_unavailable');}
 if(path.startsWith('/api/')||path.startsWith('/rss')||path==='/health'){
  if(!personal&&!path.startsWith('/rss/u/')&&!path.startsWith('/api/auth/'))return error('live_connection_required',401);
  return upstream(request,env,path+u.search,send);
 }
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 if(!env.ASSETS)return new Response('Freebie Radar — visit https://zoomzero.pages.dev',{headers:{'content-type':'text/plain; charset=utf-8'}});
 const asset=await env.ASSETS.fetch(request),out=new Response(asset.body,asset);
 out.headers.set('Cache-Control',/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(path)?'public, max-age=31536000, immutable':'no-store, max-age=0');return out;
}
export async function dispatch(event,env,send=fetch){
 const now=Number(event.scheduledTime)||Date.now(),slot=new Date(now).toISOString().slice(0,13);
 const decision=collectionDecision(await fetchMachine(env,send),now);
 if(!decision.allowed){console.log('collection_skipped',slot,decision.reason);return {skipped:true,reason:decision.reason};}
 const req=new Request('https://scheduler.invalid/internal/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot})});
 const r=await upstream(req,env,'/internal/collect',send);console.log('collection_dispatch',slot,r.status);await r.body?.cancel();if(r.status!==202&&r.status!==200)throw Error('collection_dispatch_failed_'+r.status);
 return {accepted:true,slot};
}
export default {fetch(request,env){return handle(request,env);},scheduled(event,env){return dispatch(event,env);}};
