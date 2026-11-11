import test from 'node:test';
import assert from 'node:assert/strict';
import { viaLabel, viaTitle, sessionLine, sessionShort, sessionDetails, sessionKind, sessionIsIdle } from '../src/chat/clientViaText.js';

// the client is the Nookara App that sent it (appClients.js): its registry name, logo and verified mark
const EMBER = 'app_e3be4c1d7a9f02b65c88', SC = 'app_41afda32aadb66d74415';
const REG = { [EMBER]: { name: 'Ember', icon: 'https://nookara.cc/assets/e.png', verified: true, website: 'https://ember.nookara.cc' }, [SC]: { name: 'ScratchCord V2', icon: null, verified: false, website: 'https://ikelene.net' } };
const lookup = id => REG[id];
test('Ember is just Ember, on every device, verified from the registry', () => {
  assert.equal(viaLabel({ official: true, kind: 'desktop', app: EMBER }, lookup), 'Ember');
  assert.equal(viaTitle({ official: true, kind: 'android', app: EMBER }, lookup), 'Sent from Ember (verified)');
  assert.equal(viaLabel({ official: true, kind: 'desktop', app: 'Ember (desktop app)' }, lookup), 'Ember'); // older messages: the project name
});
test('a registered app shows its registry name, not the token name', () => {
  assert.equal(viaLabel({ app: SC, token: 'something else', url: 'https://ikelene.net' }, lookup), 'ScratchCord V2');
  assert.equal(viaTitle({ app: SC, url: 'https://ikelene.net' }, lookup), 'Sent from ScratchCord V2');
});
test('no app: only the web address, never a token name', () => {
  assert.equal(viaLabel({ official: false, token: 'My bot', url: 'https://a.example' }, lookup), 'a.example');
  assert.equal(viaLabel({ url: 'https://nookara.cc', kind: 'desktop' }, lookup), 'nookara.cc'); // no more "Ember Desktop" by origin
  assert.equal(viaLabel({ official: false }, lookup), 'Unknown client');
});
test('an Ember server cannot borrow a verified mark', () => {
  assert.equal(viaTitle({ app: EMBER, url: 'https://ember.nookara.cc' }, lookup, true), 'Sent from Ember (verified)');
  assert.equal(viaTitle({ app: EMBER, url: 'https://evil.example' }, lookup, true), 'Sent from Ember');
  assert.equal(viaLabel({ official: true, url: 'https://ember.nookara.cc' }, lookup, true), 'ember.nookara.cc'); // (official from a server means nothing)
});
test('a session line lists platform, device, browser and version', () => {
  assert.equal(sessionLine({ platform: 'Windows', browser: 'Chrome', version: 'abc1234' }), 'Windows, Chrome, vabc1234');
  assert.equal(sessionLine({ platform: 'Android', browser: 'Electron' }), 'Android');
  assert.equal(sessionShort({ platform: 'Windows', browser: 'Chrome', version: 'abc1234' }), 'Chrome');
  assert.equal(sessionShort({ platform: 'Windows', browser: 'Electron', version: 'abc1234' }), 'Windows');
  assert.equal(sessionShort({}), '');
  assert.equal(sessionDetails({ platform: 'Windows', browser: 'Chrome', state: 'background' }), 'Windows, Chrome\nIn the background');
  assert.equal(sessionKind({ via: { kind: 'desktop' }, browser: 'Electron', platform: 'Windows' }), 'desktop');
  assert.equal(sessionKind({ via: { kind: 'android' } }), 'mobile');
  assert.equal(sessionKind({ mobile: true, browser: 'Chrome' }), 'mobile');
  assert.equal(sessionKind({ platform: 'iOS', browser: 'Safari' }), 'mobile');
  assert.equal(sessionKind({ platform: 'Windows', browser: 'Chrome' }), 'browser');
  assert.equal(sessionKind({}), 'browser');
  assert.equal(sessionIsIdle({ state: 'notifications' }), true);
  assert.equal(sessionIsIdle({ state: 'background' }), true);
  assert.equal(sessionIsIdle({ state: 'active' }), false);
});
