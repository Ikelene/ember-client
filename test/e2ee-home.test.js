import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import crypto from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// e2ee/session.js against a fake key home, both kinds: a homeserver's /social/e2ee (stable ids, passphrase only) and a
// Nookara-shaped one (user ids, PIN allowed). Each "device" is its own copy of the module with its own (in-memory) keystore.
// Real crypto, real Argon2id; only the network and IndexedDB are stood in for.
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '../node_modules/.cache/e2ee-home-test'); // (inside the project, so hash-wasm resolves)
const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /(\/api|keystore)\.js$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => {
      if (a.path.endsWith('api.js')) return { contents: 'export const apiFetch = async () => { throw new Error("no_network"); };', loader: 'js' };
      return { contents: `const keys = new Map(), pins = new Map(), box = new Map();
        export const getKeys = async uid => keys.get(String(uid)) || null, putKeys = async v => { keys.set(String(v.uid), v); }, dropKeys = async uid => { keys.delete(String(uid)); };
        export const getPin = async (me, o) => pins.get(me + ':' + o) || null, putPin = async (me, o, v) => { pins.set(me + ':' + o, v); };
        export const outboxAll = async () => [...box.values()], outboxPut = async v => { box.set(v.nonce, v); }, outboxDrop = async n => { box.delete(n); };`, loader: 'js' };
    });
  },
};
globalThis.window = {};
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const err = (code, status, extra = {}) => Object.assign(new Error(code), { status, error: code, ...extra });

// every account's home, by stable id: what GET /social/keys/<id> is answered from
const accounts = new Map();
function keyDoc(id) {
  const a = accounts.get(id);
  if (!a) throw err('user_not_found', 404);
  if (!a.keys) return { id, keys: [] };
  return { id, format: 'nke1', owner: a.owner, keys: [{ kid: a.keys.kid, kind: 'account', alg: 'p256', public_key: a.keys.sig_pub, enc_public_key: a.keys.enc_pub, created_at: 1 }], clients: a.clients, clients_sig: a.clients_sig, clients_seq: a.clients.seq, past: a.past };
}
// one account's key home. nookara: Nookara's shapes (user_id, username, PIN allowed); otherwise ember-server's (passcode_rules, passphrase only)
function fakeHome({ id, owner, nookara = false, username = '' }) {
  const a = { owner, keys: null, backups: {}, clients: { seq: 0, list: [] }, clients_sig: null, past: [], links: new Map(), calls: [] };
  accounts.set(id, a);
  const kid = encPub => crypto.createHash('sha256').update(Buffer.from(encPub, 'base64url')).digest('base64url').slice(0, 22);
  async function req(p, { method = 'GET', body } = {}) {
    const b = body ? JSON.parse(body) : undefined;
    a.calls.push({ method, path: p, body: b });
    if (p === '/me') {
      const who = nookara ? { user_id: Number(owner), username, id, owner } : { id, owner, passcode_rules: { kinds: ['passphrase'], min_length: 12, argon2id: { m: 65536, t: 3, p: 1 } } };
      if (!a.keys) return { ...who, has: false };
      const pc = a.backups.passcode;
      return { ...who, has: true, ...a.keys, clients: a.clients, clients_sig: a.clients_sig, passcode: { type: pc.type, salt: pc.salt, params: pc.params, locked: false, tries_left: 10 }, recovery: { salt: a.backups.recovery.salt } };
    }
    if (p === '' && method === 'POST') {
      if (!nookara && (b.passcode.type === 'pin' || b.passcode.secret_kind !== 'passphrase')) throw err('passphrase_required', 400);
      if (a.keys && !b.replace) throw err('already_has_keys', 409);
      if (a.keys) a.past.push({ kid: a.keys.kid, sig_pub: a.keys.sig_pub });
      a.keys = { kid: kid(b.enc_pub), enc_pub: b.enc_pub, sig_pub: b.sig_pub };
      a.clients = { seq: 0, list: [] }; a.clients_sig = null;
      for (const k of ['passcode', 'recovery']) a.backups[k] = { ...b[k], auth: undefined, auth_hash: sha(b[k].auth) };
      return { success: true };
    }
    if (p === '/unlock') {
      const k = a.backups[b.kind];
      if (sha(b.auth) !== k.auth_hash) throw err(b.kind === 'passcode' ? 'wrong_passcode' : 'wrong_recovery_code', 403, { tries_left: 9 });
      return { iv: k.iv, ct: k.ct };
    }
    if (p === '/link' && method === 'POST') { const code = 'CODE'; a.links.set(code, { kind: 'device', enc_pub: b.enc_pub, label: b.label, state: 'pending' }); return { code: null, kind: 'device' }; }
    throw err('not_found', 404);
  }
  return { a, home: { nookara, name: nookara ? 'Nookara' : 'a.example', req, keys: async (who) => keyDoc(who), sid: () => id, username: () => username } };
}

