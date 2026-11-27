import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import * as N from '../src/chat/e2ee/nke1.js';

// test/vectors/nke1.json: fixed keys and a fixed message, shared with ember-server's and Nookara's tests. The client has to
// agree with the file (strings it builds, envelopes it opens), and so does plain node:crypto, which is what the servers use.
const V = JSON.parse(readFileSync(new URL('./vectors/nke1.json', import.meta.url), 'utf8'));
const un = s => Buffer.from(s, 'base64url');
const priv = async p => ({ ...p, encPriv: await N.importEncPriv(p.enc_priv), sigPriv: await N.importSigPriv(p.sig_priv) });
const K = un(V.message.k);
const ctx1 = { v: 1, from: V.v1.from, to: V.v1.to }, ctx2 = { v: 2, dm: V.v2.dm, from: V.v2.from };
const SPKI = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
const nodeVerify = (text, sigPub, sig) => crypto.verify('sha256', Buffer.from(text), { key: crypto.createPublicKey({ key: Buffer.concat([SPKI, un(sigPub)]), format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, un(sig));
function nodeOpen(enc, aad) {
  const data = un(enc.ct), d = crypto.createDecipheriv('aes-256-gcm', K, un(enc.iv));
  d.setAAD(Buffer.from(aad)); d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8');
}

test('vectors: kids, fingerprints and the commit', async () => {
  for (const p of Object.values(V.people)) {
    assert.equal(await N.kidOf(p.enc_pub), p.kid);
    assert.equal(p.kid, crypto.createHash('sha256').update(un(p.enc_pub)).digest('base64url').slice(0, 22));
    assert.equal(await N.fingerprint(p.enc_pub, p.sig_pub), p.fingerprint);
  }
  assert.equal(await N.commitOf(K), V.message.commit);
  assert.equal(crypto.createHmac('sha256', K).update(V.message.commit_text).digest('base64url'), V.message.commit);
});

test('vectors: the bound strings of v1 and v2', () => {
  assert.equal(N.aadText(ctx1), V.v1.aad);
  assert.equal(N.aadText({ from: V.v1.from, to: V.v1.to }), V.v1.aad, 'no v = a Nookara DM, as before');
  assert.equal(V.v1.aad, 'nke1|5|9');
  assert.equal(N.sigText(ctx1, 0, V.message.iv, V.v1.envelope.ct, V.message.commit), V.v1.sig_text);
  assert.equal(N.aadText(ctx2), V.v2.aad);
  assert.equal(V.v2.aad, 'nke1|2|d1a2b3@a.example|v:5@nookara.cc');
  assert.equal(N.sigText(ctx2, 0, V.message.iv, V.v2.envelope.ct, V.message.commit), V.v2.sig_text);
  assert.ok(V.v2.sig_text.startsWith('nke1 sig|2|d1a2b3@a.example|v:5@nookara.cc|0|'));
  assert.equal(N.sigText(ctx2, V.v2.edit.edit_of, V.message.iv, V.v2.edit.envelope.ct, V.message.commit), V.v2.edit.sig_text);
});

test('vectors: the v1 envelope still opens, for the two people only', async () => {
  const enc = V.v1.envelope;
  assert.equal(enc.v, 1);
  for (const name of V.v1.opens_for) {
    const p = await priv(V.people[name]);
    const k = await N.messageKey(enc, p.kid, p.encPriv);
    assert.deepEqual(Buffer.from(k), K);
    assert.deepEqual(await N.openWithKey(enc, k, { from: V.v1.from, to: V.v1.to }), JSON.parse(V.v1.payload));
  }
  const bob = await priv(V.people.bob);
  assert.equal(await N.messageKey(enc, bob.kid, bob.encPriv), null);
  assert.equal(await N.verifyMessage(enc, V.people.alice.sig_pub, { from: V.v1.from, to: V.v1.to }), true);
  assert.equal(await N.verifyMessage(enc, V.people.alice.sig_pub, { from: V.v1.to, to: V.v1.from }), false);
  assert.equal(nodeOpen(enc, V.v1.aad), V.v1.payload);
  assert.equal(nodeVerify(V.v1.sig_text, V.people.alice.sig_pub, enc.sig), true);
  await assert.rejects(N.openWithKey(enc, K, { v: 2, dm: V.v2.dm, from: V.v2.from }), 'a v1 message is not a v2 one');
});

test('vectors: the v2 envelope opens for every member key, bound to its DM and its sender', async () => {
  const enc = V.v2.envelope;
  assert.equal(enc.v, 2);
  assert.deepEqual(Object.keys(enc.wraps).sort(), V.v2.opens_for.map(n => V.people[n].kid).sort());
  for (const name of V.v2.opens_for) {
    const p = await priv(V.people[name]);
    const k = await N.messageKey(enc, p.kid, p.encPriv);
    assert.deepEqual(Buffer.from(k), K, name);
    assert.deepEqual(await N.openWithKey(enc, k, ctx2), JSON.parse(V.v2.payload));
  }
  const dave = await priv(V.people.dave);
  assert.equal(await N.messageKey(enc, dave.kid, dave.encPriv), null);
  await assert.rejects(N.openWithKey(enc, K, { ...ctx2, dm: V.v2.wrong.dm }), 'moved to another DM');
  await assert.rejects(N.openWithKey(enc, K, { ...ctx2, from: V.v2.wrong.from }), 'said to be from someone else');
  await assert.rejects(N.openWithKey(enc, K, { from: 5, to: 9 }), 'a v2 message is not a v1 one');
  const sig = V.people.alice.sig_pub;
  assert.equal(await N.verifyMessage(enc, sig, ctx2), true);
  assert.equal(await N.verifyMessage(enc, sig, { ...ctx2, dm: V.v2.wrong.dm }), false);
  assert.equal(await N.verifyMessage(enc, sig, { ...ctx2, from: V.v2.wrong.from }), false);
  assert.equal(await N.verifyMessage(enc, V.people.bob.sig_pub, { ...ctx2, from: V.v2.wrong.from }), false);
  assert.equal(await N.verifyMessage(enc, sig, { ...ctx2, editOf: 42 }), false);
  assert.equal(await N.verifyMessage(V.v2.edit.envelope, sig, { ...ctx2, editOf: '42' }), true);
  assert.equal(await N.verifyMessage(V.v2.edit.envelope, sig, ctx2), false);
  assert.equal(nodeOpen(enc, V.v2.aad), V.v2.payload);
  assert.throws(() => nodeOpen(enc, 'nke1|2|zzzzzz@a.example|v:5@nookara.cc'));
  assert.equal(nodeVerify(V.v2.sig_text, sig, enc.sig), true);
  assert.equal(nodeVerify(V.v2.edit.sig_text, sig, V.v2.edit.envelope.sig), true);
});

test('vectors: signed client lists, with a numeric owner and a stable id', async () => {
  for (const c of Object.values(V.clients)) {
    assert.equal(N.clientsText(c.owner, c.kid, c.doc), c.text);
    const signer = Object.values(V.people).find(p => p.kid === c.kid);
    assert.equal(await N.verifyClients(c.owner, c.kid, c.doc, c.sig, signer.sig_pub), true);
    assert.equal(nodeVerify(c.text, signer.sig_pub, c.sig), true);
    assert.equal(await N.verifyClients('l:8@a.example', c.kid, c.doc, c.sig, signer.sig_pub), false, 'the owner is part of it');
  }
  assert.ok(V.clients.numeric_owner.text.startsWith('nke1 clients|5|'));
  assert.ok(V.clients.stable_owner.text.startsWith('nke1 clients|l:7@a.example|'));
  assert.ok(V.clients.stable_owner.doc.list.some(c => c.revoked_at), 'a revoked entry is signed too');
});

test('vectors: safety numbers, by user id and by stable id', async () => {
  for (const s of Object.values(V.safety)) {
    assert.deepEqual(await N.safetyCode(s.a, s.b), s.code);
    assert.deepEqual(await N.safetyCode(s.b, s.a), s.code);
  }
  // two Nookara ids go in number order, not string order (9 before 10), as they always have
  const a = { uid: 9, fp: 'x' }, b = { uid: 10, fp: 'y' };
  assert.deepEqual(await N.safetyCode(a, b), await N.safetyCode({ uid: '10', fp: 'y' }, { uid: '9', fp: 'x' }));
});

test('v2: a fresh message round trips, wraps once per key, and stops at MAX_WRAPS', async () => {
  const alice = await priv(V.people.alice), bob = await priv(V.people.bob), client = await priv(V.people.bob_client);
  const recipients = [alice, bob, client, bob].map(p => ({ kid: p.kid, enc_pub: p.enc_pub }));
  const signer = { kid: alice.kid, sigPriv: alice.sigPriv };
  const enc = await N.encryptMessage({ t: 'hi' }, { dm: V.v2.dm, from: alice.id, recipients, signer });
  assert.equal(enc.v, 2);
  assert.equal(Object.keys(enc.wraps).length, 3);
  for (const p of [alice, bob, client]) {
    const got = await N.openWithKey(enc, await N.messageKey(enc, p.kid, p.encPriv), ctx2);
    assert.equal(got.t, 'hi');
    assert.ok(Math.abs(got.ts - Date.now()) < 60000, 'the sender clock is inside');
  }
  assert.equal(await N.verifyMessage(enc, alice.sig_pub, ctx2), true);
  const v1 = await N.encryptMessage({ t: 'hi' }, { from: 5, to: 9, recipients, signer });
  assert.equal(v1.v, 1);
  assert.equal((await N.openWithKey(v1, await N.messageKey(v1, bob.kid, bob.encPriv), { from: 5, to: 9 })).ts, undefined, 'v1 payloads are as they were');
  const many = Array.from({ length: N.MAX_WRAPS + 1 }, (_, i) => ({ kid: 'k' + String(i).padStart(21, '0'), enc_pub: bob.enc_pub }));
  await assert.rejects(N.encryptMessage({ t: 'x' }, { dm: V.v2.dm, from: alice.id, recipients: many, signer }), /too_many_wraps/);
});
