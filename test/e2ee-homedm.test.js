import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as N from '../src/chat/e2ee/nke1.js';
import * as KD from '../src/chat/e2ee/keydoc.js';
import * as HD from '../src/chat/e2ee/homedm.js';
import * as R from '../src/chat/e2ee/report.js';

// Homeserver DMs end to end, without a server: key documents checked on the device, a message sealed to every member's keys,
// held back while someone has none, reported with its one key, and its link preview carried inside. The fixed keys are the
// shared vectors (test/vectors/nke1.json).
const V = JSON.parse(readFileSync(new URL('./vectors/nke1.json', import.meta.url), 'utf8'));
const priv = async p => ({ ...p, encPriv: await N.importEncPriv(p.enc_priv), sigPriv: await N.importSigPriv(p.sig_priv) });
const P = {};
test.before(async () => { for (const [k, v] of Object.entries(V.people)) P[k] = await priv(v); });
const bundle = p => ({ id: p.id, owner: p.owner, kid: p.kid, enc_pub: p.enc_pub, sig_pub: p.sig_pub, clients: { seq: 0, list: [] }, past: [] });
const DM = { id: 'd1a2b3@a.example', group: false, members: [{ id: 'v:5@nookara.cc', display_name: 'Alice' }, { id: 'l:7@a.example', handle: 'bob@a.example' }] };
const GROUP = { id: 'g9@a.example', group: true, members: [...DM.members, { id: 'l:2@b.example', display_name: 'Carol' }] };
const signer = p => ({ kid: p.kid, sigPriv: p.sigPriv });
const open = (enc, dm, from, p) => HD.openDm(enc, { dm: dm.id, from, kid: p.kid, encPriv: p.encPriv });

test('a key document becomes a bundle only when the account key vouches for it', async () => {
  const { b } = await KD.bundleOfDoc(V.key_document, 'l:7@a.example');
  assert.equal(b.kid, V.people.bob.kid);
  assert.equal(b.enc_pub, V.people.bob.enc_pub);
  assert.equal(b.sig_pub, V.people.bob.sig_pub);
  assert.equal(b.fp, V.people.bob.fingerprint);
  assert.deepEqual(KD.activeKeys(b).map(k => k.kid), [V.people.bob.kid, V.people.bob_client.kid], 'the revoked client gets no wrap');
  assert.equal(KD.signerKey(b, V.people.bob_client.kid), V.people.bob_client.sig_pub);
  // a Nookara account: its signatures carry the user id, and the id has to be that account's
  const nk = await KD.bundleOfDoc(V.key_document_nookara, 'v:5@nookara.cc');
  assert.equal(nk.b.owner, '5');
  await assert.rejects(KD.bundleOfDoc({ ...V.key_document_nookara, id: 'v:6@nookara.cc' }, 'v:6@nookara.cc'), /bad_key_list/);
  await assert.rejects(KD.bundleOfDoc({ ...V.key_document, owner: 'l:8@a.example' }, 'l:7@a.example'), /bad_key_list/);
  await assert.rejects(KD.bundleOfDoc(V.key_document, 'l:8@a.example'), /bad_key_list/, "someone else's document");
  // a homeserver adding a reader, dropping the signature, or swapping the key
  const extra = { ...V.key_document, clients: { seq: 3, list: [...V.key_document.clients.list, { ...V.key_document.clients.list[0], kid: V.people.carol.kid, enc_pub: V.people.carol.enc_pub }] } };
  await assert.rejects(KD.bundleOfDoc(extra, 'l:7@a.example'), /bad_key_list/);
  await assert.rejects(KD.bundleOfDoc({ ...V.key_document, clients_sig: null }, 'l:7@a.example'), /bad_key_list/);
  await assert.rejects(KD.bundleOfDoc({ ...V.key_document, keys: [{ ...V.key_document.keys[0], enc_public_key: V.people.carol.enc_pub }] }, 'l:7@a.example'), /bad_key_list/);
  await assert.rejects(KD.bundleOfDoc({ ...V.key_document, keys: [...V.key_document.keys, { ...V.key_document.keys[0] }] }, 'l:7@a.example'), /bad_key_list/, 'two account keys');
  // device entries beside the account key are for older readers: the signed list is what counts
  const withDevice = { ...V.key_document, keys: [...V.key_document.keys, { kid: V.people.bob_client.kid, kind: 'device', alg: 'p256', public_key: V.people.bob_client.sig_pub, enc_public_key: V.people.bob_client.enc_pub, signed_by: V.people.bob.kid }] };
  assert.equal((await KD.bundleOfDoc(withDevice, 'l:7@a.example')).b.kid, V.people.bob.kid);
  assert.deepEqual(await KD.bundleOfDoc({ id: 'l:7@a.example', keys: [] }, 'l:7@a.example'), { none: true });
  assert.deepEqual(await KD.bundleOfDoc({ id: 'l:7@a.example', keys: [{ kid: 'x', kind: 'account', alg: 'ed25519' }] }, 'l:7@a.example'), { none: true }, 'not an nke1 document');
});

