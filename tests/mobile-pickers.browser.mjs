// Run from the repo root: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... ESBUILD_MODULE=... node tests/mobile-pickers.browser.mjs
// Phones: the composer's emoji and media pickers take the keyboard's place (pickerDock.js). The real Composer in a phone-sized
// touch page: opening a picker drops focus from the chat box (keyboard closes), the picker sits under the chat box (not a sheet),
// its search isn't focused, a picked emoji goes in without focusing the box and the picker stays open, the back button closes
// it, tapping the chat box closes it and focuses the box. A desktop-sized page keeps the pop-up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MessageList,Composer}from'${chat}/Messages.jsx';import{getState,connect}from'${chat}/store.js';import{initSheets}from'${chat}/sheets.js';
localStorage.setItem('velora_token','test');Object.assign(getState(),{me:{username:'Tester'},signedIn:true});
const view={kind:'channel',sid:'s1',cid:'c1'};Object.assign(getState().detail,{s1:{server:{sid:'s1',perms:257,allow_uploads:true,upload_max_mb:25},channels:[{cid:'c1',name:'c1',type:'text',overwrites:[]}],roles:[{rid:'r1',is_default:true,permissions:257}]}});getState().members.s1=[];connect();initSheets();
createRoot(document.getElementById('root')).render(<div className="vc"><main className="vc-main" style={{display:'flex',flexDirection:'column',height:'100vh'}}><MessageList view={view} onUser={()=>{}} onReply={()=>{}} canPost title={{icon:null,big:'Friend',sub:'Test'}}/><Composer view={view} placeholder="Message" replyTo={null} setReplyTo={()=>{}}/></main></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(root, 'src/styles.css'), 'utf8');
const EMOJI = JSON.parse(readFileSync(process.env.EMOJI_JSON || join(root, '../VELORA-modernui/public/assets/emoji/emoji.json'), 'utf8')); // (the real list Nookara serves)
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url.endsWith('.json') && url.includes('emoji')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(EMOJI)); }
  if (url.startsWith('/chat/') || url.startsWith('/im/') || url.startsWith('/bonfire/') || url.startsWith('/klipy') || url.startsWith('/account/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ messages: [], has_more: false, servers: [], emojis: [], stickers: [], items: [], results: [] })); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}:root{--accent:#a25cff}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
const pass = c => console.log('PASS', c);
const sockStub = () => { window.WebSocket = class { constructor() { this.readyState = 1; setTimeout(() => this.onopen?.({}), 0); } send() {} close() { this.readyState = 3; } addEventListener() {} }; window.WebSocket.OPEN = 1; };
const editor = '.vc-composer .vc-input';
const focused = page => page.evaluate(s => document.activeElement === document.querySelector(s), editor);
try {
  // ── a phone ──
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(sockStub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
  await page.goto(base + '/#/s1/c1');

  await page.waitForSelector(editor);
  await page.tap(editor);
  assert.equal(await focused(page), true);
  await page.tap('.vc-emoji-btn');
  await page.waitForSelector('.vc-picker-dock .vc-picker.docked');
  assert.equal(await focused(page), false, 'the chat box let go of focus (keyboard closes)');
  pass('emoji picker opens docked and the chat box loses focus');
  const geo = await page.evaluate(() => {
    const d = document.querySelector('.vc-picker-dock').getBoundingClientRect(), c = document.querySelector('.vc-composer').getBoundingClientRect();
    const p = document.querySelector('.vc-picker.docked');
    return { dockTop: d.top, dockBottom: d.bottom, dockH: d.height, composerBottom: c.bottom, sheet: p.hasAttribute('data-sheet'), back: !!document.querySelector('.vc-sheet-back'), searchFocused: document.activeElement?.closest?.('.vc-picker-search') != null, inner: innerHeight };
  });
  assert.equal(geo.sheet, false, 'not a sheet'); assert.equal(geo.back, false, 'no dimmed backdrop');
  assert.ok(geo.dockTop >= geo.composerBottom - 1, 'under the chat box');
  assert.ok(Math.abs(geo.dockBottom - geo.inner) <= 2, 'at the bottom of the screen');
  assert.ok(Math.abs(geo.dockH - Math.round(geo.inner * 0.4)) <= 2, `about 40% tall (${geo.dockH})`);
  assert.equal(geo.searchFocused, false, 'search not focused');
  pass('docked under the chat box, 40% tall, no sheet / backdrop, search not focused');
  await page.screenshot({ path: join(root, 'test-results/mobile-picker-emoji.png') });

  // pick an emoji: it goes in, the picker stays, the chat box isn't focused
  await page.waitForSelector('.vc-picker.docked .vc-em');
  await page.tap('.vc-picker.docked .vc-em');
  await page.waitForTimeout(100);
  assert.ok((await page.textContent(editor)).length > 0 || await page.$eval(editor, e => e.querySelectorAll('img, .vc-em-tw').length > 0), 'emoji inserted');
  assert.ok(await page.$('.vc-picker.docked'), 'picker still open');
  assert.equal(await focused(page), false);
  pass('a picked emoji goes in, the picker stays open, the keyboard stays closed');

  // back button closes it
  await page.goBack();
  await page.waitForSelector('.vc-picker-dock', { state: 'detached', timeout: 2000 });
  pass('back closes the docked picker');

  // GIF / media picker: docked too, search not focused; tapping the chat box closes it and focuses the box
  await page.tap('.vc-gif-btn');
  await page.waitForSelector('.vc-picker-dock .vc-picker.docked');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'INPUT'), false, 'media search not focused');
  await page.tap('.vc-picker.docked .vc-picker-tabs button:nth-child(2)');
  await page.waitForSelector('.vc-picker.docked input[placeholder="Search KLIPY"]');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'INPUT'), false, 'GIF search not focused');
  assert.deepEqual(errors, [], 'the GIFs tab opens without crashing');
  await page.tap(editor);
  await page.waitForSelector('.vc-picker-dock', { state: 'detached', timeout: 2000 });
  assert.equal(await focused(page), true, 'chat box focused again (keyboard back)');
  pass('media picker docks; tapping the chat box closes it and focuses the box');
  // the history entry the picker added is gone again (back doesn't land on a stale one)
  assert.equal(await page.evaluate(() => !!history.state?.vcDock), false);
  pass('no stale history entry');
  assert.deepEqual(errors, []);
  await ctx.close();

  // ── a desktop window: still a pop-up over the chat box ──
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await dctx.addInitScript(sockStub);
  const dp = await dctx.newPage();
  await dp.goto(base + '/#/s1/c1');
  await dp.waitForSelector(editor);
  await dp.click('.vc-emoji-btn');
  await dp.waitForSelector('.vc-emoji-picker');
  assert.equal(await dp.$('.vc-picker-dock'), null);
  assert.equal(await dp.$eval('.vc-emoji-picker', e => getComputedStyle(e).position), 'absolute');
  assert.equal(await dp.evaluate(() => document.activeElement?.closest?.('.vc-picker-search') != null), true, 'desktop still focuses the search');
  pass('desktop keeps the pop-up picker with its search focused');
  await dp.keyboard.press('Escape');
  await dp.click('.vc-gif-btn');
  await dp.click('.vc-picker .vc-picker-tabs button:nth-child(2)');
  await dp.waitForSelector('.vc-picker input[placeholder="Search KLIPY"]');
  assert.equal(await dp.evaluate(() => document.activeElement?.placeholder), 'Search KLIPY');
  pass('desktop: the GIFs tab opens with its search focused');
  await dctx.close();
  console.log('all ok');
} finally { await browser.close(); server.close(); }
