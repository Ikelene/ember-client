import test from 'node:test';
import assert from 'node:assert/strict';
import { shortLinkHash, shortLinkFor } from '../src/chat/shortLinks.js';
import { inviteRef } from '../src/chat/inviteLink.js';

test('short links become Ember routes', () => {
  assert.equal(shortLinkHash('/invite/Tzz31TG4'), '#/invite/Tzz31TG4');
  assert.equal(shortLinkHash('/invite/chat.ikelene.net/Tzz31TG4'), '#/i/https%3A%2F%2Fchat.ikelene.net/invite/Tzz31TG4');
  assert.equal(shortLinkHash('/server/chat.ikelene.net'), '#/i/https%3A%2F%2Fchat.ikelene.net');
  assert.equal(shortLinkHash('/server/Chat.Ikelene.net/'), '#/i/https%3A%2F%2Fchat.ikelene.net');
  for (const p of ['/', '/invite/', '/invite/a/b/c', '/server/', '/server/a/b', '/chat']) assert.equal(shortLinkHash(p), null, p);
});

test('invites and Ember servers get short links, the rest keeps the long form', () => {
  const B = 'https://ember.nookara.cc';
  assert.equal(shortLinkFor({ kind: 'invite', code: 'Tzz31TG4', inst: 'velora' }, B), `${B}/invite/Tzz31TG4`);
  assert.equal(shortLinkFor({ kind: 'invite', code: 'Tzz31TG4', inst: 'https://chat.ikelene.net' }, B), `${B}/invite/chat.ikelene.net/Tzz31TG4`);
  assert.equal(shortLinkFor({ kind: 'instance', inst: 'https://chat.ikelene.net' }, B), `${B}/server/chat.ikelene.net`);
  assert.equal(shortLinkFor({ kind: 'invite', code: 'x1', inst: 'http://localhost:3000' }, B), null);
  assert.equal(shortLinkFor({ kind: 'server', sid: 's1' }, B), null);
});

test('short invite links still show an invite card', () => {
  assert.deepEqual(inviteRef('https://ember.nookara.cc/invite/Tzz31TG4'), { inst: null, code: 'Tzz31TG4', sure: true });
  assert.deepEqual(inviteRef('https://ember.nookara.cc/invite/chat.ikelene.net/Tzz31TG4'), { inst: 'https://chat.ikelene.net', code: 'Tzz31TG4', sure: true });
  assert.deepEqual(inviteRef('https://ember.nookara.cc/#/i/https%3A%2F%2Fchat.ikelene.net/invite/Tzz31TG4'), { inst: 'https://chat.ikelene.net', code: 'Tzz31TG4', sure: true });
});
