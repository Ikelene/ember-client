import test from 'node:test';
import assert from 'node:assert/strict';
import { statusUrl, statusIdForHost } from '../src/chat/status.js';

test('status urls point at the status page with the id', () => {
  assert.equal(statusUrl('ember'), 'https://ikelene.net/status/?s=ember');
  assert.equal(statusUrl('nookara-glint'), 'https://ikelene.net/status/?s=nookara-glint');
});
test('hosted servers map to ember-hosted, our other hosts to ember', () => {
  assert.equal(statusIdForHost('e-cool.nookara.cc'), 'ember-hosted');
  assert.equal(statusIdForHost('E_cool.nookara.cc:443'), 'ember-hosted');
  assert.equal(statusIdForHost('ember.nookara.cc'), 'ember');
  assert.equal(statusIdForHost('nookara.cc'), 'ember');
  assert.equal(statusIdForHost('chat.ikelene.net'), 'ember');
});
test('third-party hosts get no link', () => {
  for (const h of ['chat.example.com', 'nookara.cc.evil.example', 'evilnookara.cc', 'ikelene.net.evil.example', '', undefined]) assert.equal(statusIdForHost(h), null, String(h));
});
