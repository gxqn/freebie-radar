import {test} from 'node:test';
import assert from 'node:assert/strict';
const moduleUrl=new URL('./platform.mjs',import.meta.url);
const now=Date.parse('2026-11-18T09:00:00Z');
test('cooldown is authoritative even when state says paused',async()=>{
 const {machineState}=await import(moduleUrl);
 const s=machineState({state:'paused',cooldownUntil:'2026-11-18T09:10:00Z'},now);
 assert.equal(s.state,'cooldown');assert.equal(s.retryAfterSeconds,600);
});
test('idle pause and manual stop differ',async()=>{
 const {machineState}=await import(moduleUrl);
 assert.equal(machineState({state:'paused',autoSuspendedAt:'2026-11-18T08:00:00Z'},now).state,'sleeping');
 assert.equal(machineState({state:'stopped'},now).state,'offline');
});
test('unknown, late runs, short remaining budget never wake or collect',async()=>{
 const {collectionDecision}=await import(moduleUrl);
 for(const m of [null,{state:'running'},{state:'running',runStartedAt:'2026-11-18T07:30:00Z',maxRunMinutes:240},{state:'running',runStartedAt:'2026-11-18T08:30:00Z',maxRunMinutes:60},{state:'paused',cooldownUntil:'2026-11-18T09:10:00Z'},{state:'stopped'}])assert.equal(collectionDecision(m,now).allowed,false);
 assert.equal(collectionDecision({state:'running',runStartedAt:'2026-11-18T08:30:00Z',maxRunMinutes:120},now).allowed,true);
 assert.equal(collectionDecision({state:'paused',autoSuspendedAt:'2026-11-18T08:00:00Z'},now).allowed,true);
});
test('state query only calls management API, strips private machine metadata',async()=>{
 const {deploymentStatus}=await import(moduleUrl);let requested;
 const s=await deploymentStatus({INSTABOX_API_KEY:'private',INSTABOX_MACHINE_ID:'m_example'},null,async req=>{requested=req;return Response.json({state:'running',runStartedAt:'2026-11-18T08:30:00Z',maxRunMinutes:120,privateToken:'secret'});},now);
 assert.equal(new URL(requested.url).hostname,'api.instabox.sh');assert.equal(s.state,'running');assert.equal(JSON.stringify(s).includes('secret'),false);assert.equal(s.snapshotAvailable,false);
});
