import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// e2ee/session.js bundleFor: one request per person however many messages ask at once, kept an hour, refusals remembered,
// forgetBundle (e2ee_keys_changed) always wins over a request already on its way. Opening a DM used to send one
// GET /im/keys/user/<name> per message (up to 100 a second), which got whole home IPs paused by Nookara's rate limit.
// session.js imports the browser api/keystore/crypto modules: esbuild bundles it with those stubbed.
const here = path.dirname(fileURLToPath(import.meta.url));
const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /(api|keystore|nke1)\.js$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => {
      if (a.path.endsWith('api.js')) return { contents: 'export const apiFetch = (...x) => globalThis.__api(...x);', loader: 'js' };
      if (a.path.endsWith('keystore.js')) return { contents: 'export const getKeys=async()=>null,getPin=async()=>null,putPin=async()=>{},outboxAll=async()=>[],outboxPut=async()=>{},outboxDrop=async()=>{},putKeys=async()=>{},dropKeys=async()=>{};', loader: 'js' };
      return { contents: 'export const fingerprint=async()=>"fp",verifyClients=async()=>true,verifyMessage=async()=>true,fileLink=()=>"",parseFileLink=()=>null;', loader: 'js' };
    });
  },
};

let calls = [];
const PEER = { user_id: 2, username: 'peer', kid: 'k', enc_pub: 'e', sig_pub: 's', clients: { seq: 0, list: [] } };
globalThis.window = {};
globalThis.__api = async p => {
  calls.push(p);
  await new Promise(r => setTimeout(r, 20));
  if (p === '/im/keys/me') return { user_id: 1, username: 'me', has: false };
  if (p.includes('blocked')) throw Object.assign(new Error('user_blocked'), { status: 403 });
  if (p.includes('nokeys')) throw Object.assign(new Error('no_keys'), { status: 404 });
  return { ...PEER };
};

let S, dir;
test.before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'e2ee-bundles-'));
  const out = path.join(dir, 'session.mjs');
  await build({ entryPoints: [path.join(here, '../src/chat/e2ee/session.js')], bundle: true, format: 'esm', outfile: out, plugins: [stub], external: ['hash-wasm'], logLevel: 'error' });
  // (session.js keeps an outbox timer going: unref'd here so the test can end)
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (f, ms) => { const t = realSetInterval(f, ms); t.unref?.(); return t; };
  try { S = await import(pathToFileURL(out).href); } finally { globalThis.setInterval = realSetInterval; }
  await S.init();
});
test.after(async () => { rmSync(dir, { recursive: true, force: true }); (await import('esbuild')).stop?.(); });
test.beforeEach(() => { calls = []; });

test('everyone asking at once shares one request, and it is kept', async () => {
  await Promise.all(Array.from({ length: 80 }, () => S.bundleFor('Peer')));
  assert.equal(calls.length, 1);
  await S.bundleFor('peer');
  await Promise.all([S.bundleFor('peer', { fresh: true }), S.bundleFor('peer', { fresh: true })]); // (right after a fetch: that one)
  assert.equal(calls.length, 1);
});

test('forgetBundle fetches again, once', async () => {
  await S.bundleFor('peer');
  S.forgetBundle('peer');
  await Promise.all([S.bundleFor('peer'), S.bundleFor('peer')]);
  assert.equal(calls.length, 1);
});

test('a refusal and "not set up yet" are remembered too', async () => {
  const errs = await Promise.all(Array.from({ length: 30 }, () => S.bundleFor('blocked').catch(e => e.message)));
  assert.ok(errs.every(e => e === 'user_blocked'));
  await assert.rejects(S.bundleFor('blocked'), /user_blocked/);
  const none = await Promise.all(Array.from({ length: 10 }, () => S.bundleFor('nokeys')));
  assert.ok(none.every(v => v.none));
  assert.equal(calls.length, 2);
});

test('an answer that started before forgetBundle is not kept', async () => {
  const p = S.bundleFor('race');
  S.forgetBundle('race');
  await p;
  await S.bundleFor('race');
  assert.equal(calls.length, 2);
});
