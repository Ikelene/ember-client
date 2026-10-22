// Run from the repo root after npm ci: BROWSER_PATH=/path/to/chromium node tests/unread-read.browser.mjs
// Messages that came in while Ember was in the background, on the channel you had open: focusing the window marks
// them read everywhere (the channel, its server's rail dot, the pings, the server via chat_read / HTTPS), and the tab
// count (unreadTotals) adds up channels, live messages, DMs and pings with muted servers left out.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dashboard = fileURLToPath(new URL('../', import.meta.url));
const chat = join(dashboard, 'src/chat').replaceAll('\\', '/');
const entry = `import * as store from '${chat}/store.js'; window.store = store;`;
const built = await build({ stdin: { contents: entry, loader: 'js', resolveDir: dashboard }, jsx: 'automatic', bundle: true, write: false, loader: { '.json': 'json', '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
const reads = [];
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(built.outputFiles[0].text); }
  const m = /^\/api\/chat\/channels\/([^/]+)\/read$/.exec(url) || /^\/chat\/channels\/([^/]+)\/read$/.exec(url);
  if (m) { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { reads.push({ cid: m[1], id: JSON.parse(b || '{}').id }); res.setHeader('content-type', 'application/json'); res.end('{}'); }); return; }
  if (url !== '/') { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.store);
  // a server with two channels; #general is open, three messages + a ping came in while the window was in the background
  await page.evaluate(() => {
    const { getState, init } = window.store;
    init(null);
    Object.assign(getState(), {
      me: { username: 'Tester' },
      view: { kind: 'channel', sid: 's1', cid: 'c1' },
      servers: [{ sid: 's1', name: 'One', unread: true, unread_count: 2, mentions: 1 }, { sid: 's2', name: 'Two', unread: true, unread_count: 5, mentions: 2 }, { sid: 's3', name: 'Muted', unread: true, unread_count: 9 }],
      detail: { s1: { server: { name: 'One' }, channels: [{ cid: 'c1', name: 'general', unread: true, unread_count: 0, mentions: 1, last_read_id: '1' }, { cid: 'c2', name: 'other', unread: true, unread_count: 2 }] } },
      unread: { 'c:c1': true },
      unreadN: { c1: { sid: 's1', n: 3 }, c9: { sid: 's2', n: 1 } },
      mentions: { c1: 1 }, srvMentions: { s1: 1 },
      notify: { s3: { muted_until: Date.now() + 60000 } },
      dms: [{ username: 'Friend', unread: 2 }],
      msgs: { 'c:c1': { loaded: true, list: [{ id: '5', body: 'a' }, { id: '6', body: 'b' }, { id: '7', body: 'c' }] } },
    });
  });
  let t = await page.evaluate(() => window.store.unreadTotals());
  // s1: c1 3 live + c2 2; s2 (no channels loaded): 5 + 1 live; DMs 2; s3 muted
  assert.deepEqual(t, { count: 3 + 2 + 6 + 2, pings: 1 + 1 + 2 + 2 });
  // the window comes back into focus on #general
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => !window.store.getState().unreadN.c1);
  const s = await page.evaluate(() => { const g = window.store.getState(); return { srv: g.servers[0], ch: g.detail.s1.channels, unread: g.unread['c:c1'], mentions: g.mentions.c1 || 0, srvMentions: g.srvMentions.s1 || 0 }; });
  assert.equal(s.unread, false);
  assert.equal(s.ch[0].unread, false);
  assert.equal(s.ch[0].mentions, 0);
  assert.equal(s.mentions, 0);
  assert.equal(s.srvMentions, 0);
  assert.equal(s.srv.mentions, 0, 'the ping is gone from the server icon');
  assert.equal(s.srv.unread, true, '#other is still unread, so the server keeps its dot');
  assert.equal(s.srv.unread_count, 2);
  // the server hears about it (no socket here: over HTTPS)
  for (let i = 0; i < 20 && !reads.length; i++) await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(reads.at(-1), { cid: 'c1', id: '7' });
  t = await page.evaluate(() => window.store.unreadTotals());
  assert.deepEqual(t, { count: 2 + 6 + 2, pings: 2 + 2 });
  // reading #other too: the server's dot goes
  await page.evaluate(() => window.store.markChannelRead('c2', 's1'));
  assert.equal(await page.evaluate(() => window.store.getState().servers[0].unread), false);
  console.log('unread-read: ok');
} finally {
  await browser.close();
  server.close();
}
