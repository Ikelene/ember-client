// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... ESBUILD_MODULE=... node tests/voice-messages.browser.mjs
// The real Composer + MessageList + store with Chromium's fake microphone, a local upload server and a stub socket that records what
// would have been sent: recording, sending, playback and discarding in DMs, group chats and channels, by mouse and by real touch events.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = process.env.VOICE_TEST_OUTPUT || join(root, 'test-results/voice-messages'); mkdirSync(out, { recursive: true });
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MessageList,Composer}from'${chat}/Messages.jsx';import{getState,patchState,connect,askSendUnsigned,handleEvent,editMessage}from'${chat}/store.js';import{connections}from'${chat}/instances.js';import{setupSigning}from'${chat}/signing.js';import{registry}from'${chat}/ids.js';import{AskHost}from'${chat}/Dialogs.jsx';
localStorage.setItem('velora_token','test');Object.assign(getState(),{me:{username:'Tester'},signedIn:true});
const q=new URLSearchParams(location.search),kind=q.get('kind')||'dm';
const O='https://inst.test';const view=kind==='inst'?{kind:'channel',sid:O+'|s1',cid:O+'|c1'}:kind==='group'?{kind:'group',room:'grp_1'}:kind==='channel'?{kind:'channel',sid:'s1',cid:'c1'}:{kind:'dm',username:'Friend'};
if(kind==='channel'){const allow=q.get('uploads')!=='no';Object.assign(getState().detail,{s1:{server:{sid:'s1',perms:allow?256|1:1,allow_uploads:allow,upload_max_mb:25},channels:[{cid:'c1',name:'c1',type:'text',overwrites:[]}],roles:[{rid:'r1',is_default:true,permissions:allow?257:1}]}});getState().members.s1=[];}
if(kind==='inst'){window.sentFrames=[];connections.set(O,{origin:O,info:{accounts_mode:'velora'},session:{token:'x'},user:{id:5,username:'Tester',velora_id:1,kind:'velora'},ws:{readyState:1,send:s=>window.sentFrames.push(JSON.parse(s))},status:'open',retry:0,acks:new Map()});registry.set?.(O,connections.get(O));getState().detail[O+'|s1']={server:{sid:O+'|s1',perms:257,allow_uploads:true,upload_max_mb:25},channels:[{cid:O+'|c1',name:'c1',type:'text',overwrites:[]}],roles:[{rid:'r1',is_default:true,permissions:257}]};getState().members[O+'|s1']=[];setupSigning();}
window.handleEvent=handleEvent;window.editMessage=editMessage;window.INST=O;window.chatState=getState;window.patchChat=patchState;window.askSendUnsigned=askSendUnsigned;window.chatView=view;connect();
createRoot(document.getElementById('root')).render(<div className="vc"><main className="vc-main" style={{display:'flex',flexDirection:'column',height:'100vh'}}><MessageList view={view} onUser={()=>{}} onReply={()=>{}} canPost title={{icon:null,big:'Friend',sub:'Test'}}/><Composer view={view} placeholder="Message" replyTo={null} setReplyTo={()=>{}}/><AskHost/></main></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(root, 'src/styles.css'), 'utf8');
const tempId = n => String(n).padStart(22, 'A'); // (22 characters, like the real ones)
const signingKey = { kid: 'k1', private_key: generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url') };
const uploads = []; // { name, type, bytes }
const fileOf = (body, boundary) => {
  const start = body.indexOf(Buffer.from('\r\n\r\n')) + 4, end = body.indexOf(Buffer.from(`\r\n--${boundary}`), start);
  const head = body.subarray(0, start).toString('latin1');
  return { name: /filename="([^"]+)"/.exec(head)?.[1], type: /Content-Type: (\S+)/i.exec(head)?.[1], bytes: body.subarray(start, end) };
};
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url === '/bonfire/session') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ effective: 65535 })); }
  if (url === '/bonfire/signing-key') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(signingKey)); }
  if (url === '/chat/media/limits') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ server_mb: 20, saved_mb: 20 })); }
  if (url === '/chat/media/temp') {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => {
      const f = fileOf(Buffer.concat(parts), /boundary=(.+)$/.exec(req.headers['content-type'])[1]);
      uploads.push(f);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ attachment: { url: `https://cdn.nookara.cc/temp/${tempId(uploads.length)}/${f.name}`, type: 'audio', name: f.name, size: f.bytes.length } }));
    });
    return;
  }
  if (url.startsWith('/chat/') || url.startsWith('/im/') || url.startsWith('/groups/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ messages: [], has_more: false, expires_in: 86400 })); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}:root{--accent:#a25cff}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const checks = [];
const pass = c => { checks.push(c); console.log('PASS', c); };
const sockStub = () => {
  window.sentFrames = [];
  window.WebSocket = class { constructor() { this.readyState = 1; setTimeout(() => this.onopen?.({}), 0); } send(s) { window.sentFrames.push(JSON.parse(s)); } close() { this.readyState = 3; } addEventListener() {} };
  window.WebSocket.OPEN = 1;
};
async function open(ctxOpts = {}, query = '', init) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 }, ...ctxOpts });
  await ctx.addInitScript(sockStub);
  await ctx.addInitScript(() => { window.soundsPlayed = []; const A = window.Audio; window.Audio = function (u) { const a = new A(u); window.soundsPlayed.push(String(u)); a.play = () => Promise.resolve(); return a; }; });
  if (init) await ctx.addInitScript(init);
  await ctx.route('https://inst.test/uploads/**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'video/webm' }, body: uploads[uploads.length - 1]?.bytes || Buffer.alloc(0) }));
  await ctx.route('https://cdn.nookara.cc/**', route => {
    const i = Number(/\/temp\/A+(\d+)\//.exec(route.request().url())?.[1]) - 1;
    const body = uploads[i]?.bytes || Buffer.alloc(0), headers = { 'access-control-allow-origin': '*', 'content-type': uploads[i]?.type || 'audio/webm', 'accept-ranges': 'bytes' };
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || ''); // like the real CDN: a player can't seek without ranges
    if (!range) return route.fulfill({ status: 200, headers, body });
    const from = Number(range[1]), to = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    return route.fulfill({ status: 206, headers: { ...headers, 'content-range': `bytes ${from}-${to}/${body.length}` }, body: body.subarray(from, to + 1) });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.stack));
  await page.goto(`${base}/${query}`);
  await page.locator('.vc-composer').waitFor({ timeout: 10000 }).catch(e => { throw new Error(`no composer: ${page.errors.join(' | ').slice(0, 800)} ${e.message.slice(0, 100)}`); });
  await page.waitForTimeout(150);
  return page;
}
const frames = page => page.evaluate(() => window.sentFrames.filter(f => ['im_send', 'roomMessage', 'chat_send'].includes(f.type)));
const SEND = '.vc-ico-btn.send';
const gone = async (page, sel) => assert.equal(await page.locator(sel).count(), 0, `${sel} should be hidden`);
async function touch(page, steps) { // real touch events, so pointerType is 'touch'
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator(SEND).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await steps(async dx => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y }] }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
try {
  // ── desktop ──
  let page = await open();
  await page.locator(`${SEND}.voice`).waitFor();
  const look = await page.locator(SEND).evaluate(e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, color: s.color, radius: s.borderRadius, disabled: e.disabled, icon: e.querySelector('svg').getAttribute('class') }; });
  assert.equal(look.bg, 'rgb(162, 92, 255)');
  assert.equal(look.color, 'rgb(255, 255, 255)');
  assert.equal(look.radius, '0px');
  assert.equal(look.disabled, false);
  assert.match(look.icon, /audio-lines/);
  await page.locator('.vc-composer').screenshot({ path: join(out, '1-empty.png') });
  pass('empty box: send button is a soundwave in a filled accent box, square');
  await page.locator('.vc-input').click();
  await page.keyboard.type('hello');
  assert.equal(await page.locator(`${SEND}.voice`).count(), 0);
  assert.match(await page.locator(`${SEND} svg`).getAttribute('class'), /send-horizontal/);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await page.locator(`${SEND}.voice`).waitFor();
  pass('typing brings the normal send button back, clearing it brings the soundwave back');
  await page.locator(SEND).click();
  await page.locator('.vc-voice-wave').waitFor();
  await gone(page, '.vc-gif-btn'); await gone(page, '.vc-emoji-btn'); await gone(page, '.vc-ico-btn[title="Upload a file"]');
  assert.equal(await page.locator('.vc-input').isVisible(), false);
  assert.match(await page.locator(`${SEND} svg`).getAttribute('class'), /send-horizontal/);
  await page.locator('.vc-voice-discard').waitFor();
  pass('desktop click: records, button becomes send, discard shows, emoji + GIF + upload hide, text box hides');
  await page.waitForTimeout(1500);
  const drawn = await page.locator('.vc-voice-wave').evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  assert.ok(drawn > 100, `waveform drawn (${drawn} pixels)`);
  await page.locator('.vc-composer').screenshot({ path: join(out, '2-recording-desktop.png') });
  pass(`live waveform draws from the mic (${drawn} pixels)`);
  await page.locator(SEND).click();
  await page.waitForFunction(() => window.sentFrames.some(f => f.type === 'im_send'), null, { timeout: 15000 });
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].name, /^voice-message-\d+-\d+\.(weba|m4a|ogg)$/);
  assert.match(uploads[0].type, /^audio\/(webm|mp4|ogg)$/);
  assert.ok(uploads[0].bytes.length > 500, `recorded ${uploads[0].bytes.length} bytes`);
  assert.equal(uploads[0].bytes.readUInt32BE(0), 0x1a45dfa3, 'a real webm, what the upload check looks for');
  let sent = await frames(page);
  assert.match(sent[0].message, new RegExp(uploads[0].name));
  await page.locator(`${SEND}.voice`).waitFor();
  await page.locator('.vc-input').waitFor();
  pass(`desktop send: uploaded ${uploads[0].name} (${uploads[0].bytes.length} bytes, ${uploads[0].type}) and sent it in the DM`);
  assert.deepEqual(await page.evaluate(() => window.soundsPlayed.map(s => s.match(/(voice-\w+)\.mp3/)?.[1]).filter(Boolean)), ['voice-start', 'voice-send']);
  pass('sounds: starting and sending each play once');
  // the recipient's side: the message as it comes back
  await page.evaluate(body => { const k = 'd:friend'; const s = window.chatState(); window.patchChat({ msgs: { ...s.msgs, [k]: { list: [{ id: 'im1', imId: 1, body, attachments: [], author: { username: 'Friend' }, created_at: Date.now() }], loaded: true, hasMore: false } } }); }, sent[0].message);
  await page.locator('.vc-mp.voice').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => { const a = document.querySelector('.vc-mp.voice audio'); return a && Number.isFinite(a.duration) && a.duration > 0; }, null, { timeout: 10000 });
  const dur = await page.locator('.vc-mp.voice audio').evaluate(a => a.duration);
  assert.ok(dur > 0.8 && dur < 6, `duration ${dur}`);
  pass(`playback: a voice player shows, and a recording without a stored duration gets a real one (${dur.toFixed(2)} s)`);
  await page.waitForFunction(() => new Set([...document.querySelectorAll('.vc-mp-vwave i')].map(i => i.style.height)).size > 3);
  await page.locator('.vc-mp.voice .vc-mp-play').click();
  await page.waitForFunction(() => { const a = document.querySelector('.vc-mp.voice audio'); return !a.paused && a.currentTime > 0.1; }, null, { timeout: 5000 });
  await page.locator('.vc-mp.voice').screenshot({ path: join(out, '3-player.png') });
  await page.locator('.vc-mp.voice .vc-mp-play').click();
  const wave = await page.locator('.vc-mp-vwave').boundingBox();
  await page.mouse.click(wave.x + wave.width * 0.75, wave.y + wave.height / 2);
  await page.waitForFunction(d => Math.abs(document.querySelector('.vc-mp.voice audio').currentTime - d * 0.75) < 0.35, dur);
  await page.waitForFunction(() => document.querySelectorAll('.vc-mp-vwave i.on').length > 20);
  pass('playback: plays, pauses, decoded waveform, clicking the waveform seeks');
  assert.deepEqual(page.errors, []);
  await page.context().close();

  // ── discard + Escape + switching away ──
  page = await open();
  const before = uploads.length;
  await page.locator(SEND).click();
  await page.locator('.vc-voice-wave').waitFor();
  await page.waitForTimeout(500);
  await page.locator('.vc-voice-discard').click();
  await page.locator('.vc-input').waitFor();
  await page.locator('.vc-gif-btn').waitFor();
  await page.locator(SEND).click();
  await page.locator('.vc-voice-wave').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.vc-input').waitFor();
  await page.waitForTimeout(400);
  assert.equal(uploads.length, before); assert.equal((await frames(page)).length, 0);
  pass('desktop discard: the bin and Escape both drop it, nothing uploads or sends, the buttons come back');
  const played = await page.evaluate(() => window.soundsPlayed.map(s => s.match(/([\w-]+)\.mp3/)?.[1]).filter(s => s?.startsWith('voice-')));
  assert.deepEqual(played, ['voice-start', 'voice-delete', 'voice-start', 'voice-delete']);
  pass('sounds: starting and deleting each play once, the bin and Escape alike');
  assert.deepEqual(page.errors, []);
  await page.context().close();

  // ── touch ──
  page = await open({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  let n = uploads.length;
  await touch(page, async () => {
    await page.locator('.vc-voice-wave').waitFor();
    await gone(page, '.vc-gif-btn'); await gone(page, '.vc-emoji-btn');
    assert.equal(await page.locator('.vc-input').isVisible(), false);
    await page.locator('.vc-voice-hint.slide').waitFor();
    await gone(page, '.vc-voice-discard');
    await page.waitForTimeout(1200);
    await page.locator('.vc-composer').screenshot({ path: join(out, '4-recording-touch.png') });
  });
  await page.waitForFunction(() => window.sentFrames.some(f => f.type === 'im_send'), null, { timeout: 15000 });
  assert.equal(uploads.length, n + 1);
  pass('touch: holding records with the live waveform in place of the box, letting go sends');
  n = uploads.length;
  let count = (await frames(page)).length;
  await page.locator(`${SEND}.voice`).waitFor();
  await touch(page, async move => {
    await page.locator('.vc-voice-wave').waitFor();
    await page.waitForTimeout(600);
    await move(-60);
    await page.waitForTimeout(100);
    await move(-130);
    await page.locator('.vc-voice-hint.armed').waitFor();
    await page.locator('.vc-composer').screenshot({ path: join(out, '5-swipe.png') });
  });
  await page.locator('.vc-input').waitFor();
  await page.waitForTimeout(500);
  assert.equal(uploads.length, n); assert.equal((await frames(page)).length, count);
  pass('touch: sliding left past the line deletes it, nothing uploads or sends');
  await touch(page, async () => { await page.waitForTimeout(120); });
  await page.waitForTimeout(500);
  assert.equal(uploads.length, n); assert.equal((await frames(page)).length, count);
  assert.match(await page.evaluate(() => window.chatState().error || ''), /Hold the button/);
  pass('touch: a quick tap sends nothing and says to hold');
  assert.deepEqual(page.errors, []);
  await page.context().close();

  // ── mic refused ──
  for (const [name, re] of [['NotAllowedError', /Allow it/], ['NotFoundError', /No microphone/]]) {
    page = await open({}, '', `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', '${name}'));`);
    await page.locator(SEND).click();
    await page.locator('.vc-voice-error').waitFor();
    assert.match(await page.locator('.vc-voice-error').innerText(), re);
    await page.locator(`${SEND}.voice`).waitFor();
    await page.locator('.vc-input').waitFor();
    if (name === 'NotAllowedError') await page.locator('.vc-composer-wrap').screenshot({ path: join(out, '6-denied.png') });
    pass(`mic ${name}: a clear message, no crash, the button stays there to try again`);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }

  // ── group chat + server channel ──
  page = await open({}, '?kind=group');
  await page.locator(SEND).click();
  await page.locator('.vc-voice-wave').waitFor();
  await page.waitForTimeout(800);
  await page.locator(SEND).click();
  await page.waitForFunction(() => window.sentFrames.some(f => f.type === 'roomMessage'), null, { timeout: 15000 });
  sent = await frames(page);
  assert.match(sent[0].message, /voice-message-\d+-\d+\./);
  assert.equal(sent[0].room, 'grp_1');
  pass('group chat: the voice message goes out as a roomMessage carrying the link');
  assert.deepEqual(page.errors, []);
  await page.context().close();

  page = await open({}, '?kind=channel');
  await page.locator(`${SEND}.voice`).waitFor();
  await page.locator(SEND).click();
  await page.locator('.vc-voice-wave').waitFor();
  await page.waitForTimeout(800);
  await page.locator(SEND).click();
  await page.waitForFunction(() => window.sentFrames.some(f => f.type === 'chat_send'), null, { timeout: 15000 });
  sent = await frames(page);
  assert.equal(sent[0].channel, 'c1');
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(sent[0].attachments[0].type, 'audio');
  assert.match(sent[0].attachments[0].name, /^voice-message-/);
  pass('server channel: the voice message goes out as a chat_send audio attachment');
  // an instance community's server sniffs webm as video, keeping the name
  await page.evaluate(i => { const s = window.chatState(); window.patchChat({ msgs: { ...s.msgs, 'c:c1': { list: [{ id: 'm1', body: '', attachments: [{ url: i, type: 'video', name: 'voice-message-1793700000000-2000.webm' }], author: { username: 'Friend' }, created_at: Date.now() }], loaded: true, hasMore: false } } }); }, `https://inst.test/uploads/${uploads.length}.webm`);
  await page.locator('.vc-mp.voice').waitFor({ timeout: 5000 });
  await gone(page, '.vc-mp.video');
  pass('server channel: a voice file a server classed as video still gets the voice player');
  assert.deepEqual(page.errors, []);
  await page.context().close();

  page = await open({}, '?kind=channel&uploads=no');
  await gone(page, `${SEND}.voice`);
  assert.equal(await page.locator(SEND).isDisabled(), true);
  pass('no upload permission in a channel: no record button, the normal disabled send');
  await page.context().close();

  // ── signing fails, in a community that signs ──
  const failSign = `{ const real = crypto.subtle.sign.bind(crypto.subtle); crypto.subtle.sign = (...a) => (window.failSign ? Promise.reject(new Error('no')) : real(...a)); }`;
  page = await open({}, '?kind=inst', failSign);
  const chatSends = () => page.evaluate(() => window.sentFrames.filter(f => f.type === 'chat_send'));
  await page.waitForFunction(() => window.chatState().signing?.state === 'ready', null, { timeout: 5000 });
  const say = async t => { await page.locator('.vc-input').click(); await page.keyboard.type(t); await page.keyboard.press('Enter'); };
  await say('signed one');
  await page.waitForFunction(() => window.sentFrames.some(f => f.type === 'chat_send'));
  let cs = await chatSends();
  assert.ok(cs[0].signature?.sig, 'a working key signs as before');
  assert.equal(await page.locator('.vc-ask').count(), 0);
  pass('signing works: signed, no question asked');
  await page.evaluate(() => { window.failSign = true; });
  await say('cancel me');
  await page.locator('.vc-ask').waitFor();
  assert.equal((await chatSends()).length, 1, 'nothing goes out while it asks');
  await page.locator('.vc-ask button[type=button]', { hasText: 'Cancel' }).click();
  await page.locator('.vc-fail').waitFor();
  assert.match(await page.locator('.vc-fail').innerText(), /couldn't be signed[\s\S]*Try again/);
  assert.equal((await chatSends()).length, 1);
  pass('signing fails + Cancel: nothing is sent, the message stays with Try again, its text kept');
  await page.locator('.vc-fail button', { hasText: 'Try again' }).click();
  await page.locator('.vc-ask').waitFor();
  await page.locator('.vc-ask button[type=submit]').click();
  await page.waitForFunction(() => window.sentFrames.filter(f => f.type === 'chat_send').length === 2);
  cs = await chatSends();
  assert.equal(cs[1].message, 'cancel me');
  assert.equal(cs[1].signature, undefined);
  pass('signing fails + Send unsigned: the same message goes out with no signature');
  await page.evaluate(() => { window.failSign = false; });
  await page.locator('.vc-ask').waitFor({ state: 'detached' });
  await say('server says no');
  await page.waitForFunction(() => window.sentFrames.filter(f => f.type === 'chat_send').length === 3);
  cs = await chatSends();
  assert.ok(cs[2].signature?.sig);
  await page.evaluate(n => window.handleEvent({ type: 'chat_error', error: 'bad_signature', nonce: n }, window.INST), cs[2].nonce);
  await page.locator('.vc-ask').waitFor();
  await page.locator('.vc-ask button[type=submit]').click();
  await page.waitForFunction(() => window.sentFrames.filter(f => f.type === 'chat_send').length === 4);
  cs = await chatSends();
  assert.equal(cs[3].message, 'server says no'); assert.equal(cs[3].nonce, cs[2].nonce); assert.equal(cs[3].signature, undefined);
  pass('the server turns the signature down: same choice, resent unsigned under the same nonce');
  const patches = [];
  await page.route('https://inst.test/**', route => { if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON()); route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' }); });
  await page.evaluate(() => { window.failSign = true; window.editDone = window.editMessage('m1', 'edited', { channel: window.chatView.cid, server: window.chatView.sid, attachments: [] }).then(() => 'saved', e => e.message); });
  await page.locator('.vc-ask').waitFor();
  assert.match(await page.locator('.vc-ask button[type=submit]').innerText(), /Save unsigned/);
  await page.locator('.vc-ask button[type=submit]').click();
  assert.equal(await page.evaluate(() => window.editDone), 'saved');
  assert.equal(patches.length, 1); assert.equal(patches[0].signature, undefined);
  await page.locator('.vc-ask').waitFor({ state: 'detached' });
  await page.evaluate(() => { window.editDone = window.editMessage('m1', 'edited', { channel: window.chatView.cid, server: window.chatView.sid, attachments: [] }).then(() => 'saved', e => e.message); });
  await page.locator('.vc-ask').waitFor();
  await page.locator('.vc-ask button[type=button]', { hasText: 'Cancel' }).click();
  assert.equal(await page.evaluate(() => window.editDone), 'sign_failed');
  assert.equal(patches.length, 1);
  pass('editing: the same choice, and Cancel leaves the message alone');
  assert.deepEqual(page.errors, []);
  await page.context().close();

  // ── the unsigned choice ──
  page = await open();
  const answer = page.evaluate(() => window.askSendUnsigned().then(v => { window.unsignedAnswer = v; return v; }));
  await page.locator('.vc-ask').waitFor();
  assert.match(await page.locator('.vc-ask').innerText(), /couldn't be signed[\s\S]*marked as unsigned/);
  await page.locator('.vc-ask').screenshot({ path: join(out, '7-unsigned.png') });
  await page.locator('.vc-ask button[type=submit]').click();
  assert.equal(await answer, true);
  await page.locator('.vc-ask').waitFor({ state: 'detached' });
  const answer2 = page.evaluate(() => window.askSendUnsigned(true));
  await page.locator('.vc-ask').waitFor();
  assert.match(await page.locator('.vc-ask button[type=submit]').innerText(), /Save unsigned/);
  await page.locator('.vc-ask button[type=button]', { hasText: 'Cancel' }).click();
  assert.equal(await answer2, false);
  pass('unsigned choice: the dialog explains it, Send unsigned says yes, Cancel says no');
  await page.context().close();
} finally { await browser.close(); server.close(); }
console.log(`${checks.length} checks passed`);