let n = 0, out;
async function device() { // a fresh copy of session.js = another device
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (f, ms) => { const t = realSetInterval(f, ms); t.unref?.(); return t; };
  try { return await import(`${pathToFileURL(out).href}?device=${n++}`); } finally { globalThis.setInterval = realSetInterval; }
}
test.before(async () => {
  mkdirSync(dir, { recursive: true });
  out = path.join(dir, 'session.mjs');
  await build({ entryPoints: [path.join(here, '../src/chat/e2ee/session.js')], bundle: true, format: 'esm', outfile: out, plugins: [stub], external: ['hash-wasm'], logLevel: 'error' });
});
test.after(async () => { rmSync(dir, { recursive: true, force: true }); (await import('esbuild')).stop?.(); });

const BOB = 'l:7@a.example', ALICE = 'v:5@nookara.cc', CAROL = 'l:2@b.example';
const DM = { id: 'd1@a.example', group: false, members: [{ id: ALICE }, { id: BOB }] };
const bob = fakeHome({ id: BOB, owner: BOB }), alice = fakeHome({ id: ALICE, owner: '5', nookara: true, username: 'alice' });
let B1, A1, recovery;

test('a homeserver home: setup takes a passphrase, never a PIN, and says what it locked with', async () => {
  B1 = await device();
  B1.setHome(bob.home);
  assert.equal(await B1.init(), 'none');
  assert.equal(B1.mySid(), BOB);
  assert.deepEqual(B1.secretHome(), { nookara: false, name: 'a.example', min: 12 });
  await assert.rejects(B1.setup('pin', '123456'), /passphrase_required/);
  await assert.rejects(B1.setup('passphrase', 'too short'), /passphrase_required/);
  assert.equal(bob.a.calls.some(c => c.method === 'POST'), false, 'nothing was sent');
  recovery = await B1.setup('passphrase', 'correct horse battery');
  assert.equal(B1.getStatus(), 'ready');
  const sent = bob.a.calls.find(c => c.method === 'POST' && c.path === '').body;
  assert.equal(sent.passcode.secret_kind, 'passphrase');
  assert.notEqual(sent.passcode.type, 'pin');
  assert.deepEqual(sent.passcode.params, { m: 65536, t: 3, p: 1 });
  assert.equal(sent.recovery.secret_kind, 'recovery');
  assert.equal(JSON.stringify(sent).includes('correct horse'), false);
  assert.match(recovery, /^[0-9A-Z-]{32}$/);
});

test('another device unlocks with the passphrase or the recovery code', async () => {
  const B2 = await device();
  B2.setHome(bob.home);
  assert.equal(await B2.init(), 'locked');
  await assert.rejects(B2.unlockPasscode('wrong horse battery'), /wrong_passcode/);
  await B2.unlockPasscode('correct horse battery');
  assert.equal(B2.getStatus(), 'ready');
  assert.equal(B2.myKid(), B1.myKid());
  const B3 = await device();
  B3.setHome(bob.home);
  await B3.init();
  await B3.unlockRecovery(recovery.toLowerCase());
  assert.equal(B3.myKid(), B1.myKid());
});

test('a Nookara home keeps its PIN, and its setup call is as it was', async () => {
  A1 = await device();
  A1.setHome(alice.home);
  assert.equal(await A1.init(), 'none');
  assert.equal(A1.secretHome().nookara, true);
  await A1.setup('pin', '123456');
  const sent = alice.a.calls.find(c => c.method === 'POST' && c.path === '').body;
  assert.equal(sent.passcode.type, 'pin');
  assert.equal('secret_kind' in sent.passcode, false);
  assert.equal('secret_kind' in sent.recovery, false);
  assert.equal(A1.mySid(), ALICE);
});

