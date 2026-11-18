// Management reads never touch a VM port and therefore never wake the guest.
export function machineState(machine, now = Date.now()) {
  const until = Date.parse(machine?.cooldownUntil || '');
  if (Number.isFinite(until) && until > now) return {state:'cooldown',cooldownUntil:new Date(until).toISOString(),retryAfterSeconds:Math.ceil((until-now)/1000)};
  const state=machine?.state;
  if (['starting','resuming','creating','restarting'].includes(state) || (state==='running' && machine?.runtime?.ready===false)) return {state:'waking',cooldownUntil:null,retryAfterSeconds:10};
  if (state==='running') return {state:'running',cooldownUntil:null,retryAfterSeconds:0};
  if (['paused','suspended'].includes(state) && (machine?.desiredState==='running' || machine?.autoSuspendedAt)) return {state:'sleeping',cooldownUntil:null,retryAfterSeconds:0};
  if (['paused','stopped','stopping','archived','deleted'].includes(state)) return {state:'offline',cooldownUntil:null,retryAfterSeconds:0};
  if (['failed','error'].includes(state)) return {state:'error',cooldownUntil:null,retryAfterSeconds:60};
  return {state:'unknown',cooldownUntil:null,retryAfterSeconds:60};
}
export function collectionDecision(machine,now=Date.now()) {
  const s=machineState(machine,now);
  if (s.state==='sleeping') return {allowed:true,reason:'idle_pause'};
  if (s.state!=='running') return {allowed:false,reason:s.state};
  const began=Date.parse(machine?.runStartedAt || '');
  const limit=Number(machine?.maxRunMinutes);
  if(!Number.isFinite(began)||!Number.isFinite(limit)||limit<=0||began>now) return {allowed:false,reason:'unknown_runtime_budget'};
  const age=(now-began)/60000;
  if(age>=75 || limit-age<45) return {allowed:false,reason:'runtime_budget_guard'};
  return {allowed:true,reason:'within_runtime_budget'};
}
export async function fetchMachine(env,send=fetch) {
  if(!env.INSTABOX_API_KEY || !/^m_[a-z0-9]+$/.test(env.INSTABOX_MACHINE_ID || '')) return null;
  try {
    const r=await send(new Request('https://api.instabox.sh/v1/machines/'+env.INSTABOX_MACHINE_ID,{headers:{Authorization:'Bearer '+env.INSTABOX_API_KEY,Accept:'application/json'},signal:AbortSignal.timeout(8000)}));
    if(!r.ok){await r.body?.cancel();return null;}
    const m=await r.json();return m && typeof m==='object' && typeof m.state==='string' ? m : null;
  } catch {return null;}
}
export async function deploymentStatus(env,snapshot,send=fetch,now=Date.now()) {
  const machine=await fetchMachine(env,send);
  const status=machineState(machine,now);
  const next=new Date(now);next.setUTCMinutes(0,0,0);next.setUTCHours(next.getUTCHours()+1);
  return {...status,checkedAt:new Date(now).toISOString(),snapshotAt:snapshot?.generatedAt || null,lastCollectionAt:snapshot?.lastCollectionAt || null,nextCollectionAt:next.toISOString(),release:env.RADAR_RELEASE || snapshot?.release || 'unknown',readMode:'snapshot',snapshotAvailable:Boolean(snapshot),snapshotLimit:1000,reason:machine?collectionDecision(machine,now).reason:'platform_status_unavailable'};
}
