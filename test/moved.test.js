import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedSlug, movedHome } from '../src/chat/moved.js';

test('hostedSlug reads e-<slug>.nookara.cc only', () => {
  assert.equal(hostedSlug('https://e-cabin.nookara.cc'), 'cabin');
  assert.equal(hostedSlug('https://E-Big-Room.nookara.cc'), 'big-room');
  assert.equal(hostedSlug('https://cabin.nookara.cc'), null);
  assert.equal(hostedSlug('http://e-cabin.nookara.cc'), null);
  assert.equal(hostedSlug('https://e-cabin.nookara.cc.evil.test'), null);
});

test('movedHome finds the homeserver listing the old origin', async () => {
  const docs = { 'https://b.test': { homeserver: { domain: 'b.test' }, previous_urls: ['https://e-cabin.nookara.cc/'] }, 'https://c.test': { previous_urls: [] } };
  globalThis.fetch = async u => { const o = new URL(u).origin; return { ok: !!docs[o], json: async () => docs[o] }; };
  // a connected one already knows its previous_urls
  assert.deepEqual(await movedHome('https://e-old.nookara.cc', [{ origin: 'https://a.test', domain: 'a.test', previousUrls: ['https://e-old.nookara.cc'] }]), { origin: 'https://a.test', domain: 'a.test' });
  // others are asked
  assert.deepEqual(await movedHome('https://e-cabin.nookara.cc', [{ origin: 'https://c.test' }, { origin: 'https://b.test' }]), { origin: 'https://b.test', domain: 'b.test' });
  assert.equal(await movedHome('https://e-gone.nookara.cc', [{ origin: 'https://c.test' }]), null);
});