test('a pin notices a new key and refuses an older client list', () => {
  assert.equal(KD.pinState(null, 'fp', 0), 'new');
  assert.equal(KD.pinState({ fp: 'fp', seq: 3 }, 'fp', 3), 'same');
  assert.equal(KD.pinState({ fp: 'fp', seq: 3 }, 'fp', 4), 'same');
  assert.equal(KD.pinState({ fp: 'fp', seq: 3 }, 'fp', 2), 'older');
  assert.equal(KD.pinState({ fp: 'fp', seq: 3 }, 'other', 0), 'changed');
  assert.equal(KD.isNookaraId('v:5@nookara.cc'), true);
  assert.equal(KD.isNookaraId('l:5@nookara.cc'), false);
  assert.equal(KD.normId('l:5@A.Example'), 'l:5@a.example');
});

test('two people on different homes seal and open, bound to the DM and the sender', async () => {
  const bundles = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': (await KD.bundleOfDoc(V.key_document, 'l:7@a.example')).b };
  const enc = await HD.sealDm({ dm: DM, me: 'v:5@nookara.cc', bundles, signer: signer(P.alice), text: 'hello\nhttps://a.example/uploads/x/file.bin#nke=k.i.pic%2Epng.image%2Fpng', quote: { from: 'bob', s: 'hi' } });
  assert.equal(enc.v, 2);
  assert.deepEqual(Object.keys(enc.wraps).sort(), [P.alice.kid, P.bob.kid, P.bob_client.kid].sort(), 'every key of every member, and only those');
  for (const p of [P.alice, P.bob, P.bob_client]) {
    const o = await open(enc, DM, 'v:5@nookara.cc', p);
    assert.equal(o.state, 'open');
    assert.equal(o.text, 'hello');
    assert.deepEqual(o.files, ['https://a.example/uploads/x/file.bin#nke=k.i.pic%2Epng.image%2Fpng']);
    assert.deepEqual(o.quote, { from: 'bob', s: 'hi' });
    assert.equal(o.key.length, 43);
  }
  assert.equal((await open(enc, DM, 'v:5@nookara.cc', P.carol)).state, 'failed');
  assert.equal((await open(enc, { id: 'other@a.example' }, 'v:5@nookara.cc', P.bob)).state, 'failed', 'moved to another DM');
  assert.equal((await open(enc, DM, 'l:7@a.example', P.bob)).state, 'failed', 'said to be from someone else');
  assert.equal(await HD.signatureOf(enc, bundles['v:5@nookara.cc'], { dm: DM.id, from: 'v:5@nookara.cc', id: '9' }), 'valid');
  assert.equal(await HD.signatureOf(enc, bundles['v:5@nookara.cc'], { dm: 'other@a.example', from: 'v:5@nookara.cc', id: '9' }), 'invalid');
  assert.equal(await HD.signatureOf(enc, bundles['l:7@a.example'], { dm: DM.id, from: 'l:7@a.example', id: '9' }), 'unknown', "not one of bob's keys");
  assert.equal(await HD.signatureOf(enc, bundles['v:5@nookara.cc'], { dm: DM.id, from: 'v:5@nookara.cc', id: '9', edited: true }), 'invalid', 'not an edit of 9');
  const edit = await HD.sealDm({ dm: DM, me: 'v:5@nookara.cc', bundles, signer: signer(P.alice), text: 'hello!', editOf: '9' });
  assert.equal(await HD.signatureOf(edit, bundles['v:5@nookara.cc'], { dm: DM.id, from: 'v:5@nookara.cc', id: '9', edited: true }), 'valid');
  assert.equal(await HD.signatureOf(edit, bundles['v:5@nookara.cc'], { dm: DM.id, from: 'v:5@nookara.cc', id: '10', edited: true }), 'invalid');
  // a linked client signs with its own key
  const fromClient = await HD.sealDm({ dm: DM, me: 'l:7@a.example', bundles, signer: signer(P.bob_client), text: 'from my client' });
  assert.equal(await HD.signatureOf(fromClient, bundles['l:7@a.example'], { dm: DM.id, from: 'l:7@a.example', id: '11' }), 'valid');
});

