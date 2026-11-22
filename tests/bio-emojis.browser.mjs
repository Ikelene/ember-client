// Run from the repo root: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... node tests/bio-emojis.browser.mjs
// Personal emojis in bios: the token shows as its picture, a deleted one falls back to :name:, and the bio editor's picker
// (personalOnly) offers your personal emojis + standard ones, never a server's.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{BioText}from'${chat}/text.jsx';import EmojiPicker from'${chat}/EmojiPicker.jsx';import{patchState}from'${chat}/store.js';
patchState({ personalEmojis: { list: [{ eid: 'e0000000001', name: 'kiyori_wave', url: '/uploads/emojis/e0000000001.png' }] }, emojis: [{ sid: 's1', name: 'Some Server', emojis: [{ eid: 'e0000000002', name: 'server_one', url: '/uploads/emojis/e0000000002.png' }] }] });
function App(){const[picked,setPicked]=React.useState('');return <div className="vc"><BioText text={'hi <:kiyori_wave:e0000000001> bye <:gone_one:e0000000009>'}/><div id="picked">{picked}</div><EmojiPicker personalOnly onPick={setPicked} onClose={()=>{}}/></div>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(root, 'src/styles.css'), 'utf8');
const EMOJI = readFileSync(process.env.EMOJI_JSON || join(root, '../VELORA-modernui/public/assets/emoji/emoji.json'), 'utf8'); // (the real list Nookara serves)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url === '/uploads/emojis/e0000000001.png' || url === '/uploads/emojis/e0000000002.png') { res.setHeader('content-type', 'image/png'); return res.end(png); }
  if (url.startsWith('/uploads/')) { res.statusCode = 404; return res.end(''); }
  if (url === '/assets/emoji/emoji.json') { res.setHeader('content-type', 'application/json'); return res.end(EMOJI); }
  if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end(`<!doctype html><style>${css}body{margin:0;background:#111;color:#eee}</style><div id="root"></div><script src="/app.js"></script>`); }
  res.setHeader('content-type', 'application/json'); res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('.vc-bio .vc-cemoji[data-name=kiyori_wave]');
  assert.equal(await page.$eval('.vc-bio .vc-cemoji[data-name=kiyori_wave]', i => i.naturalWidth > 0), true);
  console.log('PASS a personal emoji in a bio shows as its picture');
  // the deleted one gives up after its retries (1.5 + 3 + 4.5 s) and becomes text
  await page.waitForSelector('.vc-bio .vc-cemoji-gone', { timeout: 15000 });
  assert.equal(await page.$eval('.vc-bio .vc-cemoji-gone', s => s.textContent), ':gone_one:');
  assert.equal(await page.$('.vc-bio img[data-name=gone_one]'), null);
  console.log('PASS a deleted emoji falls back to :name:');
  await page.waitForSelector('.vc-em-sec[data-sec=personal]');
  const secs = await page.$$eval('.vc-em-sec', s => s.map(x => x.textContent));
  assert.ok(secs.includes('Personal'));
  assert.ok(!secs.includes('Some Server'));
  console.log('PASS the bio picker offers personal emojis and not a server\'s');
  await page.$eval('.vc-em-sec[data-sec=personal] + * .vc-em', b => b.click()); // (the picker sits wherever its CSS puts it; outside this bare page's view)
  assert.equal(await page.$eval('#picked', d => d.textContent), '<:kiyori_wave:e0000000001>');
  console.log('PASS picking one gives the message token');
  mkdirSync(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results/bio-emojis.png') });
  assert.deepEqual(errors, []);
  console.log('all ok');
} finally { await browser.close(); server.close(); }
