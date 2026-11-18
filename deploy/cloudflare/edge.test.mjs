import { test } from 'node:test';
import assert from 'node:assert/strict';
const path = new URL('./edge.mjs', import.meta.url);
const load = async () => import(path.href);
const env = { VM_BASE_URL: 'https://8789-example.instabox.tech', VM_PORT_TOKEN: 'platform-token', GATEWAY_SECRET: 'gateway-secret', ASSETS: { fetch: async () => new Response('static') } };
test('runtime export ignores ExecutionContext as dependency', async () => {
  const { default: worker } = await load();
  const response = await worker.fetch(new Request('https://zoomzero.pages.dev/api/items'), { ...env, VM_PORT_TOKEN: '' }, {waitUntil(){}});
  assert.equal(response.status,503);
});
test('static assets never touch VM', async () => {
  const { handle } = await load();
  const r = await handle(new Request('https://zoomzero.pages.dev/'), env, () => { throw Error('VM touched'); });
  assert.equal(await r.text(), 'static');
});
test('proxy separates application Authorization and overwrites spoofed gateway headers', async () => {
  const { handle } = await load(); let forwarded;
  const r = await handle(new Request('https://zoomzero.pages.dev/api/admin/overview', { headers: { Authorization: 'Bearer admin-token', 'x-radar-auth': 'spoof', 'x-radar-gateway': 'spoof' } }), env, async req => { forwarded = req; return Response.json({ ok: true }); });
  assert.equal(r.status, 200);
  assert.equal(forwarded.headers.get('authorization'), 'Bearer platform-token');
  assert.equal(forwarded.headers.get('x-radar-auth'), 'Bearer admin-token');
  assert.equal(forwarded.headers.get('x-radar-gateway'), 'gateway-secret');
  assert.equal(forwarded.url, env.VM_BASE_URL + '/api/admin/overview');
});
test('public browsing never wakes VM, even with missing KV or unrelated cookies', async () => {
  const {handle}=await load();let calls=0;
  const r=await handle(new Request('https://zoomzero.pages.dev/api/items',{headers:{Cookie:'analytics=1'}}),env,()=>{calls++;throw Error('VM touched');});
  assert.equal(r.status,503);assert.equal((await r.json()).error,'snapshot_unavailable');assert.equal(calls,0);
});
test('unknown platform state causes schedule skip instead of wake',async()=>{
  const {dispatch}=await load();let calls=0;
  const result=await dispatch({scheduledTime:Date.now()},env,()=>{calls++;throw Error('VM touched');});
  assert.equal(result.skipped,true);assert.equal(calls,0);
});
test('application conflict is not misreported as platform cooldown',async()=>{
  const {handle}=await load();const r=await handle(new Request('https://zoomzero.pages.dev/api/admin/overview',{headers:{Authorization:'Bearer admin'}}),env,async()=>Response.json({error:'collection_busy'},{status:409}));
  assert.equal(r.status,409);assert.equal((await r.json()).error,'collection_busy');
});
test('browser cannot call internal collection endpoint', async () => {
  const { handle } = await load();
  assert.equal((await handle(new Request('https://zoomzero.pages.dev/internal/collect', {method:'POST'}), env, () => {throw Error('VM touched');})).status,404);
});
test('cooldown returns bounded error with Retry-After, never loops', async () => {
  const { handle } = await load(); let calls=0;
  const r = await handle(new Request('https://zoomzero.pages.dev/api/admin/overview', {headers:{Authorization:'Bearer admin'}}), env, async () => {calls++; return new Response('machine_cooldown',{status:409,headers:{'Retry-After':'600'}});});
  assert.equal(calls,1); assert.equal(r.status,503); assert.equal(r.headers.get('Retry-After'),'600'); assert.match(await r.text(),/cooldown/);
});
test('scheduled slot uses event timestamp and accepts no browser task ID', async () => {
  const { dispatch } = await load(); let forwarded;
  await dispatch({scheduledTime:Date.parse('2026-11-18T06:00:00Z')},{...env,INSTABOX_API_KEY:'api',INSTABOX_MACHINE_ID:'m_example'},async req=>{if(new URL(req.url).hostname==='api.instabox.sh')return Response.json({state:'running',runStartedAt:'2026-11-18T05:30:00Z',maxRunMinutes:120});forwarded=req;return new Response('',{status:202});});
  assert.equal(forwarded.url,env.VM_BASE_URL+'/internal/collect');
  assert.ok(Number(forwarded.headers.get('content-length')) > 0, 'gateway receives explicit body framing');
  assert.equal((await forwarded.json()).slot,'2026-11-18T06');
});
