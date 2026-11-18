import {test} from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../src/web/src/lib/ai-actions.ts');
test('disabled AI explains why execute does nothing even when endpoint is saved',async()=>{const {aiReviewBlockedReason}=await load();assert.match(aiReviewBlockedReason({enabled:false,ready:false},false)!,/开启.*AI/);assert.equal(aiReviewBlockedReason({enabled:true,ready:true},false),null);assert.match(aiReviewBlockedReason({enabled:true,ready:true},true)!,/正在执行/);});
test('backfill HTTP timeout is not presented as completed or NaN counts',async()=>{const {readBackfillResult}=await load();await assert.rejects(()=>readBackfillResult(Response.json({error:'origin_unavailable'},{status:503})),/后台.*勿重复/);await assert.rejects(()=>readBackfillResult(Response.json({reviewed:0,rejected:0,scanned:0,error:'AI 未启用或未配置'})),/AI 未启用/);});
test('accept valid counts and partial failures, reject malformed success',async()=>{const {readBackfillResult}=await load();const d=await readBackfillResult(Response.json({reviewed:4,rejected:2,scanned:16,mode:'pending'}));assert.equal(d.reviewed,4);await assert.rejects(()=>readBackfillResult(Response.json({ok:true})),/结果格式/);});
