import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as N from '../src/chat/e2ee/nke1.js';
import { dmReportNote, DM_REPORT_E2EE_NOTES } from '../src/chat/dm-report.js';
import { fileKindOfMime, opensByItself } from '../src/chat/e2ee/files.js';

const person = async () => { const k = await N.newKeys(); return { ...k, encPriv: await N.importEncPriv(k.enc_priv), sigPriv: await N.importSigPriv(k.sig_priv) }; };
const box = (a, b) => ({ from: 1, to: 2, recipients: [{ kid: b.kid, enc_pub: b.enc_pub }, { kid: a.kid, enc_pub: a.enc_pub }], signer: { kid: a.kid, sigPriv: a.sigPriv } });

test('both people can open a message, a third person and a tampered copy can not', async () => {
  const [a, b, c] = await Promise.all([person(), person(), person()]);
  const enc = await N.encryptMessage({ t: 'hello >w<' }, box(a, b));
  for (const p of [a, b]) {
    const k = await N.messageKey(enc, p.kid, p.encPriv);
    assert.equal((await N.openWithKey(enc, k, { from: 1, to: 2 })).t, 'hello >w<');
  }
  assert.equal(await N.messageKey(enc, c.kid, c.encPriv), null);
  const k = await N.messageKey(enc, b.kid, b.encPriv);
  await assert.rejects(N.openWithKey(enc, k, { from: 2, to: 1 }), 'the people are part of it');
  const flipped = enc.ct[5] === 'A' ? 'B' : 'A';
  await assert.rejects(N.openWithKey({ ...enc, ct: enc.ct.slice(0, 5) + flipped + enc.ct.slice(6) }, k, { from: 1, to: 2 }));
});

test('a signature is checked against the sender, the people and the message id of an edit', async () => {
  const [a, b] = await Promise.all([person(), person()]);
  const enc = await N.encryptMessage({ t: 'x' }, box(a, b));
  assert.equal(await N.verifyMessage(enc, a.sig_pub, { from: 1, to: 2 }), true);
  assert.equal(await N.verifyMessage(enc, b.sig_pub, { from: 1, to: 2 }), false);
  assert.equal(await N.verifyMessage(enc, a.sig_pub, { from: 1, to: 3 }), false);
  const edit = await N.encryptMessage({ t: 'y' }, { ...box(a, b), editOf: 7 });
  assert.equal(await N.verifyMessage(edit, a.sig_pub, { from: 1, to: 2, editOf: 7 }), true);
  assert.equal(await N.verifyMessage(edit, a.sig_pub, { from: 1, to: 2, editOf: 8 }), false);
});

test('a wrapped key that does not match the commit counts as not opening', async () => {
  const [a, b] = await Promise.all([person(), person()]);
  const enc = await N.encryptMessage({ t: 'x' }, box(a, b));
  const fake = await N.seal(N.random(32), b.enc_pub, b.kid);
  assert.equal(await N.messageKey({ ...enc, wraps: { [b.kid]: fake } }, b.kid, b.encPriv), null);
});

test('files round trip, and a file link keeps odd names and never holds a raw dot', async () => {
  const bytes = new TextEncoder().encode('picture bytes');
  const { data, key, iv } = await N.encryptFile(bytes);
  assert.notDeepEqual(new Uint8Array(data), bytes);
  assert.deepEqual(new Uint8Array(await N.decryptFile(data, key, iv)), bytes);
  const link = N.fileLink('https://nookara.cc/t/abc/file.bin', { key, iv, name: "SPOILER_my pic (1).final.png", mime: 'image/png' });
  assert.ok(!/\s/.test(link));
  const f = N.parseFileLink(link);
  assert.deepEqual(f, { url: 'https://nookara.cc/t/abc/file.bin', key, iv, name: 'SPOILER_my pic (1).final.png', mime: 'image/png' });
  assert.equal(N.parseFileLink('https://nookara.cc/t/abc/file.bin'), null);
});

