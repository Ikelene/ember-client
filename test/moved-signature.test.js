// A message of a server that moved (imported): its signature covers the payload it was sent with on the old server,
// which the view hands back as signature.signed; the check uses that, and only on an address the server had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { signedPayload, receivedPayload, canonical, movedInstanceOk, signedOnHost } from '../src/chat/signing-payload.js';

const OLD = 'https://e-dementia.nookara.cc', NOW = 'https://chat.nookara.cc';
const signed = { iss: 'https://nookara.cc', instance: OLD, community: 's1', channel: 'c1', author: '7', ts: 1700000000000, nonce: 'n1', body: 'hello there', attachments: [], reply_to: '41', edit_of: null };
const m = { inst: NOW, server: `${NOW}|s9`, channel: `${NOW}|c9`, author: { velora_id: '7' }, body: 'hello there', attachments: [], reply_to: '9041', signature: { ts: signed.ts, nonce: 'n1', sig: '', kid: 'k', signed, moved_from: OLD } };
const bytes = p => new TextEncoder().encode(`ember-message-v1\n${canonical(p)}`);

test('the moved payload is the one signed on the old server', () => {
  const p = signedPayload(m, 'https://other.example');
  assert.equal(p.instance, OLD);
  assert.equal(p.community, 's1');
  assert.equal(p.channel, 'c1');
  assert.equal(p.reply_to, '41');
  assert.equal(p.iss, 'https://nookara.cc', 'its own issuer wins');
  assert.notEqual(canonical(p), canonical(receivedPayload(m, 'https://nookara.cc')), 'not the current ids');
  assert.equal(signedPayload({ ...m, signature: { ...m.signature, signed: undefined } }), null);
});

test('a moved signature checks out with the signed fields, and fails if they are changed', async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const sig = new Uint8Array(await webcrypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, bytes(signedPayload(m))));
  assert.equal(await webcrypto.subtle.verify({ name: 'Ed25519' }, kp.publicKey, sig, bytes(signedPayload(m))), true);
  const tampered = { ...m, signature: { ...m.signature, signed: { ...signed, body: 'changed' } } };
  assert.equal(await webcrypto.subtle.verify({ name: 'Ed25519' }, kp.publicKey, sig, bytes(signedPayload(tampered))), false);
  assert.equal(await webcrypto.subtle.verify({ name: 'Ed25519' }, kp.publicKey, sig, bytes(receivedPayload(m, 'https://nookara.cc'))), false, 'the current ids would not match');
});

test('the signed instance has to be an address the server had', () => {
  assert.equal(movedInstanceOk(OLD, NOW, [OLD]), true);
  assert.equal(movedInstanceOk(`${OLD}/`, NOW, ['https://E-DEMENTIA.nookara.cc']), true);
  assert.equal(movedInstanceOk(NOW, NOW, []), true);
  assert.equal(movedInstanceOk('https://e-other.nookara.cc', NOW, [OLD]), false);
  assert.equal(signedOnHost(m), 'e-dementia.nookara.cc');
  assert.equal(signedOnHost({ signature: { sig: 'x' } }), null);
});
