// Run from the repo root: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... node tests/bio-editor.browser.mjs
// Settings > Profile: the bio's emoji button opens the picker (personal emojis + standard ones), a pick goes in at the cursor
// as the message token, the count treats it as one character, and the preview card draws it.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import ProfileEditor from'${chat}/ProfileEditor.jsx';import{patchState}from'${chat}/store.js';
patchState({ personalEmojis: { list: [{ eid: 'e0000000001', name: 'kiyori_wave', url: '/uploads/emojis/e0000000001.png' }] } });
createRoot(document.getElementById('root')).render(<div className="vc"><ProfileEditor onDirty={()=>{}}/></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
const css = ['src/chat/chat.css', 'src/styles.css', 'src/chat/SettingsDialog.css'].map(p => readFileSync(join(root, p), 'utf8')).join('\n');
const EMOJI = readFileSync(process.env.EMOJI_JSON || join(root, '../VELORA-modernui/public/assets/emoji/emoji.json'), 'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const me = { account: { username: 'kiyori', rank: 'user' }, profile: { bio: 'hello ', color: '' }, bio_limit: 10 };
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url.startsWith('/uploads/emojis/')) { res.setHeader('content-type', 'image/png'); return res.end(png); }
  if (url === '/assets/emoji/emoji.json') { res.setHeader('content-type', 'application/json'); return res.end(EMOJI); }
  if (url === '/account/me') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(me)); }
  if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end(`<!doctype html><style>${css}body{margin:0;background:#111;color:#eee}</style><div id="root"></div><script src="/app.js"></script>`); }
  res.setHeader('content-type', 'application/json'); res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('.bf-pe-bio textarea');
  // cursor after "hello " then the emoji button
  await page.$eval('.bf-pe-bio textarea', t => { t.focus(); t.setSelectionRange(6, 6); });
  await page.click('.bf-pe-bio-emoji');
  await page.waitForSelector('.vc-em-sec[data-sec=personal] + * .vc-em', { state: 'attached' }); // (the grid fills in lazily)
  await page.$eval('.vc-em-sec[data-sec=personal] + * .vc-em', b => b.click());
  assert.equal(await page.$eval('.bf-pe-bio textarea', t => t.value), 'hello <:kiyori_wave:e0000000001>');
  console.log('PASS the emoji button puts the token in at the cursor');
  const hint = await page.$eval('.bf-pe-bio ~ .bf-pe-hint', h => h.textContent);
  assert.ok(hint.startsWith('7 / 10 characters, 1 / 10 custom emojis'), hint);
  console.log('PASS the count treats the emoji as one character');
  await page.waitForSelector('.bf-pp-bio .vc-cemoji[data-name=kiyori_wave]');
  console.log('PASS the preview card draws it');
  // past the limit: picking more is refused (10 characters: "hello " + 4 emojis fits, a 5th doesn't)
  for (let i = 0; i < 5; i++) {
    if (!(await page.$('.vc-em-sec[data-sec=personal]'))) await page.click('.bf-pe-bio-emoji');
    await page.waitForSelector('.vc-em-sec[data-sec=personal] + * .vc-em', { state: 'attached' });
    await page.$eval('.vc-em-sec[data-sec=personal] + * .vc-em', b => b.click());
  }
  assert.equal(await page.$eval('.bf-pe-bio textarea', t => (t.value.match(/<:kiyori_wave:/g) || []).length), 4);
  console.log('PASS the picker stops at the limit');
  mkdirSync(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results/bio-editor.png') });
  assert.deepEqual(errors, []);
  console.log('all ok');
} finally { await browser.close(); server.close(); }
