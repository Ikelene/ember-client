// Run from the repo root: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... node tests/server-settings-crop.browser.mjs
// Server settings (Ikelene 2026-11-16): Overview is the first tab and there's no Dashboard tab; uploading a server icon or banner
// opens the crop tool (square / the banner's shape) and what goes up is the cropped picture at the recommended size.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{ServerSettings}from'${chat}/ServerSettings.jsx';import{getState}from'${chat}/store.js';
localStorage.setItem('velora_token','test');Object.assign(getState(),{me:{username:'Tester'},signedIn:true});
Object.assign(getState().detail,{s1:{server:{sid:'s1',name:'Test server',perms:0x7fffffff,role:'owner'},channels:[],roles:[]}});
createRoot(document.getElementById('root')).render(<div className="vc"><ServerSettings sid="s1" onClose={()=>{}}/></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
const css = ['src/chat/chat.css', 'src/styles.css', 'src/chat/SettingsDialog.css'].map(f => readFileSync(join(root, f), 'utf8')).join('\n');
const uploads = [];
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#111}</style><div id="root"></div><script src="/app.js"></script>`); }
  if (req.method === 'POST' && /\/chat\/servers\/s1\/(icon|banner)$/.test(url)) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { uploads.push({ kind: url.split('/').pop(), body: Buffer.concat(chunks) }); res.setHeader('content-type', 'application/json'); res.end('{"server":{}}'); });
    return undefined;
  }
  res.setHeader('content-type', 'application/json');
  if (url === '/chat/servers/s1') return res.end(JSON.stringify({ server: { sid: 's1', name: 'Test server', perms: 0x7fffffff, role: 'owner' }, channels: [], roles: [] }));
  res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
const pass = c => console.log('PASS', c);
// the size of the WebP / PNG that went up
const sizeOf = buf => {
  if (buf.includes(Buffer.from('VP8X'))) { const i = buf.indexOf('VP8X'); return { w: 1 + buf.readUIntLE(i + 12, 3), h: 1 + buf.readUIntLE(i + 15, 3) }; }
  if (buf.includes(Buffer.from('VP8L'))) { const i = buf.indexOf('VP8L') + 9; const b = buf.readUInt32LE(i); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  if (buf.includes(Buffer.from('VP8 '))) { const i = buf.indexOf('VP8 ') + 14; return { w: buf.readUInt16LE(i) & 0x3fff, h: buf.readUInt16LE(i + 2) & 0x3fff }; }
  const i = buf.indexOf('IHDR'); return { w: buf.readUInt32BE(i + 4), h: buf.readUInt32BE(i + 8) };
};
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  await page.goto(base + '/');
  await page.waitForSelector('text=Server profile');
  const nav = await page.evaluate(() => [...document.querySelectorAll('nav button, [role=tab]')].map(b => b.textContent.trim()).filter(Boolean));
  assert.ok(!nav.some(t => /^Dashboard/.test(t)), 'no Dashboard tab: ' + nav.join(', '));
  assert.ok(nav.findIndex(t => /^Overview/.test(t)) < nav.findIndex(t => /^Roles/.test(t)), 'Overview comes first');
  pass('Overview is the first tab and opens by default; no Dashboard tab');

  // a big picture to crop (1600 x 900)
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 1600, 900); g.fillStyle = '#e44'; g.fillRect(700, 350, 200, 200); return c.toDataURL('image/png').split(',')[1]; });
  const file = { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  const inputs = await page.$$('input[type=file]');
  await inputs[0].setInputFiles(file);
  await page.waitForSelector('.crop-frame');
  assert.match(await page.textContent('.crop-back'), /Crop the server icon/);
  const ratio = await page.$eval('.crop-mask', e => { const r = e.getBoundingClientRect(); return r.width / r.height; });
  assert.ok(Math.abs(ratio - 1) < 0.02, `square crop box (${ratio})`);
  await page.screenshot({ path: join(root, 'test-results/server-icon-crop.png') });
  await page.click('.crop-actions .btn-primary');
  for (let i = 0; i < 50 && !uploads.length; i++) await page.waitForTimeout(50);
  assert.equal(uploads[0]?.kind, 'icon');
  assert.deepEqual(sizeOf(uploads[0].body), { w: 512, h: 512 }, 'icon cropped square at the recommended size (Nookara: 512)');
  pass('icon: the crop tool opens square and the cropped square goes up');

  await (await page.$$('input[type=file]'))[1].setInputFiles(file);
  await page.waitForSelector('.crop-frame');
  assert.match(await page.textContent('.crop-back'), /Crop the server banner/);
  const bratio = await page.$eval('.crop-mask', e => { const r = e.getBoundingClientRect(); return r.width / r.height; });
  assert.ok(Math.abs(bratio - 3) < 0.05, `3:1 banner crop box on Nookara (${bratio})`);
  await page.click('.crop-actions .btn-primary');
  for (let i = 0; i < 50 && uploads.length < 2; i++) await page.waitForTimeout(50);
  assert.equal(uploads[1]?.kind, 'banner');
  const b = sizeOf(uploads[1].body);
  assert.ok(Math.abs(b.w / b.h - 3) < 0.02 && b.w <= 960, `banner 3:1, at most 960 wide (${b.w}x${b.h})`);
  pass('banner: the crop tool opens at 3:1 and the cropped banner goes up');

  // Cancel uploads nothing
  await (await page.$$('input[type=file]'))[0].setInputFiles(file);
  await page.waitForSelector('.crop-frame');
  await page.click('.crop-actions .btn-surface');
  await page.waitForSelector('.crop-frame', { state: 'detached' });
  await page.waitForTimeout(200);
  assert.equal(uploads.length, 2);
  pass('Cancel uploads nothing');
  assert.deepEqual(errors, []);
  console.log('all ok');
} finally { await browser.close(); server.close(); }
