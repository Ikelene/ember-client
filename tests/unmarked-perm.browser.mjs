// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium node tests/unmarked-perm.browser.mjs
// (PLAYWRIGHT_MODULE / ESBUILD_MODULE point at other installs when this checkout has none.)
// Roles editor: "Use unmarked aliases" only shows while the server's Danger zone switch is on (server.unmarked_aliases), and an
// older server that doesn't send the flag keeps showing it (Ikelene, 2026-11-13).
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
import { RolesEditor } from '${chat}/roles.jsx';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
window.store = store;
let root = null;
window.show = sid => { if (!root) { const el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); } root.render(createElement(RolesEditor, { sid, key: Math.random() })); };`;
const built = await build({ stdin: { contents: entry, loader: 'js', resolveDir: root }, jsx: 'automatic', bundle: true, write: false, logLevel: 'error',
  loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test/ember-client"' } });
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>'); }
  res.setHeader('content-type', 'application/json'); return res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.store && window.show);
  const sid = 'https://chat.example|s1';
  const showWith = async flag => {
    await page.evaluate(({ sid, flag }) => {
      const server = { sid, name: 'Camp', role: 'owner', perms: 512 | 8 };
      if (flag !== undefined) server.unmarked_aliases = flag;
      window.store.getState().detail = { [sid]: { server, roles: [{ rid: 'r1', name: '@everyone', is_default: 1, permissions: 1, position: 0, color: null }, { rid: 'r2', name: 'bots', is_default: 0, permissions: 1, position: 1, color: null }] } };
      window.show(sid);
    }, { sid, flag });
    await page.getByText('Send messages', { exact: false }).first().waitFor();
    return page.getByText('Use unmarked aliases').count();
  };
  assert.equal(await showWith(false), 0, 'switch off: the permission is hidden');
  assert.equal(await showWith(true), 1, 'switch on: it is there');
  assert.equal(await showWith(undefined), 1, 'an older server without the flag: shown like before');
  console.log('unmarked-perm.browser: ok');
} finally {
  await browser.close();
  server.close();
}