test('backups open with the right secret only, and recovery codes survive sloppy typing', async () => {
  const salt = N.b64(N.random(16)), code = N.newRecoveryCode();
  assert.equal(N.cleanRecoveryCode(code).length, 26);
  const s = await N.stretchRecovery(code, salt);
  const blob = await N.lockBlob({ a: 1 }, s.wrap);
  const again = await N.stretchRecovery(code.toLowerCase().replace(/-/g, ' '), salt);
  assert.equal(again.auth, s.auth);
  assert.deepEqual(await N.openBlob(blob, again.wrap), { a: 1 });
  const wrong = await N.stretchRecovery(N.newRecoveryCode(), salt);
  assert.notEqual(wrong.auth, s.auth);
  await assert.rejects(N.openBlob(blob, wrong.wrap));
});

test('a signed client list can not be changed, and a link code follows the key', async () => {
  const [a, c] = await Promise.all([person(), person()]);
  const doc = { seq: 1, list: [{ kid: c.kid, enc_pub: c.enc_pub, sig_pub: c.sig_pub, label: 'My client, v1', app: 'app_x', added_at: 5, revoked_at: 0 }] };
  const sig = await N.signClients(1, a.kid, doc, a.sigPriv);
  assert.equal(await N.verifyClients(1, a.kid, doc, sig, a.sig_pub), true);
  assert.equal(await N.verifyClients(1, a.kid, { ...doc, seq: 2 }, sig, a.sig_pub), false);
  assert.equal(await N.verifyClients(1, a.kid, { ...doc, list: [] }, sig, a.sig_pub), false);
  const code = await N.linkCode(a.enc_pub);
  assert.match(code, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  assert.notEqual(code, await N.linkCode(c.enc_pub));
});

test('both sides get the same safety numbers', async () => {
  const x = { uid: 1, fp: 'aaa' }, y = { uid: 2, fp: 'bbb' };
  const c = await N.safetyCode(x, y);
  assert.deepEqual(c, await N.safetyCode(y, x));
  assert.equal(c.length, 12);
  assert.ok(c.every(g => /^\d{5}$/.test(g)));
  assert.notDeepEqual(c, await N.safetyCode(x, { uid: 2, fp: 'ccc' }));
});

test('the report screen says it plainly, in all three languages', () => {
  assert.equal(dmReportNote('de-AT', 'dm'), DM_REPORT_E2EE_NOTES.de);
  assert.equal(dmReportNote('pt-BR', 'dm'), DM_REPORT_E2EE_NOTES.pt);
  assert.equal(dmReportNote('fr', 'dm'), DM_REPORT_E2EE_NOTES.en);
  assert.match(DM_REPORT_E2EE_NOTES.en, /your app unlocks this message/);
  assert.match(DM_REPORT_E2EE_NOTES.en, /not encrypted any more/);
  assert.match(DM_REPORT_E2EE_NOTES.de, /entschlüsselt deine App/);
  assert.match(DM_REPORT_E2EE_NOTES.pt, /seu app desbloqueia/);
  for (const n of Object.values(DM_REPORT_E2EE_NOTES)) assert.match(n, /10\D+5/);
});

test('files show as what they are', () => {
  assert.equal(fileKindOfMime('image/gif'), 'gif');
  assert.equal(fileKindOfMime('video/mp4'), 'video');
  assert.equal(fileKindOfMime('audio/webm'), 'audio');
  assert.equal(fileKindOfMime('application/zip'), 'file');
  assert.equal(opensByItself({ type: 'image' }), true);
  assert.equal(opensByItself({ type: 'video' }), false);
});

// what the server's test checks its side against (VELORA tests/e2ee.test.js). Written when NKE1_VECTORS says where.
test('vectors for the server side', { skip: !process.env.NKE1_VECTORS }, async () => {
  const [a, b] = await Promise.all([person(), person()]);
  const enc = await N.encryptMessage({ t: 'from the browser side' }, { from: 11, to: 22, recipients: [{ kid: a.kid, enc_pub: a.enc_pub }, { kid: b.kid, enc_pub: b.enc_pub }], signer: { kid: a.kid, sigPriv: a.sigPriv } });
  const k = await N.messageKey(enc, b.kid, b.encPriv);
  const file = await N.encryptFile(new TextEncoder().encode('file bytes'));
  writeFileSync(process.env.NKE1_VECTORS, JSON.stringify({ a: { kid: a.kid, enc_pub: a.enc_pub, sig_pub: a.sig_pub }, b: { kid: b.kid, enc_pub: b.enc_pub, enc_priv: b.enc_priv }, enc, reveal: N.b64(k), file: { data: N.b64(file.data), key: file.key, iv: file.iv } }, null, 1));
});