test('the sender of a message: short ids are the host\'s own accounts', () => {
  assert.equal(HD.senderId({ id: 'l:7' }, DM), 'l:7@a.example');
  assert.equal(HD.senderId({ id: 'v:5@Nookara.cc' }, DM), 'v:5@nookara.cc');
  assert.equal(HD.senderId({ id: 'l:7', account: 'l:7@a.example' }, DM), 'l:7@a.example');
  assert.equal(HD.senderId(null, DM), null);
});

test('a group: wrapped to everyone in it now, not to who joins later or was removed', async () => {
  const all = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': bundle(P.bob), 'l:2@b.example': bundle(P.carol), 'v:9@nookara.cc': bundle(P.dave) };
  const enc = await HD.sealDm({ dm: GROUP, me: 'v:5@nookara.cc', bundles: all, signer: signer(P.alice), text: 'three of us' });
  assert.equal(Object.keys(enc.wraps).length, 3);
  for (const p of [P.alice, P.bob, P.carol]) assert.equal((await open(enc, GROUP, 'v:5@nookara.cc', p)).text, 'three of us');
  assert.equal((await open(enc, GROUP, 'v:5@nookara.cc', P.dave)).state, 'failed', 'dave joined later: nothing from before');
  const bigger = { ...GROUP, members: [...GROUP.members, { id: 'v:9@nookara.cc' }] };
  const later = await HD.sealDm({ dm: bigger, me: 'v:5@nookara.cc', bundles: all, signer: signer(P.alice), text: 'four now', known: { ids: HD.memberIds(GROUP) } });
  assert.equal((await open(later, bigger, 'v:5@nookara.cc', P.dave)).text, 'four now');
  const smaller = { ...GROUP, members: GROUP.members.slice(0, 2) };
  const after = await HD.sealDm({ dm: smaller, me: 'v:5@nookara.cc', bundles: all, signer: signer(P.alice), text: 'carol left' });
  assert.equal((await open(after, smaller, 'v:5@nookara.cc', P.carol)).state, 'failed');
  // the change is what the notice shows
  const c = HD.membersCheck(bigger, 'v:5@nookara.cc', { ids: HD.memberIds(GROUP) });
  assert.deepEqual([c.added, c.removed, c.error], [['v:9@nookara.cc'], [], undefined]);
  assert.deepEqual(HD.membersCheck(smaller, 'v:5@nookara.cc', { ids: HD.memberIds(GROUP) }).removed, ['l:2@b.example']);
  assert.equal(HD.nameList(['Alice', 'bob', 'Carol']), 'Alice, bob and Carol');
  assert.equal(HD.memberName(GROUP, 'l:7@a.example'), 'bob');
});

test('a two-person DM is sealed to exactly its two people, whatever the host lists', async () => {
  const all = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': bundle(P.bob), 'l:2@b.example': bundle(P.carol) };
  const three = { ...DM, members: [...DM.members, { id: 'l:2@b.example' }] };
  await assert.rejects(HD.sealDm({ dm: three, me: 'v:5@nookara.cc', bundles: all, signer: signer(P.alice), text: 'x' }), /dm_members_changed/);
  const swapped = { ...DM, members: [DM.members[0], { id: 'l:2@b.example' }] };
  await assert.rejects(HD.sealDm({ dm: swapped, me: 'v:5@nookara.cc', bundles: all, signer: signer(P.alice), text: 'x', known: { ids: HD.memberIds(DM) } }), /dm_members_changed/);
  await assert.rejects(HD.sealDm({ dm: DM, me: 'l:2@b.example', bundles: all, signer: signer(P.carol), text: 'x' }), /not_a_member/);
});

