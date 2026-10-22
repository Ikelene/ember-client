// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium node tests/deferred-uploads.browser.mjs
// The real Composer + MessageList + store, against a local server that reads uploads slowly: files wait in the tray (size
// checked on drop), upload only when sent, show progress, leave the composer free, and the spoiler mark reaches the message.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dashboard = fileURLToPath(new URL('../', import.meta.url)), root = dashboard;
const out = process.env.UPLOAD_TEST_OUTPUT || join(root, 'test-results/deferred-uploads'); mkdirSync(out, { recursive: true });
const chat = join(dashboard, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MessageList,Composer}from'${chat}/Messages.jsx';import{getState}from'${chat}/store.js';
localStorage.setItem('velora_token','test');Object.assign(getState(),{me:{username:'Tester'},signedIn:true});
const view={kind:'dm',username:'Friend'};window.chatState=getState;
createRoot(document.getElementById('root')).render(<div className="vc"><main className="vc-main" style={{display:'flex',flexDirection:'column',height:'100vh'}}><MessageList view={view} onUser={()=>{}} onReply={()=>{}} canPost title={{icon:null,big:'Friend',sub:'Test conversation'}}/><Composer view={view} placeholder="Message @Friend" replyTo={null} setReplyTo={()=>{}}/></main></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: dashboard }, jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(dashboard, 'src/styles.css'), 'utf8');
const uploads = [];
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url === '/chat/media/limits') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ server_mb: 20, saved_mb: 20 })); }
  if (url === '/chat/media/external') { // read the body slowly so the progress bar has something to show
    let n = 0, body = '';
    req.on('data', c => { n += c.length; body += c.toString('latin1'); req.pause(); setTimeout(() => req.resume(), 40); });
    req.on('end', () => {
      const name = /filename="([^"]+)"/.exec(body)?.[1];
      uploads.push({ name, bytes: n });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ attachment: { url: `https://files.catbox.moe/abc${uploads.length}.png`, type: 'image', name, size: n } }));
    });
    return;
  }
  if (url.startsWith('/chat/') || url.startsWith('/im/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ messages: [], has_more: false })); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } }), errors = [], toasts = [];
  page.on('pageerror', e => errors.push(e.stack));
  await page.goto(url);
  await page.locator('.vc-input').waitFor();
  await page.waitForTimeout(300);
  // drop a picture that fits and one that's too big (the limit here is 20 MB)
  const drop = async files => {
    const dt = await page.evaluateHandle(fs => {
      const d = new DataTransfer();
      for (const [name, size, type] of fs) { const b = new Uint8Array(size); b.set([0x89, 0x50, 0x4e, 0x47]); d.items.add(new File([b], name, { type })); }
      return d;
    }, files);
    for (const t of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('.vc-input', t, { dataTransfer: dt });
  };
  await drop([['cat.png', 8 * 1024 * 1024, 'image/png'], ['huge.bin', 25 * 1024 * 1024, 'application/octet-stream']]);
  await page.locator('.vc-patt').first().waitFor();
  assert.equal(await page.locator('.vc-patt').count(), 1, 'only the file under the limit is queued');
  assert.equal(uploads.length, 0, 'nothing uploads on drop');
  assert.match(await page.evaluate(() => chatState().error), /huge\.bin is too big/);
  checks.push('drop: size checked against the server limit, nothing uploaded yet');
  await page.locator('.vc-patt-spoiler').click();
  assert.equal(await page.locator('.vc-patt.spoiler').count(), 1);
  checks.push('tray: spoiler toggle marks the file');
  await page.screenshot({ path: join(out, '1-tray.png') });
  await page.locator('.vc-input').click();
  await page.keyboard.type('look ||secret||');
  assert.equal(await page.locator('.vc-input .vc-md-spoiler').innerText(), 'secret');
  checks.push('composer: ||spoiler|| is styled while typing');
  await page.keyboard.press('Enter');
  await page.locator('.vc-upload-bar').waitFor();
  assert.equal(await page.locator('.vc-patt').count(), 0, 'the tray empties on send');
  assert.equal(await page.locator('.vc-input').innerText(), '', 'the composer is free again');
  // progress moves while the server reads
  await page.waitForFunction(() => { const s = document.querySelector('.vc-upload-track span'); return s && parseFloat(s.style.width) > 5 && parseFloat(s.style.width) < 100; }, null, { timeout: 15000 });
  const mid = await page.locator('.vc-upload-bar small').innerText();
  await page.screenshot({ path: join(out, '2-uploading.png') });
  checks.push('message: upload starts on send with a progress bar (' + mid + ')');
  // type and send another message meanwhile
  await page.keyboard.type('meanwhile');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.vc-text')].some(e => e.textContent.includes('meanwhile')));
  assert.equal(await page.locator('.vc-upload-bar').count(), 1, 'the upload is still going');
  checks.push('composer: another message sends during the upload');
  await page.locator('.vc-upload-bar').waitFor({ state: 'detached', timeout: 30000 });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].name, 'SPOILER_cat.png', 'the uploaded file carries the spoiler marker');
  const sent = await page.evaluate(() => chatState().msgs['d:friend']?.list || Object.values(chatState().msgs)[0].list);
  const last = sent[sent.length - 1];
  assert.equal(last.body, 'look ||secret||');
  assert.equal(last.attachments.length, 1);
  assert.match(last.attachments[0].url, /^https:\/\/files\.catbox\.moe\//, 'the real message carries the uploaded file, not the preview');
  assert.equal(last.attachments[0].name, 'SPOILER_cat.png');
  checks.push('after upload: the message is sent with its text and the uploaded (spoilered) file');
  await page.locator('.vc-att.spoiler, .vc-att-spoiler-box').first().waitFor();
  await page.screenshot({ path: join(out, '3-sent.png') });
  await page.locator('.vc-att-spoiler-cover').first().click();
  assert.equal(await page.locator('.vc-att.spoiler').count(), 0);
  checks.push('message: the spoilered picture is covered until clicked');
  assert.deepEqual(errors, []);
} finally { await browser.close(); server.close(); }
console.log(checks.map(c => 'PASS ' + c).join('\n'));
