// Run from the repo root: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... ESBUILD_MODULE=... node tests/phone-typing-resume.browser.mjs
// Phones (Ikelene 2026-11-22):
//  1. @ / : suggestions keep following what you type while the keyboard is composing the word (they used to vanish at the first letter)
//  2. back from another app: a socket stuck connecting, or open but dead, is replaced within seconds; a healthy one is kept
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const opts = { nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' };
const composerEntry = `import React from 'react';import{createRoot}from'react-dom/client';import{MessageList,Composer}from'${chat}/Messages.jsx';import{getState}from'${chat}/store.js';
localStorage.setItem('velora_token','test');Object.assign(getState(),{me:{username:'Tester'},signedIn:true});
const view={kind:'channel',sid:'s1',cid:'c1'};Object.assign(getState().detail,{s1:{server:{sid:'s1',perms:257,allow_uploads:true,upload_max_mb:25},channels:[{cid:'c1',name:'c1',type:'text',overwrites:[]}],roles:[{rid:'r1',is_default:true,permissions:257}]}});getState().members.s1=[{username:'ikelene',id:7},{username:'tester',id:8}];
createRoot(document.getElementById('root')).render(<div className="vc"><main className="vc-main" style={{display:'flex',flexDirection:'column',height:'100vh'}}><MessageList view={view} onUser={()=>{}} onReply={()=>{}} canPost title={{icon:null,big:'Friend',sub:'Test'}}/><Composer view={view} placeholder="Message" replyTo={null} setReplyTo={()=>{}}/></main></div>);`;
const sockEntry = `import{getState,connect}from'${chat}/store.js';localStorage.setItem('velora_token','test');Object.assign(getState(),{me:{username:'Tester'},signedIn:true});connect();window.__ready=1;`;
const [composerJs, sockJs] = await Promise.all([composerEntry, sockEntry].map(c => build({ ...opts, stdin: { contents: c, loader: 'jsx', resolveDir: root } }).then(b => b.outputFiles[0].text)));
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(root, 'src/styles.css'), 'utf8');
const EMOJI = readFileSync(process.env.EMOJI_JSON || join(root, '../VELORA-modernui/public/assets/emoji/emoji.json'), 'utf8');
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/composer.js' || url === '/sock.js') { res.setHeader('content-type', 'text/javascript'); return res.end(url === '/sock.js' ? sockJs : composerJs); }
  if (url.endsWith('.json') && url.includes('emoji')) { res.setHeader('content-type', 'application/json'); return res.end(EMOJI); }
  if (url !== '/' && url !== '/sock') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ messages: [], has_more: false, servers: [], emojis: [], stickers: [], items: [], results: [], users: [] })); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}</style><div id="root"></div><script src="/${url === '/sock' ? 'sock' : 'composer'}.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
// a WebSocket we steer: 'stuck' never opens, 'dead' opens but never answers, 'alive' answers ping with pong
const sockStub = () => {
  window.__mode = 'stuck'; window.__socks = [];
  window.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; window.__socks.push(this); if (window.__mode !== 'stuck') setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0); }
    send(d) { this.sent.push(d); if (window.__mode === 'alive' && String(d).includes('"ping"')) setTimeout(() => this.onmessage?.({ data: '{"type":"pong"}' }), 0); }
    close() { this.readyState = 3; }
    addEventListener() {}
  };
  window.WebSocket.OPEN = 1;
};
const errors = [];
try {
  // ── 1. suggestions while the keyboard composes ──
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(sockStub);
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  await page.goto(base + '/');
  const editor = '.vc-composer .vc-input';
  await page.waitForSelector(editor);
  await page.focus(editor);
  // a phone keyboard: the word is typed inside a composition
  await page.$eval(editor, el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
  await page.keyboard.insertText('@ik');
  await page.waitForSelector('.vc-mentions .vc-mention-row', { timeout: 3000 });
  assert.deepEqual(await page.$$eval('.vc-mentions .vc-mention-row b', b => b.map(x => x.textContent)), ['ikelene']);
  console.log('PASS @ suggestions stay open (and filter) while the keyboard is composing');
  await page.click('.vc-mentions .vc-mention-row');
  assert.ok(await page.$eval(editor, el => /ikelene/.test(el.textContent)), 'picked mention went in');
  assert.equal(await page.$('.vc-mentions'), null);
  console.log('PASS picking one mid-composition puts it in and closes the list');
  await page.keyboard.insertText(' :smi');
  await page.waitForSelector('.vc-mentions .vc-mention-row', { timeout: 3000 });
  assert.ok((await page.$$eval('.vc-mentions .vc-mention-row b', b => b.map(x => x.textContent))).some(t => t.startsWith(':smi')));
  console.log('PASS : emoji suggestions too');
  await ctx.close();

  // ── 2. coming back to the app ──
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  await ctx2.addInitScript(sockStub);
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  await p2.clock.install();
  await p2.goto(base + '/sock');
  await p2.waitForFunction(() => window.__ready && window.__socks.length === 1);
  const back = () => p2.evaluate(() => dispatchEvent(new Event('focus')));
  const n = () => p2.evaluate(() => window.__socks.length);
  // stuck connecting (made while the app was asleep): coming back replaces it right away
  await p2.clock.runFor(3500);
  await p2.evaluate(() => { window.__mode = 'dead'; });
  await back();
  await p2.clock.runFor(50);
  assert.equal(await n(), 2);
  console.log('PASS a socket stuck connecting is replaced as soon as you come back');
  // open but dead (no answers): after a while away, coming back pings it and replaces it when nothing answers
  await p2.clock.runFor(31000);
  assert.equal(await n(), 2, 'nothing happens while away');
  await back();
  await p2.clock.runFor(1000);
  assert.equal(await n(), 2, 'it waits for the ping answer first');
  assert.ok(await p2.evaluate(() => window.__socks[1].sent.some(d => d.includes('"ping"'))));
  await p2.evaluate(() => { window.__mode = 'alive'; });
  await p2.clock.runFor(3000);
  assert.equal(await n(), 3);
  console.log('PASS an open socket that no longer answers is replaced within ~3.5 s of coming back');
  // healthy: the ping is answered, so it stays
  await p2.clock.runFor(40000);
  await back();
  await p2.clock.runFor(5000);
  assert.equal(await n(), 3);
  console.log('PASS a socket that answers is kept');
  // a connect that never opens on its own (no coming back) is retried after 8 s, not left hanging
  await p2.evaluate(() => { window.__mode = 'stuck'; window.__socks[2].readyState = 3; window.__socks[2].onclose?.({}); });
  await p2.clock.runFor(2500); // the retry after the close (backoff ~1 s)
  const k = await n();
  assert.equal(k, 4);
  await p2.clock.runFor(8100); // it never opens: dropped at 8 s, then retried
  await p2.clock.runFor(3000);
  assert.ok(await n() > k, 'a hanging connect is retried');
  console.log('PASS a connect that hangs is given up after 8 s and retried');
  await ctx2.close();
  assert.deepEqual(errors, []);
  console.log('all ok');
} finally { await browser.close(); server.close(); }