test('a home that refuses a PIN is heard (400 passphrase_required)', async () => {
  // a home that forgot to say its rules in /me, so the client would let a password of 10 through as on Nookara
  const strict = fakeHome({ id: 'l:9@c.example', owner: 'l:9@c.example' });
  const D = await device();
  D.setHome({ ...strict.home, nookara: true, req: async (p, o) => { const r = await strict.home.req(p, o); if (p === '/me') delete r.passcode_rules; return r; } });
  await D.init();
  await assert.rejects(D.setup('pin', '123456'), e => e.message === 'passphrase_required' && e.status === 400);
  assert.equal(D.getStatus(), 'none');
});

test('two accounts on different homes seal and open a DM, and nothing is sealed while someone has no keys', async () => {
  const enc = await A1.sealDm(DM, 'hi bob', { replyQuote: { from: 'bob', s: 'hello?' } });
  assert.equal(enc.v, 2);
  assert.deepEqual(Object.keys(enc.wraps).sort(), [A1.myKid(), B1.myKid()].sort());
  const msg = { id: '31', author: { id: ALICE }, body: '', enc, reply: { id: '30', body: '' } };
  const got = await B1.openDmMessage(msg, DM);
  assert.equal(got.body, 'hi bob');
  assert.equal(got.reply.body, 'hello?');
  assert.deepEqual({ v: got.sealed.v, state: got.sealed.state, signature: got.sealed.signature, from: got.sealed.from }, { v: 2, state: 'open', signature: 'valid', from: ALICE });
  assert.equal((await A1.openDmMessage(msg, DM)).body, 'hi bob', 'my own copy opens too');
  // the host handing the same envelope out under another DM, or as someone else's
  assert.equal((await B1.openDmMessage(msg, { ...DM, id: 'zz@a.example' })).sealed.state, 'failed');
  assert.equal((await B1.openDmMessage({ ...msg, author: { id: 'l:7' } }, DM)).sealed.state, 'failed');
  // bob answers from the host's own short id; an edit is signed for the message it replaces
  const back = await B1.sealDm(DM, 'hi alice');
  assert.equal((await A1.openDmMessage({ id: '32', author: { id: 'l:7' }, enc: back }, DM)).sealed.signature, 'valid');
  const edit = await B1.sealDm(DM, 'hi alice!', { editOf: '32' });
  assert.equal((await A1.openDmMessage({ id: '32', author: { id: 'l:7' }, enc: edit, edited_at: 5 }, DM)).sealed.signature, 'valid');
  assert.equal((await A1.openDmMessage({ id: '33', author: { id: 'l:7' }, enc: edit, edited_at: 5 }, DM)).sealed.signature, 'invalid', 'replayed as an edit of another message');
  // a locked device says so, and opens nothing
  const locked = await device();
  locked.setHome(bob.home);
  await locked.init();
  assert.deepEqual((await locked.openDmMessage(msg, DM)).sealed, { v: 2, state: 'locked' });
  await assert.rejects(locked.sealDm(DM, 'x'), /e2ee_locked/);
  // carol has an account and no keys yet
  fakeHome({ id: CAROL, owner: CAROL });
  const group = { id: 'g1@a.example', group: true, members: [...DM.members, { id: CAROL }] };
  const { missing } = await A1.bundlesForDm(group);
  assert.deepEqual(missing, [CAROL]);
  const e = await A1.sealDm(group, 'x').catch(x => x);
  assert.equal(e.message, 'no_keys');
  assert.deepEqual(e.missing, [CAROL]);
});

test('a changed key is noticed by stable id, and safety numbers match on both sides', async () => {
  const a = await A1.safetyWithId(BOB), b = await B1.safetyWithId(ALICE);
  assert.equal(a.length, 12);
  assert.deepEqual(a, b);
  const seen = [];
  A1.onKeyChange(id => seen.push(id));
  const B4 = await device();
  B4.setHome(bob.home);
  await B4.init();
  await B4.setup('passphrase', 'another long passphrase', { replace: true });
  A1.forgetDoc(BOB);
  await A1.docBundle(BOB);
  assert.deepEqual(seen, [BOB]);
  assert.notDeepEqual(await A1.safetyWithId(BOB), a);
  // a home serving someone else's keys under bob's id is refused
  A1.setHome({ ...alice.home, keys: async id => ({ ...keyDoc(ALICE), id }) });
  await A1.init();
  await assert.rejects(A1.docBundle(BOB), /bad_key_list/);
});
