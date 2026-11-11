// Sticker messages are signed like any other: the payload names the sticker id (and only sticker messages carry the key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { payloadOf, receivedPayload, canonical } from '../src/chat/signing-payload.js';

const base = { iss: 'https://velora.ikelene.net', instance: 'https://chat.ikelene.net', community: 's1', channel: 'c1', author: '7', ts: 5, nonce: 'n', body: '', attachments: [], reply_to: null, edit_of: null };

test('a text payload has no sticker key (unchanged bytes)', () => {
  assert.equal('sticker' in payloadOf(base), false);
  assert.equal(canonical(payloadOf({ ...base, sticker: null })), canonical(payloadOf(base)));
});
test('a sticker payload names the sticker', () => {
  assert.equal(payloadOf({ ...base, sticker: 'tabc0123456' }).sticker, 'tabc0123456');
});
test('a received sticker message is checked with its sticker id', () => {
  const m = { inst: 'https://chat.ikelene.net', server: 'https://chat.ikelene.net|s1', channel: 'https://chat.ikelene.net|c1', author: { velora_id: '7' }, body: '', attachments: [], signature: { ts: 5, nonce: 'n' }, sticker: { tid: 'tabc0123456' } };
  const p = receivedPayload(m, base.iss);
  assert.equal(p.sticker, 'tabc0123456');
  assert.equal('sticker' in receivedPayload({ ...m, sticker: undefined }, base.iss), false);
});
