// Run from the repo root: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... ESBUILD_MODULE=... node tests/unread-pills.browser.mjs
// The sidebar's "New Mentions" / "New Unreads" pills (UnreadPills.jsx): the real ServerSidebar and HomeSidebar with long lists.
// A pill shows on the edge where hidden unread rows are, red for mentions, white for plain unreads; clicking it scrolls the
// nearest one into view; rows that come into view or get read take the pill away. Square in Classic, round in Modern.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{ServerSidebar,HomeSidebar}from'${chat}/Parts.jsx';import{getState,patchState}from'${chat}/store.js';
localStorage.setItem('velora_token','test');Object.assign(getState(),{me:{username:'Tester'},signedIn:true,connected:true,conn:'open'});
const channels=Array.from({length:40},(_,i)=>({cid:'c'+i,name:'channel-'+i,type:'text',category:'',position:i,overwrites:[]}));
Object.assign(getState().detail,{s1:{server:{sid:'s1',name:'Test',perms:257,role:'member'},channels,roles:[{rid:'r1',is_default:true,permissions:257}]}});
const dms=Array.from({length:40},(_,i)=>({username:'friend'+i,unread:0,last:Date.now()-i*1000}));
patchState({view:{kind:'channel',sid:'s1',cid:'c5'},dms});
window.__state={getState,patchState};
const which=location.hash.slice(1);
createRoot(document.getElementById('root')).render(<div className="vc" style={{display:'flex',height:'100vh'}}><div className="vc-side-col">{which==='home'?<HomeSidebar onNewDM={()=>{}} onNewGroup={()=>{}} onQuick={()=>{}}/>:<ServerSidebar sid="s1" onInvite={()=>{}} onSettings={()=>{}} onChannel={()=>{}} onLeave={()=>{}} onUser={()=>{}}/>}</div></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(root, 'src/styles.css'), 'utf8') + readFileSync(join(chat, 'modern.css'), 'utf8');
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url !== '/') { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#111}:root{--accent:#a25cff;--red:#f04747}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
const pass = c => console.log('PASS', c);
const pills = page => page.evaluate(() => [...document.querySelectorAll('.vc-unread-pill')].map(p => `${p.classList.contains('up') ? 'up' : 'down'}:${p.classList.contains('mention') ? 'mention' : 'unread'}:${p.textContent.trim()}`).sort());
const waitPills = async (page, want) => { for (let i = 0; i < 40; i++) { const got = await pills(page); if (JSON.stringify(got) === JSON.stringify(want)) return; await page.waitForTimeout(25); } assert.deepEqual(await pills(page), want); };
const inView = (page, sel) => page.evaluate(s => { const l = document.querySelector('.vc-side-list').getBoundingClientRect(), r = document.querySelector(s).getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }, sel);
try {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 500 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });

  // ── server channels ──
  await page.goto(base + '/#server');
  await page.waitForSelector('.vc-side-list .vc-ch');
  await waitPills(page, []);
  pass('no pills with nothing unread');
  await page.evaluate(() => { const { patchState, getState } = window.__state; patchState({ unread: { ...getState().unread, 'c:c30': 1 } }); });
  await waitPills(page, ['down:unread:New Unreads']);
  pass('a plain unread below the fold: white New Unreads at the bottom');
  await page.waitForTimeout(400); await page.screenshot({ path: join(root, 'test-results/unread-pill-down.png') });
  await page.evaluate(() => { const { patchState, getState } = window.__state; patchState({ mentions: { ...getState().mentions, c36: 2 } }); });
  await waitPills(page, ['down:mention:New Mentions']);
  assert.equal(await page.$eval('.vc-unread-pill.mention', e => getComputedStyle(e).borderRadius), '0px', 'square in Classic');
  pass('a mention below wins: red New Mentions, square corners in Classic');
  await page.click('.vc-unread-pill.down');
  await page.waitForTimeout(700);
  assert.equal(await inView(page, '.vc-ch:nth-child(37)'), true, 'channel-36 scrolled into view');
  pass('clicking the pill scrolls to the nearest mention');
  // channel-30 (unread) is now above or in view; scroll to the bottom so both are above
  await page.$eval('.vc-side-list', l => { l.scrollTop = l.scrollHeight; });
  await page.waitForTimeout(100);
  await page.$eval('.vc-side-list', l => { l.scrollTop = 0; });
  await waitPills(page, ['down:mention:New Mentions']);
  await page.evaluate(() => { const { patchState, getState } = window.__state; patchState({ mentions: { ...getState().mentions, c36: 0 }, unread: { ...getState().unread, 'c:c30': 0, 'c:c2': 0 } }); });
  await waitPills(page, []);
  pass('reading them takes the pill away');
  // one above: scroll down, mark channel-1 unread
  await page.$eval('.vc-side-list', l => { l.scrollTop = l.scrollHeight; });
  await page.evaluate(() => { const { patchState, getState } = window.__state; patchState({ unread: { ...getState().unread, 'c:c1': 1 } }); });
  await waitPills(page, ['up:unread:New Unreads']);
  await page.screenshot({ path: join(root, 'test-results/unread-pill-up.png') });
  await page.click('.vc-unread-pill.up');
  await waitPills(page, []);
  pass('an unread above: pill at the top, clicking scrolls up to it and the pill goes');

  // Modern: round
  await page.evaluate(() => document.documentElement.classList.add('vc-rounded'));
  await page.$eval('.vc-side-list', l => { l.scrollTop = l.scrollHeight; });
  await waitPills(page, ['up:unread:New Unreads']);
  assert.equal(await page.$eval('.vc-unread-pill', e => getComputedStyle(e).borderRadius), '999px');
  pass('round in Modern');

  // ── Home: DMs ──
  const hp = await ctx.newPage();
  hp.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  await hp.goto(base + '/#home');
  await hp.waitForSelector('.vc-side-list .vc-dm');
  await hp.evaluate(() => { const { patchState, getState } = window.__state; patchState({ dms: getState().dms.map((d, i) => (i === 35 ? { ...d, unread: 3 } : d)) }); });
  await waitPills(hp, ['down:mention:New Mentions']);
  await hp.waitForTimeout(400); await hp.screenshot({ path: join(root, 'test-results/unread-pill-home.png') });
  pass('an unread DM below: red New Mentions (DMs count like mentions)');
  await hp.click('.vc-unread-pill.down');
  await waitPills(hp, []);
  pass('clicking it scrolls the DM into view');

  // ── a phone-sized page, German ──
  const mctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true, locale: 'de-DE' });
  const mp = await mctx.newPage();
  mp.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  await mp.goto(base + '/#server');
  await mp.waitForSelector('.vc-side-list .vc-ch');
  await mp.evaluate(() => { const { patchState, getState } = window.__state; patchState({ mentions: { ...getState().mentions, c38: 1 } }); });
  await waitPills(mp, ['down:mention:Neue Erwähnungen']);
  await mp.tap('.vc-unread-pill.down');
  await waitPills(mp, []);
  pass('phone: the pill shows (in German) and a tap scrolls to it');
  assert.deepEqual(errors, []);
  console.log('all ok');
} finally { await browser.close(); server.close(); }
