// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium node tests/bot-dms.browser.mjs
// (PLAYWRIGHT_MODULE / ESBUILD_MODULE point at other installs when this checkout has none.)
// DMs with bots are never encrypted (Ikelene, 2026-11-12): a message to a bot goes as plain text even when this device never set up
// encrypted DMs, nobody's keys are looked up for it, the lock says why, and a bot is found out from the DM list, a message or a profile check.
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
import { E2eeHeadLock } from '${chat}/E2eeMessage.jsx';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
window.store = store;
window.renderLock = username => { const el = document.createElement('div'); document.body.appendChild(el); createRoot(el).render(createElement(E2eeHeadLock, { view: { kind: 'dm', username } })); return el; };`;
const built = await build({ stdin: { contents: entry, loader: 'js', resolveDir: root }, jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', __EMBER_COMMIT__: '"test"', __EMBER_REPO__: '"test/ember-client"' }, logLevel: 'error' });
const asked = [];
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  if (url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>'); }
  asked.push(url);
  res.setHeader('content-type', 'application/json');
  if (url === '/chat/settings') return res.end(JSON.stringify({ settings: { sounds: false }, defaults: {} }));
  if (url === '/chat/users/Jarvis') return res.end(JSON.stringify({ bot: { bot: { id: '221', username: 'Jarvis' }, can_add_to: [] } }));
  if (url.startsWith('/im/keys/user/')) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'no_keys' })); }
  if (url === '/im/conversations') return res.end(JSON.stringify({ conversations: [{ username: 'Mahi', bot: true, unread: 0, last_message: { id: 1, body: 'hi' } }, { username: 'Ada', unread: 0, last_message: { id: 2, body: 'x' } }] }));
  return res.end('{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  // a socket that is always open and keeps what Ember sends
  await page.addInitScript(() => {
    window.__sent = [];
    try { localStorage.setItem('velora_token', 'test'); localStorage.setItem('bonfire_token', 'test'); } catch { /* fine */ }
    window.WebSocket = class { constructor() { this.readyState = 1; window.__ws = this; } send(d) { window.__sent.push(JSON.parse(d)); } close() {} };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.store);
  await page.evaluate(() => { const { getState, init } = window.store; init({ username: 'Tester' }); Object.assign(getState(), { e2eeStatus: 'none' }); });

  // the DM list says who is a bot
  await page.evaluate(() => window.store.loadDMs());
  assert.equal(await page.evaluate(() => window.store.isBotPeer('mahi')), true);
  assert.equal(await page.evaluate(() => window.store.isBotPeer('Ada')), false);

  // to a bot: plain text over the socket, though this device never set up encrypted DMs
  await page.evaluate(() => window.store.sendMessage({ kind: 'dm', username: 'Mahi' }, 'm!help'));
  await page.waitForFunction(() => window.__sent.some(f => f.type === 'im_send'));
  const f = await page.evaluate(() => window.__sent.find(x => x.type === 'im_send'));
  assert.equal(f.to, 'Mahi');
  assert.equal(f.message, 'm!help');
  assert.equal(f.enc, undefined);
  // to a person, with no keys on this device: nothing goes out in plain text
  await page.evaluate(() => window.store.sendMessage({ kind: 'dm', username: 'Ada' }, 'secret'));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await page.evaluate(() => window.__sent.filter(x => x.type === 'im_send' && x.to === 'Ada').length), 0);

  // a DM opened by name finds out on its own (one profile check)
  await page.evaluate(() => window.store.checkBotPeer('Jarvis'));
  await page.waitForFunction(() => window.store.isBotPeer('Jarvis'));

  // messages: a bot's has the bot mark, and a DM with a bot never says "sent before you'd both set up"
  const m = await page.evaluate(() => ({ from: window.store.imToMsg({ id: 5, from: 'Mahi', to: 'Tester', from_bot: true, body: 'hello', sent_at: 0 }), to: window.store.imToMsg({ id: 6, from: 'Tester', to: 'Mahi', to_bot: true, body: 'yo', sent_at: 0 }) }));
  assert.equal(m.from.author.bot, true);
  assert.equal(m.from.notEncrypted, false);
  assert.equal(m.to.notEncrypted, false);

  // the lock: yellow open lock that says bots can't use encryption, and no key lookup for the bot
  const before = asked.filter(u => u.startsWith('/im/keys/user/Mahi')).length;
  await page.evaluate(() => window.renderLock('Mahi'));
  await page.waitForSelector('.e2-head-lock.off');
  const tip = await page.getAttribute('.e2-head-lock.off', 'data-tip');
  assert.match(tip, /Bots can't use end-to-end encryption/);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(asked.filter(u => u.startsWith('/im/keys/user/Mahi')).length, before, 'no key lookup for a bot');
  assert.equal(before, 0, 'sending to the bot looked nobody up either');
  console.log('bot-dms.browser: ok');
} finally {
  await browser.close();
  server.close();
}
