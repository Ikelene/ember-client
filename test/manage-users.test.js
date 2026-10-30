import test from 'node:test';
import assert from 'node:assert/strict';
import { viaLabel, viaTitle, sessionLine } from '../src/chat/clientViaText.js';

test('an official client is labelled Ember (before the official clients list has loaded)', () => {
  assert.equal(viaLabel({ official: true, name: 'Ember' }), 'Ember');
  assert.match(viaTitle({ official: true }), /official/);
});
test('with the official clients list, the name comes from it', () => {
  const list = [{ name: 'Ember Desktop', origins: ['nookara.cc'], kinds: ['desktop'], app_ids: [], verified: true }];
  assert.equal(viaLabel({ url: 'https://nookara.cc', kind: 'desktop' }, list), 'Ember Desktop');
  assert.equal(viaTitle({ url: 'https://nookara.cc', kind: 'desktop' }, list), 'Sent from Ember Desktop (official)');
  assert.equal(viaLabel({ url: 'https://nookara.cc' }, list), 'nookara.cc');
});
test('other clients show their token name, then their URL', () => {
  assert.equal(viaLabel({ official: false, token: 'My bot', url: 'https://a.example' }), 'My bot');
  assert.equal(viaLabel({ official: false, url: 'https://a.example' }), 'a.example');
  assert.equal(viaLabel({ official: false }), 'Unknown client');
});
test('a session line lists platform, device, browser and version', () => {
  assert.equal(sessionLine({ platform: 'Windows', browser: 'Chrome', version: 'abc1234' }), 'Windows, Chrome, vabc1234');
  assert.equal(sessionLine({ platform: 'Android', browser: 'Electron' }), 'Android');
});