test('nothing is sealed while a member has no keys, and never more than MAX_WRAPS', async () => {
  const some = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': bundle(P.bob) };
  const e = await HD.sealDm({ dm: GROUP, me: 'v:5@nookara.cc', bundles: some, signer: signer(P.alice), text: 'x' }).catch(x => x);
  assert.equal(e.message, 'no_keys');
  assert.deepEqual(e.missing, ['l:2@b.example']);
  const crowd = { ...bundle(P.bob), clients: { seq: 1, list: Array.from({ length: N.MAX_WRAPS }, (_, i) => ({ kid: 'c' + String(i).padStart(21, '0'), enc_pub: P.bob.enc_pub, revoked_at: 0 })) } };
  await assert.rejects(HD.sealDm({ dm: DM, me: 'v:5@nookara.cc', bundles: { ...some, 'l:7@a.example': crowd }, signer: signer(P.alice), text: 'x' }), /too_many_wraps/);
});

test('the outbox holds a message while someone has no keys, survives a reload, and only ever posts an envelope', async () => {
  const disk = new Map(); // what IndexedDB keeps
  const posted = [];
  const have = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': bundle(P.bob) };
  const deps = {
    dmOf: id => (id === GROUP.id ? GROUP : null),
    bundlesFor: async dm => { const ids = HD.memberIds(dm); return { bundles: Object.fromEntries(ids.filter(i => have[i]).map(i => [i, have[i]])), missing: ids.filter(i => !have[i]) }; },
    seal: a => HD.sealDm({ ...a, me: 'v:5@nookara.cc', signer: signer(P.alice) }),
    post: async (dm, enc, item) => { posted.push({ dm: dm.id, enc, nonce: item.nonce }); },
    hold: async item => { disk.set(item.nonce, JSON.parse(JSON.stringify(item))); },
    release: async nonce => { disk.delete(nonce); },
  };
  const item = { nonce: 'n1', dm: GROUP.id, me: 'v:5@nookara.cc', wire: 'see you at 8', created_at: 1 };
  const first = await HD.sendOrHold(item, deps);
  assert.deepEqual(first, { held: true, missing: ['l:2@b.example'] });
  assert.equal(posted.length, 0, 'nothing reached the host');
  assert.deepEqual(disk.get('n1').missing, ['l:2@b.example']);
  assert.equal(HD.nameList(disk.get('n1').missing.map(id => HD.memberName(GROUP, id))), 'Carol', 'Waiting for Carol to set up encryption');
  // a reload: only what is on disk is left. Still no keys: still held
  assert.equal(await HD.flushHeld([...disk.values()], 'v:5@nookara.cc', deps), 0);
  assert.equal(posted.length, 0);
  // carol sets up: it goes by itself, sealed, and leaves the outbox
  have['l:2@b.example'] = bundle(P.carol);
  assert.equal(await HD.flushHeld([...disk.values()], 'v:5@nookara.cc', deps), 1);
  assert.equal(disk.size, 0);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].enc.v, 2);
  assert.equal(JSON.stringify(posted[0]).includes('see you at 8'), false, 'no plain text in what was posted');
  assert.equal((await open(posted[0].enc, GROUP, 'v:5@nookara.cc', P.carol)).text, 'see you at 8');
  // someone else's held messages (another account on this device) are left alone
  disk.set('n2', { nonce: 'n2', dm: GROUP.id, me: 'l:7@a.example', wire: 'x' });
  assert.equal(await HD.flushHeld([...disk.values()], 'v:5@nookara.cc', deps), 0);
  // a sealer that hands back anything but an envelope stops the send
  await assert.rejects(HD.sendOrHold(item, { ...deps, seal: async () => ({ message: 'see you at 8' }) }), /not_sealed/);
  assert.equal(posted.length, 1);
});

