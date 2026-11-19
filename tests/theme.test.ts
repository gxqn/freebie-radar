import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeTheme, readTheme, applyTheme, saveTheme } from '../src/web/src/lib/theme.ts';

function rootWithClasses(...initial: string[]) {
  const classes = new Set(initial);
  return { classes, root: { classList: { toggle(name: string, on: boolean) { if (on) classes.add(name); else classes.delete(name); return on; } } } };
}
test('theme normalizes only the supported persisted values', () => {
  for (const value of [null, undefined, '', 'auto', 'DARK', {}, 42]) assert.equal(normalizeTheme(value), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('light'), 'light');
});
test('theme storage reads exact key and survives unavailable storage', () => {
  assert.equal(readTheme({ getItem(key) { assert.equal(key, 'radar_theme'); return 'dark'; } }), 'dark');
  assert.equal(readTheme({ getItem() { throw Error('blocked'); } }), 'light');
  assert.equal(readTheme({ getItem() { return 'corrupt'; } }), 'light');
});
test('theme switching preserves unrelated document classes in both directions', () => {
  const {root,classes} = rootWithClasses('app-shell');
  applyTheme('dark', root); assert.deepEqual([...classes], ['app-shell','dark']);
  applyTheme('dark', root); assert.equal(classes.size, 2);
  applyTheme('light', root); assert.deepEqual([...classes], ['app-shell']);
});
test('theme save persists the preference and tolerates quota or permission errors', () => {
  const values: Record<string,string> = {};
  saveTheme('dark', {setItem(k,v) {values[k]=v;}}); assert.equal(values.radar_theme,'dark');
  saveTheme('light', {setItem(k,v) {values[k]=v;}}); assert.equal(values.radar_theme,'light');
  assert.doesNotThrow(() => saveTheme('dark', {setItem() {throw Error('quota');}}));
});
const html=readFileSync(new URL('../src/web/index.html',import.meta.url),'utf8');
const startup=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('prepaint theme agrees with runtime including invalid values and preserves root classes', () => {
  assert.ok(startup, 'synchronous head theme initializer');
  assert.ok(html.indexOf('<script>') < html.indexOf('<body>'));
  for (const value of ['dark','light','corrupt',null]) {
    const {root,classes}=rootWithClasses('app-shell','dark');
    runInNewContext(startup,{document:{documentElement:root},localStorage:{getItem(){return value;}}});
    assert.equal(classes.has('dark'),normalizeTheme(value)==='dark');
    assert.ok(classes.has('app-shell'));
  }
});
test('prepaint handles blocked storage getter and falls back to light', () => {
  assert.ok(startup);
  const {root,classes}=rootWithClasses('app-shell','dark');
  const context={document:{documentElement:root}};
  Object.defineProperty(context,'localStorage',{get(){throw Error('denied');}});
  assert.doesNotThrow(()=>runInNewContext(startup,context));
  assert.equal(classes.has('dark'),false);
  assert.ok(classes.has('app-shell'));
});
function luminance(hex:string) {
  const values=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return values[0]!*.2126+values[1]!*.7152+values[2]!*.0722;
}
test('dark palette text tokens and neutral solid controls remain readable',()=>{
  const css=readFileSync(new URL('../src/web/src/styles.css',import.meta.url),'utf8');
  const dark=css.match(/html\.dark\s*\{([^}]+)\}/)?.[1]; assert.ok(dark);
  const tokens=Object.fromEntries([...dark.matchAll(/(--[\w-]+):\s*(#[a-f\d]{6})/gi)].map(m=>[m[1],m[2]]));
  function contrast(a:string,b:string){assert.ok(a);assert.ok(b);const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
  for (const token of ['950','900','700','600','500','400']) assert.ok(contrast(tokens['--color-ink-'+token],tokens['--color-surface'])>=4.5,'ink-'+token+' contrast');
  assert.ok(contrast(tokens['--color-on-solid'],tokens['--color-brand'])>=4.5,'solid control contrast');
  assert.doesNotMatch(css,/button\.text-white\s*\{/,'must not override status backgrounds globally');
});
