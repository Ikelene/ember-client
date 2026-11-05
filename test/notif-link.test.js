import test from 'node:test';
import assert from 'node:assert/strict';
import { notifLinkUrl } from '../src/chat/hosts.js';

test('site paths go to the website, not the app', () => {
  assert.equal(notifLinkUrl('/moderator-apply'), 'https://nookara.cc/moderator-apply');
  assert.equal(notifLinkUrl('/admin#app-reviews'), 'https://nookara.cc/admin#app-reviews');
});

test('full links stay, anything else is dropped', () => {
  assert.equal(notifLinkUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(notifLinkUrl('//evil.example'), null);
  assert.equal(notifLinkUrl('javascript:alert(1)'), null);
  assert.equal(notifLinkUrl(''), null);
});
