import test from 'node:test';
import assert from 'node:assert/strict';
import { viaLabel, viaTitle, sessionLine } from '../src/chat/clientViaText.js';

test('an official client is labelled Ember', () => {
  assert.equal(viaLabel({ official: true, name: 'Ember' }), 'Ember');
  assert.match(viaTitle({ official: true }), /official/);
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