test('a report goes to whoever manages the sender, with that one message and its key', async () => {
  const me = { id: 'l:7@a.example' };
  assert.deepEqual(R.reportRoute('v:5@nookara.cc', me), { to: 'nookara', domain: 'nookara.cc', own: false });
  assert.deepEqual(R.reportRoute('v:5@nookara.cc', { id: 'v:9@nookara.cc' }), { to: 'nookara', domain: 'nookara.cc', own: true });
  assert.deepEqual(R.reportRoute('l:2@b.example', me), { to: 'homeserver', domain: 'b.example', own: false });
  assert.deepEqual(R.reportRoute('l:3@a.example', me), { to: 'homeserver', domain: 'a.example', own: true });
  assert.deepEqual(R.reportRoute('l:3@a.example', { id: 'v:9@nookara.cc' }), { to: 'homeserver', domain: 'a.example', own: false }, 'a Nookara session reporting a homeserver account');
  assert.equal(R.reportRoute('l:7@a.example', me), null, 'my own message');
  assert.equal(R.reportRoute('nobody', me), null);

  const bundles = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': bundle(P.bob) };
  const enc = await HD.sealDm({ dm: DM, me: 'v:5@nookara.cc', bundles, signer: signer(P.alice), text: 'something awful' });
  const mine = await open(enc, DM, 'v:5@nookara.cc', P.bob);
  const args = { dm: DM.id, id: 41, from: 'v:5@nookara.cc', envelope: enc, key: mine.key, reason: 'harassment', details: '  again  ' };
  const hs = R.reportBody({ to: 'homeserver' }, args);
  assert.deepEqual(hs, { message: { dm: DM.id, id: '41', from: 'v:5@nookara.cc', envelope: enc }, revealed_key: mine.key, reason: 'harassment', details: 'again' });
  const nk = R.reportBody({ to: 'nookara' }, args);
  assert.deepEqual({ source: nk.source, dm: nk.dm, message_id: nk.message_id, from: nk.from, revealed_key: nk.revealed_key, reason: nk.reason }, { source: 'homeserver_dm', dm: DM.id, message_id: '41', from: 'v:5@nookara.cc', revealed_key: mine.key, reason: 'harassment' });
  assert.equal(nk.envelope, enc);
  assert.deepEqual(nk.message, hs.message);
  assert.equal(R.reportBody({ to: 'homeserver' }, { ...args, reason: 'because' }), null);
  assert.equal(R.reportBody({ to: 'homeserver' }, { ...args, key: '' }), null);
  assert.equal(JSON.stringify(hs).includes('something awful'), false, 'the report carries the sealed message, not its text');

  const m = { enc, sealed: { state: 'open', v: 2, key: mine.key } };
  assert.equal(R.canReportSealed(m, 'v:5@nookara.cc', me), true);
  assert.equal(R.canReportSealed(m, 'l:7@a.example', me), false);
  assert.equal(R.canReportSealed({ ...m, sealed: { state: 'failed', v: 2 } }, 'v:5@nookara.cc', me), false);
  assert.equal(R.canReportSealed({ ...m, pending: true }, 'v:5@nookara.cc', me), false);
});

test("an admin's Reports tab opens the reported message with its revealed key, and nothing else", async () => {
  const bundles = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': bundle(P.bob) };
  const bad = await HD.sealDm({ dm: DM, me: 'l:7@a.example', bundles, signer: signer(P.bob), text: 'the reported words\nhttps://a.example/uploads/x/file.bin#nke=k.i.a.b' });
  const other = await HD.sealDm({ dm: DM, me: 'l:7@a.example', bundles, signer: signer(P.bob), text: 'another message' });
  const key = (await open(bad, DM, 'l:7@a.example', P.alice)).key;
  const report = { id: '1', status: 'open', reason: 'threats', message: { dm: DM.id, id: '77', from: 'l:7@a.example', envelope: bad }, revealed_key: key, context: [{ id: '76', from: 'l:7@a.example', envelope: other, revealed_key: key }] };
  const r = await R.openReport(report);
  assert.equal(r.opened.text, 'the reported words');
  assert.equal(r.opened.files.length, 1);
  assert.equal(r.context[0].opened, null, 'that key opens the reported message only');
  assert.equal((await R.openReport({ ...report, revealed_key: N.b64(N.random(32)) })).opened, null);
  assert.equal((await R.openReport({ ...report, message: { ...report.message, from: 'v:5@nookara.cc' } })).opened, null, 'not under another sender');
  assert.equal((await R.openReport({ ...report, message: { ...report.message, dm: 'zz@a.example' } })).opened, null);
  assert.equal(await HD.openRevealed({ ...bad, v: 1 }, key, { dm: DM.id, from: 'l:7@a.example' }), null);
});

