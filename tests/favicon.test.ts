import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const publicUrl=(name:string)=>new URL('../src/web/public/'+name,import.meta.url);
test('favicon PNG assets carry requested dimensions',()=>{
 for(const [name,size] of [['radar-favicon-v2.png',32],['radar-icon-192.png',192],['apple-touch-icon.png',180]] as const){
  const data=readFileSync(publicUrl(name));assert.equal(data.subarray(1,4).toString(),'PNG');assert.equal(data.readUInt32BE(16),size);assert.equal(data.readUInt32BE(20),size);
 }
});
test('favicon ICO includes small browser icon sizes',()=>{
 const data=readFileSync(publicUrl('radar-favicon-v2.ico'));assert.equal(data.readUInt16LE(2),1);assert.equal(data.readUInt16LE(4),3);
 assert.deepEqual(Array.from({length:3},(_,i)=>[data[6+i*16],data[7+i*16]]),[[16,16],[32,32],[48,48]]);
});
test('HTML points to versioned favicon instead of the old SVG',()=>{
 const html=readFileSync(new URL('../src/web/index.html',import.meta.url),'utf8');
 assert.match(html,/href="\/radar-favicon-v2\.png"/);assert.match(html,/href="\/radar-favicon-v2\.ico"/);assert.match(html,/rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);assert.doesNotMatch(html,/href="\/favicon\.svg"/);
});
