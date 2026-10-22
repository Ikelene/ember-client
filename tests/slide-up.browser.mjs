// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium node tests/slide-up.browser.mjs
// New messages in an open conversation: the rows already on screen must glide up (many frames), not jump, whether the new
// message starts a group (name + picture) or is a header-less follow-up, from me or from someone else, and in bursts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dashboard = fileURLToPath(new URL('../', import.meta.url));
const chat = join(dashboard, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MessageList}from'${chat}/Messages.jsx';import{getState,patchState}from'${chat}/store.js';
localStorage.setItem('velora_token','test');
const now=Date.now(); const list=[]; for(let i=0;i<30;i++) list.push({id:'m'+i,body:'old '+i,attachments:[],author:{username:i%7<4?'Friend':'Tester'},created_at:now-(40-i)*60000,imId:i});
patchState({me:{username:'Tester'},signedIn:true,msgs:{'d:friend':{list,loaded:true,hasMore:false}}});
const view={kind:'dm',username:'Friend'};window.chatState=getState;
window.arrive=(id,who,body)=>{const b=getState().msgs['d:friend'];patchState({msgs:{...getState().msgs,'d:friend':{...b,list:[...b.list,{id,body,attachments:[],author:{username:who},created_at:Date.now(),imId:id}]}}});};
createRoot(document.getElementById('root')).render(<div className="vc"><main className="vc-main" style={{display:'flex',flexDirection:'column',height:'100vh'}}><MessageList view={view} onUser={()=>{}} onReply={()=>{}} canPost title={{icon:null,big:'Friend',sub:'t'}}/></main></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: dashboard }, jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(dashboard, 'src/styles.css'), 'utf8');
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url !== '/') { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><style>${css}body{margin:0}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }), errors = [];
  page.on('pageerror', e => errors.push(e.stack));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('.vc-msg[data-id="m29"]').waitFor();
  await page.waitForTimeout(800);
  // Per animation frame, the top of the last five old rows and of every row that arrives, while messages come in.
  const run = script => page.evaluate(async script => {
    const old = ['m25', 'm26', 'm27', 'm28', 'm29'], frames = [];
    const tops = () => { const o = {}; for (const el of document.querySelectorAll('.vc-msg[data-id]')) { const id = el.dataset.id; if (old.includes(id) || id.startsWith('x')) o[id] = el.getBoundingClientRect().top; } return o; };
    const before = tops(), sh = document.querySelector('.vc-scroll');
    let go = true, t0 = performance.now(); const tick = () => { frames.push({ t: Math.round(performance.now() - t0), tops: tops(), sh: sh.scrollHeight }); if (go) requestAnimationFrame(tick); }; tick();
    for (const step of script) {
      await new Promise(r => setTimeout(r, step.wait)); window.arrive(step.id, step.who, step.body);
      if (step.late) { await new Promise(r => setTimeout(r, step.late)); const rows = document.querySelectorAll('.vc-msg'); rows[rows.length - 1].style.paddingBottom = '14px'; }
    }
    await new Promise(r => setTimeout(r, 700)); go = false;
    return { before, frames, ids: script.map(x => x.id), ch: sh.clientHeight };
  }, script);
  // What it requires of each case (all measured from getBoundingClientRect().top, every frame):
  //  - every old row ends higher than it started, never moves down, and moves over >= 8 distinct frames;
  //  - no single-frame step bigger than 40% of the whole move (a jump), and the first frame after the arrival is still near the start;
  //  - each arriving row's first on-screen frame is below its final position by at least half its height (a slide, not a fade);
  //  - the scroll area never grows by more than the messages themselves (no transform inflating scrollHeight).
  function check(name, r) {
    const { before, frames, ids } = r;
    const f0 = frames.findIndex(f => ids.some(i => f.tops[i] !== undefined));
    assert.ok(f0 >= 0, name + ': the new row never appeared');
    for (const id of Object.keys(before)) {
      const seq = frames.slice(f0 - 1).map(f => f.tops[id]).filter(v => v !== undefined);
      const start = before[id], end = seq[seq.length - 1], dist = start - end;
      assert.ok(dist > 10, `${name}: ${id} moved up (${start} -> ${end})`);
      let steps = 0, big = 0, prev = seq[0];
      for (const v of seq.slice(1)) { assert.ok(v <= prev + 0.6, `${name}: ${id} never moves down (${prev} -> ${v})`); if (Math.abs(v - prev) > 0.5) steps++; big = Math.max(big, prev - v); prev = v; }
      assert.ok(steps >= 8, `${name}: ${id} glides over >= 8 frames (saw ${steps})`);
      assert.ok(big <= dist * 0.4 + 1, `${name}: ${id} has no jump (biggest step ${big.toFixed(1)}px of ${dist.toFixed(1)})`);
      assert.ok(seq[0] >= start - dist * 0.4 - 1, `${name}: ${id}'s first frame is still near where it was (${seq[0]} vs ${start})`);
    }
    for (const id of ids) {
      const seq = frames.map(f => f.tops[id]).filter(v => v !== undefined), end = seq[seq.length - 1];
      assert.ok(seq[0] > end + 8, `${name}: ${id} comes up from below (first ${seq[0]}, final ${end})`);
    }
    const grow = Math.max(...frames.map(f => f.sh)) - frames[frames.length - 1].sh;
    assert.ok(grow < 4, `${name}: scrollHeight not inflated mid-glide (by ${grow}px)`);
    return `${name}: old rows ${Object.values(before).map(Math.round).join('/')} -> ${Math.round(frames[frames.length - 1].tops.m29)}, ${frames.length} frames sampled`;
  }
  const cases = [
    ['a header-less follow-up from them', [{ wait: 100, id: 'x1', who: 'Friend', body: 'follow up' }]],
    ['a follow-up from me', [{ wait: 100, id: 'x2', who: 'Tester', body: 'mine' }]],
    ['a follow-up whose picture loads mid-glide', [{ wait: 100, id: 'x3', who: 'Friend', body: 'late', late: 60 }]],
    ['a burst of three from them', [{ wait: 100, id: 'x4', who: 'Friend', body: 'one' }, { wait: 90, id: 'x5', who: 'Friend', body: 'two' }, { wait: 90, id: 'x6', who: 'Friend', body: 'three' }]],
  ];
  for (const [name, script] of cases) checks.push(check(name, await run(script)));
  assert.deepEqual(errors, []);
} finally { await browser.close(); server.close(); }
console.log(checks.map(c => 'PASS ' + c).join('\n'));
