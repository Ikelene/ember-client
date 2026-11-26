import test from 'node:test';
import assert from 'node:assert/strict';
import * as hs from '../src/chat/homeserver.js';

const json = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const use = routes => {
  const asked = [];
  hs.configure({ dev: false, timeout: 3000, fetch: async url => { asked.push(url); if (routes === 'down') throw new TypeError('fetch failed'); return url in routes ? json(200, routes[url]) : json(404, {}); } });
  return asked;
};
const V2 = { software: 'ember-server', protocol: 1, protocol_version: 2, accounts_mode: 'velora', homeserver: { domain: 'example.org', name: 'Example' }, communities_count: 2, communities: [], community: null };

test('locate: a domain that hosts its own servers (many per instance)', async () => {
  use({ 'https://example.org/.well-known/ember': V2 });
  const r = await hs.locate('example.org');
  assert.equal(r.origin, 'https://example.org');
  assert.equal(r.domain, 'example.org');
  assert.equal(r.protocol_version, 2);
  assert.equal(r.doc.homeserver.name, 'Example');
});
test('locate: a domain that points at its homeserver', async () => {
  const asked = use({ 'https://example.org/.well-known/ember': { homeserver: 'https://chat.example.org' }, 'https://chat.example.org/.well-known/ember': V2 });
  const r = await hs.locate('cool@example.org'); // (a whole address works: the part before @ is not the domain)
  assert.equal(r.origin, 'https://chat.example.org');
  assert.equal(r.domain, 'example.org');
  assert.equal(r.protocol_version, 2);
  assert.deepEqual(asked, ['https://example.org/.well-known/ember', 'https://chat.example.org/.well-known/ember']);
});
test('locate: an older server answers too (no login block, one server), under either well-known name', async () => {
  use({ 'https://old.example.org/.well-known/ember': { software: 'ember-server', protocol: 1, accounts_mode: 'local', community: { sid: 'a' } } });
  assert.equal((await hs.locate('old.example.org')).protocol_version, 1);
  use({ 'https://older.example.org/.well-known/bonfire': { software: 'bonfire-server', accounts_mode: 'velora' } });
  const r = await hs.locate('older.example.org');
  assert.equal(r.origin, 'https://older.example.org');
  assert.equal(r.protocol_version, 1);
  // resolve() still refuses it: signing in needs protocol 2
  await assert.rejects(hs.resolve('older.example.org'), e => e.code === 'legacy');
});
test('locate: nothing there, unreachable, a bad pointer, a pointer to nothing', async () => {
  use({});
  await assert.rejects(hs.locate('example.org'), e => e.code === 'not_found');
  use('down');
  await assert.rejects(hs.locate('example.org'), e => e.code === 'unreachable');
  use({ 'https://example.org/.well-known/ember': { homeserver: 'http://chat.example.org' } });
  await assert.rejects(hs.locate('example.org'), e => e.code === 'bad_url');
  use({ 'https://example.org/.well-known/ember': { homeserver: 'https://chat.example.org' } });
  await assert.rejects(hs.locate('example.org'), e => e.code === 'not_homeserver');
  use({ 'https://example.org/.well-known/ember': { homeserver: 'https://a.example.org' }, 'https://a.example.org/.well-known/ember': { homeserver: 'https://b.example.org' } });
  await assert.rejects(hs.locate('example.org'), e => e.code === 'not_homeserver');
  await assert.rejects(hs.locate('not a domain'), e => e.code === 'invalid');
  await assert.rejects(hs.locate('localhost'), e => e.code === 'invalid');
});
