// Run from the repo root: BROWSER_PATH=/path/to/chromium PLAYWRIGHT_MODULE=... node tests/discover-banners.browser.mjs
// Discover cards show each server's banner (banner_url from /bonfire/directory, https only); no banner or a broken one keeps the tint.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import DiscoverPage from'${chat}/DiscoverPage.jsx';
createRoot(document.getElementById('root')).render(<div className="vc"><DiscoverPage onClose={()=>{}}/></div>);`;
const built = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, nodePaths: [join(root, 'node_modules')], jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.mp3': 'dataurl', '.woff2': 'dataurl' }, define: { __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test"', 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
const css = readFileSync(join(chat, 'chat.css'), 'utf8') + readFileSync(join(root, 'src/styles.css'), 'utf8');
const results = [
  { id: 'a', url: 'https://a.example', name: 'With banner', description: 'has one', icon_url: null, banner_url: 'https://img.example/banner.png', member_count: 5, tags: [] },
  { id: 'b', url: 'https://b.example', name: 'No banner', description: 'none', icon_url: null, banner_url: null, member_count: 3, tags: [] },
  { id: 'c', url: 'https://c.example', name: 'Not https', description: 'http only', icon_url: null, banner_url: 'http://img.example/banner.png', member_count: 2, tags: [] },
  { id: 'd', url: 'https://d.example', name: 'Broken', description: 'fails to load', icon_url: null, banner_url: 'https://img.example/missing.png', member_count: 1, tags: [] },
];
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url === '/bonfire/directory') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ page: 1, page_size: 24, has_more: false, results })); }
  if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end(`<!doctype html><style>${css}body{margin:0;background:#111}</style><div id="root"></div><script src="/app.js"></script>`); }
  res.setHeader('content-type', 'application/json'); res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  // a real picture for the banner, a 404 for the broken one
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://img.example/**', r => (r.request().url().endsWith('/banner.png') ? r.fulfill({ status: 200, contentType: 'image/png', body: png }) : r.fulfill({ status: 404, body: '' })));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('.vc-disc-card:not(.skel)');
  await page.waitForTimeout(500);
  const cards = await page.$$eval('.vc-disc-grid .vc-disc-card', cs => cs.map(c => { const i = c.querySelector('.vc-disc-banner img'); return { name: c.querySelector('b')?.textContent, img: i ? { src: i.getAttribute('src'), shown: !i.hidden && i.naturalWidth > 0 } : null }; }));
  assert.deepEqual(cards.find(c => c.name === 'With banner').img, { src: 'https://img.example/banner.png', shown: true });
  console.log('PASS a server with a banner shows it on its card');
  assert.equal(cards.find(c => c.name === 'No banner').img, null);
  assert.equal(cards.find(c => c.name === 'Not https').img, null);
  console.log('PASS no banner (or a non-https one): the tinted card as before');
  assert.equal(cards.find(c => c.name === 'Broken').img?.shown, false);
  console.log('PASS a banner that fails to load is hidden, leaving the tint');
  assert.deepEqual(errors, []);
  console.log('all ok');
} finally { await browser.close(); server.close(); }
