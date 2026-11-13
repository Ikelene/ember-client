// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium node tests/update-prompt.browser.mjs
// (PLAYWRIGHT_MODULE / ESBUILD_MODULE point at other installs when this checkout has none.)
// An out-of-date Ember server tells its admins and offers to update it (Ikelene, 2026-11-13: "detect its out of date and prompt to auto update"):
//   - Server info > Refresh really re-checks (GET /api/v1/instance/info?refresh=1), not the server's cached answer
//   - the out-of-date note has "Update now" when the server can be updated from Ember (update.one_click), opening Server info with autoUpdate
//   - autoUpdate asks right away (the usual confirm), the update runs through POST /api/v1/instance/update and finishes when the build changes
// This page's own server plays the Ember server.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const imp = m => import(/^[A-Za-z]:[\\/]/.test(m) ? pathToFileURL(m).href : m);
const { build } = await imp(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await imp(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const chat = join(root, 'src/chat').replaceAll('\\', '/');
const entry = `import * as store from '${chat}/store.js';
import * as ids from '${chat}/ids.js';
import { loadServerInfo } from '${chat}/instances.js';
import { OutdatedNote } from '${chat}/Parts.jsx';
import { UpdateServerRow } from '${chat}/UpdateServer.jsx';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
window.store = store; window.ids = ids; window.loadServerInfo = loadServerInfo;
window.mount = (what, props) => { const el = document.createElement('div'); el.id = 'm' + Math.random().toString(36).slice(2); document.body.appendChild(el); createRoot(el).render(createElement(what === 'note' ? OutdatedNote : UpdateServerRow, props)); return el.id; };`;
const built = await build({ stdin: { contents: entry, loader: 'js', resolveDir: root }, jsx: 'automatic', bundle: true, write: false, logLevel: 'error',
  loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test/ember-client"' } });

const OLD = { version: '0.1.0', commit: '0'.repeat(40), commit_short: '06f7837', build_id: 'old' };
const NEW = { version: '0.1.0', commit: '1'.repeat(40), commit_short: '15eb74c', build_id: 'new', message: 'bot dms' };
const seen = [];
let current = OLD, posted = 0;
const server = createServer((req, res) => {
  const url = req.url;
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>'); }
  seen.push(`${req.method} ${url}`);
  res.setHeader('content-type', 'application/json');
  if (url.startsWith('/api/v1/instance/info')) return res.end(JSON.stringify({ admin: true, build: current, update: { outdated: current !== NEW, one_click: true, latest: NEW, checked_at: new Date().toISOString() } }));
  if (url === '/api/v1/instance/update' && req.method === 'POST') { posted++; setTimeout(() => { current = NEW; }, 500); return res.end(JSON.stringify({ ok: true, update: { state: 'running' } })); }
  if (url === '/api/v1/instance/update') return res.end(JSON.stringify({ supported: true, reachable: true, outdated: current !== NEW, current, latest: NEW, update: { state: posted ? (current === NEW ? 'done' : 'running') : 'idle' } }));
  return res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(origin + '/');
  await page.waitForFunction(() => window.store && window.mount);
  await page.evaluate(o => { window.ids.registry.set(o, { origin: o, session: 'test-session' }); }, origin);

  // 1. Refresh really re-checks
  await page.evaluate(o => window.loadServerInfo({ isAdmin: true, origin: o, status: 'open' }, { refresh: true }), origin);
  assert.ok(seen.includes('GET /api/v1/instance/info?refresh=1'), `refresh asked the server to re-check: ${seen.join(', ')}`);
  await page.evaluate(o => window.loadServerInfo({ isAdmin: true, origin: o, status: 'open' }), origin);
  assert.ok(seen.includes('GET /api/v1/instance/info'), 'the background poll does not force a re-check');

  // 2. the out-of-date note offers "Update now", which opens Server info with autoUpdate
  await page.evaluate(({ o, NEW }) => {
    Object.assign(window.store.getState(), {
      view: { kind: 'channel', sid: `${o}|s1`, cid: `${o}|c1` },
      instances: [{ origin: o, isAdmin: true, managed: false, serverInfo: { build: { commit_short: '06f7837' }, update: { outdated: true, one_click: true, latest: NEW } } }],
    });
    window.__dialogs = [];
    addEventListener('vc-dialog', e => window.__dialogs.push(e.detail));
    window.mount('note', {});
  }, { o: origin, NEW });
  await page.getByText('Server update available').waitFor();
  assert.ok(await page.getByText(/Update it now\?/).isVisible());
  await page.getByRole('button', { name: 'Update now' }).click();
  const d = await page.evaluate(() => window.__dialogs.at(-1));
  assert.deepEqual({ kind: d.kind, tab: d.tab, autoUpdate: d.autoUpdate }, { kind: 'settings', tab: 'serverinfo', autoUpdate: true });

  // ...without one_click (or Nookara-hosted) there is no Update now button
  const noBtn = await page.evaluate(o => { const s = window.store.getState(); s.instances[0].serverInfo.update.one_click = false; sessionStorage.clear(); document.body.innerHTML = ''; window.mount('note', {}); return true; }, origin);
  assert.ok(noBtn);
  await page.getByText('Server update available').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Update now' }).count(), 0);

  // 3. autoUpdate asks right away; confirming runs the update and it finishes when the server comes back on the new build
  await page.evaluate(o => { document.body.innerHTML = ''; window.mount('row', { origin: o, name: 'Nookara', autoStart: true }); }, origin);
  await page.waitForFunction(() => !!window.store.getState().ask);
  const askTitle = await page.evaluate(() => window.store.getState().ask.title);
  assert.equal(askTitle, 'Update Nookara?');
  assert.equal(posted, 0, 'nothing runs before the confirm');
  await page.evaluate(() => window.store.answerAsk(true));
  await page.waitForFunction(() => document.body.textContent.includes('Updated to'), null, { timeout: 20000 });
  assert.equal(posted, 1);
  assert.ok(await page.getByText(/15eb74c/).first().isVisible());

  // 4. without autoStart nothing is asked
  current = OLD; posted = 0;
  await page.evaluate(o => { document.body.innerHTML = ''; window.store.getState().ask = null; window.mount('row', { origin: o, name: 'Nookara' }); }, origin);
  await page.getByText(/Available:/).waitFor();
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await page.evaluate(() => window.store.getState().ask), null);
  console.log('update-prompt.browser: ok');
} finally {
  await browser.close();
  server.close();
}