test('a link preview is made on the device, travels inside the message, and comes out of it', async () => {
  assert.equal(HD.firstLink('look https://example.org/a?b=1, and https://two.example/'), 'https://example.org/a?b=1');
  assert.equal(HD.firstLink('a file\nhttps://a.example/uploads/x/file.bin#nke=k.i.a.b'), null, "a sealed file's link is not a page");
  assert.equal(HD.firstLink('no links here'), null);
  const og = HD.parseOg('<html><head><title>Plain &amp; simple</title><meta property="og:title" content="A page"><meta name="description" content="What it  says"><meta property="og:image" content="/pic.png"></head></html>', 'https://example.org/a');
  assert.deepEqual(og, { title: 'A page', description: 'What it says', image: 'https://example.org/pic.png' });
  assert.deepEqual(HD.parseOg('<title>Only a title</title>', 'https://example.org/'), { title: 'Only a title', description: '', image: '' });
  const sealedImage = N.fileLink('https://a.example/uploads/p/file.bin', { key: 'kk', iv: 'ii', name: 'preview.png', mime: 'image/png' });
  assert.deepEqual(HD.cleanPreview({ url: 'https://example.org/a', title: 'A page', description: 'd', image: 'https://example.org/pic.png', extra: 1 }), { url: 'https://example.org/a', title: 'A page', description: 'd', image: '' }, 'a plain image address is never kept: opening it would tell that site who read the message');
  assert.equal(HD.cleanPreview({ url: 'javascript:alert(1)', title: 'x' }), null);
  assert.equal(HD.cleanPreview({ url: 'https://example.org/a' }), null, 'nothing to show');

  const bundles = { 'v:5@nookara.cc': bundle(P.alice), 'l:7@a.example': bundle(P.bob) };
  const preview = { url: 'https://example.org/a', title: 'A page', description: 'What it says', image: sealedImage };
  const enc = await HD.sealDm({ dm: DM, me: 'v:5@nookara.cc', bundles, signer: signer(P.alice), text: 'read https://example.org/a', preview });
  assert.equal(JSON.stringify(enc).includes('example.org'), false, 'the host sees neither the link nor the preview');
  const o = await open(enc, DM, 'v:5@nookara.cc', P.bob);
  assert.deepEqual(o.preview, preview);
  const none = await HD.sealDm({ dm: DM, me: 'v:5@nookara.cc', bundles, signer: signer(P.alice), text: 'read https://example.org/a' });
  assert.equal((await open(none, DM, 'v:5@nookara.cc', P.bob)).preview, null, 'no preview made = none shown (no server is asked)');
  const lying = await HD.sealDm({ dm: DM, me: 'v:5@nookara.cc', bundles, signer: signer(P.alice), text: 'read https://other.example/', preview });
  assert.equal((await open(lying, DM, 'v:5@nookara.cc', P.bob)).preview, null, 'a card for a link the message does not have');
  // the shared vector's payload carries one too
  const v = await open(V.v2.envelope, { id: V.v2.dm }, V.v2.from, P.carol);
  assert.equal(v.preview.title, 'A page');
  assert.equal(v.ts, 1764200000000);
});

test('a homeserver that is not Nookara takes a passphrase, never a PIN', () => {
  const hs = { nookara: false }, nk = { nookara: true };
  assert.deepEqual(KD.secretKinds(hs), ['passphrase']);
  assert.deepEqual(KD.secretKinds(nk), ['pin', 'password']);
  assert.equal(KD.validSecret(hs, 'pin', '123456'), false);
  assert.equal(KD.validSecret(hs, 'pin', '123456789012'), false);
  assert.equal(KD.validSecret(hs, 'passphrase', '123456789012'), false, 'twelve digits is still a PIN');
  assert.equal(KD.validSecret(hs, 'passphrase', 'eleven char'), false);
  assert.equal(KD.validSecret(hs, 'passphrase', 'twelve chars'), true);
  assert.equal(KD.validSecret(nk, 'pin', '123456'), true);
  assert.equal(KD.validSecret(nk, 'pin', '12345'), false);
  assert.equal(KD.validSecret(nk, 'password', 'ten chars!'), true);
  assert.deepEqual(KD.secretKindOf(hs, 'passcode'), { secret_kind: 'passphrase' });
  assert.deepEqual(KD.secretKindOf(hs, 'recovery'), { secret_kind: 'recovery' });
  assert.deepEqual(KD.secretKindOf(nk, 'passcode'), {}, "Nookara's setup call is as it was");
});
