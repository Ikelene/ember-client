import test from 'node:test';
import assert from 'node:assert/strict';
import { personName, serverOwnName, showsHandle, displayNameOf, seedDisplayName, _put, _reset } from '../src/chat/displayNames.js';
import { shownName } from '../src/chat/aliases.js';

test('Nookara people: the live display name, else the username', () => {
  assert.equal(personName({ username: 'nat' }, 'Nat'), 'Nat');
  assert.equal(personName({ username: 'nat' }, ''), 'nat');
  assert.equal(personName({ username: 'nat', display_name: null }, ''), 'nat');
  assert.equal(personName(null), '');
});

test("an Ember server's own name wins there; local accounts and bots never take a Nookara name", () => {
  // a Nookara person on an Ember server: the server says their display name
  assert.equal(personName({ username: 'nat', display_name: 'Natalie', kind: 'velora' }, 'Nat'), 'Natalie');
  // the server only repeats the username: the live Nookara one
  assert.equal(personName({ username: 'nat', display_name: 'nat', kind: 'velora' }, 'Nat'), 'Nat');
  // a server-made account named like a Nookara person: never their Nookara display name
  assert.equal(personName({ username: 'nat', display_name: 'nat', kind: 'local' }, 'Nat'), 'nat');
  assert.equal(personName({ username: 'helper', display_name: 'Helper Bot', kind: 'bot', inst: 'https://x' }, 'Someone'), 'Helper Bot');
  assert.equal(serverOwnName({ username: 'x', kind: 'local' }), true);
  assert.equal(serverOwnName({ username: 'x', kind: 'velora', inst: 'https://x' }), false);
  assert.equal(serverOwnName({ username: 'x' }), false);
  assert.equal(serverOwnName({ username: 'x', webhook: true }), true);
});

test('webhooks / bridged people / aliases keep the name they came with', () => {
  assert.equal(personName({ username: 'Hook', display_name: 'Hook', webhook: true }, 'Nope'), 'Hook');
  assert.equal(personName({ username: 'bot', alias_name: 'Jarvis' }, 'Nope'), 'Jarvis');
});

test('showsHandle: only when the shown name differs from the username', () => {
  assert.equal(showsHandle('Nat', { username: 'nat' }), true);
  assert.equal(showsHandle('nat', { username: 'nat' }), false);
  assert.equal(showsHandle('', { username: 'nat' }), false);
});

test('the cache: seeded from Nookara objects, null = none', () => {
  _reset();
  seedDisplayName({ username: 'Ike', display_name: '  Ikelene  ' });
  assert.equal(displayNameOf('ike'), 'Ikelene');
  seedDisplayName({ username: 'ike', display_name: null });
  assert.equal(displayNameOf('IKE'), '');
  seedDisplayName({ username: 'other' }); // no display_name key: unknown, nothing stored
  assert.equal(displayNameOf('other'), '');
});

test('message names (notifications, inbox, pins) use the display name', () => {
  _reset();
  _put('nat', 'Nat');
  assert.equal(shownName({ author: { username: 'nat' } }), 'Nat');
  assert.equal(shownName({ author: { username: 'nat', kind: 'local' }, inst: 'https://x' }), 'nat');
  assert.equal(shownName({ author: { username: 'bot', bot: true }, alias: { name: 'Jarvis' } }), 'Jarvis');
  assert.equal(shownName(null), 'Nookara');
});
