// Writes test/vectors/nke1.json: fixed keys and one fixed message, sealed as v: 1 (a Nookara DM) and v: 2 (a homeserver DM),
// for the client's tests and for the servers' (ember-server, Nookara) to check their side against. Signatures and wraps are
// random each run (ECDSA, fresh ECDH keys), so the file is made once and kept: run this again only to change what is in it.
//   node scripts/make-nke1-vectors.mjs
import { writeFileSync } from 'node:fs';
import * as N from '../src/chat/e2ee/nke1.js';

const subtle = globalThis.crypto.subtle, te = new TextEncoder();
const person = async (owner, id) => ({ owner, id, ...(await N.newKeys()) });
const [alice, dave, bob, carol, client] = await Promise.all([person('5', 'v:5@nookara.cc'), person('9', 'v:9@nookara.cc'), person('l:7@a.example', 'l:7@a.example'), person('l:2@b.example', 'l:2@b.example'), N.newKeys()]);
const sigPriv = p => N.importSigPriv(p.sig_priv);
const K = Uint8Array.from({ length: 32 }, (_, i) => i + 1), IV = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
const k = N.b64(K), iv = N.b64(IV), commit = await N.commitOf(K);

// one sealed message, built by hand so K and iv are the fixed ones
async function envelope(v, ctx, payloadJson, recipients, signer, editOf = 0) {
  const key = await subtle.importKey('raw', K, 'AES-GCM', false, ['encrypt']);
  const ct = N.b64(await subtle.encrypt({ name: 'AES-GCM', iv: IV, additionalData: te.encode(N.aadText(ctx)) }, key, te.encode(payloadJson)));
  const wraps = {};
  for (const r of recipients) wraps[r.kid] = await N.seal(K, r.enc_pub, r.kid);
  const sig = N.b64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await sigPriv(signer), te.encode(N.sigText(ctx, editOf, iv, ct, commit))));
  return { v, ct, iv, commit, sig, signer: signer.kid, wraps };
}

const clientsOf = async (p, doc) => ({ owner: p.owner, kid: p.kid, doc, text: N.clientsText(p.owner, p.kid, doc), sig: await N.signClients(p.owner, p.kid, doc, await sigPriv(p)) });
const entry = (c, label, extra = {}) => ({ kid: c.kid, enc_pub: c.enc_pub, sig_pub: c.sig_pub, label, app: 'app_x', added_at: 1764200000000, revoked_at: 0, ...extra });
const revoked = await N.newKeys();
const bobClients = await clientsOf(bob, { seq: 3, list: [entry(client, 'My client, v1'), entry(revoked, 'old; one', { revoked_at: 1764200005000 })] });
const aliceClients = await clientsOf(alice, { seq: 1, list: [entry(client, 'Hyperfocus')] });

const v1ctx = { v: 1, from: 5, to: 9 }, p1 = JSON.stringify({ t: 'hello >w<', n: 'AAECAwQFBgc' });
const dm = 'd1a2b3@a.example', v2ctx = { v: 2, dm, from: alice.id };
const p2 = JSON.stringify({ t: 'hello >w<\nhttps://example.org/a', r: { from: 'bob', s: 'hi' }, n: 'AAECAwQFBgc', ts: 1764200000000, p: { url: 'https://example.org/a', title: 'A page', description: 'What it says', image: '' } });
const members = [alice, bob, client, carol];
const v1 = await envelope(1, v1ctx, p1, [dave, alice], alice);
const v2 = await envelope(2, v2ctx, p2, members, alice);
const v2edit = await envelope(2, v2ctx, p2, members, alice, 42);

const pub = p => ({ owner: p.owner, id: p.id, kid: p.kid, enc_pub: p.enc_pub, sig_pub: p.sig_pub, enc_priv: p.enc_priv, sig_priv: p.sig_priv, fingerprint: undefined });
const people = { alice: pub(alice), dave: pub(dave), bob: pub(bob), carol: pub(carol), bob_client: { kid: client.kid, enc_pub: client.enc_pub, sig_pub: client.sig_pub, enc_priv: client.enc_priv, sig_priv: client.sig_priv } };
for (const p of Object.values(people)) p.fingerprint = await N.fingerprint(p.enc_pub, p.sig_pub);

const out = {
  format: 'nke1', note: 'Test keys only. Made by ember/scripts/make-nke1-vectors.mjs. base64url without padding everywhere; private keys are JWK.',
  people,
  message: { k, iv, commit, commit_text: 'nke1 commit' },
  v1: { from: 5, to: 9, aad: N.aadText(v1ctx), payload: p1, sig_text: N.sigText(v1ctx, 0, iv, v1.ct, commit), envelope: v1, opens_for: ['dave', 'alice'] },
  v2: {
    dm, from: alice.id, aad: N.aadText(v2ctx), payload: p2, sig_text: N.sigText(v2ctx, 0, iv, v2.ct, commit), envelope: v2, opens_for: ['alice', 'bob', 'bob_client', 'carol'],
    edit: { edit_of: '42', sig_text: N.sigText(v2ctx, 42, iv, v2edit.ct, commit), envelope: v2edit },
    wrong: { dm: 'zzzzzz@a.example', from: 'l:7@a.example' }, // the same ciphertext under another DM or sender must not open or verify
  },
  clients: { numeric_owner: aliceClients, stable_owner: bobClients },
  key_document: { // PROTOCOL 4c.6 / E2EE-HOMESERVERS 3.1, as bob's home serves it
    id: bob.id, format: 'nke1', owner: bob.owner,
    keys: [{ kid: bob.kid, kind: 'account', alg: 'p256', public_key: bob.sig_pub, enc_public_key: bob.enc_pub, created_at: 1764200000000 }],
    clients: bobClients.doc, clients_sig: bobClients.sig, clients_seq: 3, past: [],
  },
  key_document_nookara: {
    id: alice.id, format: 'nke1', owner: alice.owner,
    keys: [{ kid: alice.kid, kind: 'account', alg: 'p256', public_key: alice.sig_pub, enc_public_key: alice.enc_pub, created_at: 1764200000000 }],
    clients: aliceClients.doc, clients_sig: aliceClients.sig, clients_seq: 1, past: [],
  },
  safety: {
    numeric: { a: { uid: 5, fp: people.alice.fingerprint }, b: { uid: 9, fp: people.dave.fingerprint }, code: await N.safetyCode({ uid: 5, fp: people.alice.fingerprint }, { uid: 9, fp: people.dave.fingerprint }) },
    stable: { a: { uid: alice.id, fp: people.alice.fingerprint }, b: { uid: bob.id, fp: people.bob.fingerprint }, code: await N.safetyCode({ uid: alice.id, fp: people.alice.fingerprint }, { uid: bob.id, fp: people.bob.fingerprint }) },
  },
};
writeFileSync(new URL('../test/vectors/nke1.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('test/vectors/nke1.json written');
