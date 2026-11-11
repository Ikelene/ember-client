import test from 'node:test';
import assert from 'node:assert/strict';
import { viaLabel, viaTitle, sessionLine, sessionShort, sessionDetails, sessionKind, sessionIsIdle, mergeSessions } from '../src/chat/clientViaText.js';

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
  assert.equal(viaLabel({ url: 'https://a.example', kind: 'desktop' }, lookup), 'a.example');
  assert.equal(viaLabel({ official: false }, lookup), 'Unknown client');
});
test('no App id but sent from the Ember site: Ember (old messages, old Ember server sessions)', () => {
  assert.equal(viaTitle({ url: 'https://ember.nookara.cc', kind: 'desktop' }, lookup, true), 'Sent from Ember (verified)');
  assert.equal(viaLabel({ url: 'https://nookara.cc' }, lookup), 'Ember');
  assert.equal(viaLabel({ url: 'https://ember.nookara.cc.evil.example' }, lookup, true), 'ember.nookara.cc.evil.example');
});
test('an Ember server cannot borrow a verified mark', () => {
  assert.equal(viaTitle({ app: EMBER, url: 'https://ember.nookara.cc' }, lookup, true), 'Sent from Ember (verified)');
  assert.equal(viaTitle({ app: EMBER, url: 'https://evil.example' }, lookup, true), 'Sent from Ember');
  assert.equal(viaLabel({ official: true, url: 'https://a.example' }, lookup, true), 'a.example'); // (official from a server means nothing)
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

test("an Ember server's clients merge with Nookara's: Ember (on both) once, the rest added and marked", () => {
  const nookara = [
    { via: { official: true, kind: 'desktop', app: EMBER }, platform: 'Windows', browser: 'Electron' },
    { via: { app: EMBER, url: 'https://ember.nookara.cc' }, browser: 'Chrome', platform: 'Windows' },
  ];
  const inst = [
    { via: { url: 'https://ember.nookara.cc', kind: 'desktop', app: EMBER }, platform: 'Windows', browser: 'Electron' }, // = the desktop app
    { via: { url: 'https://ember.nookara.cc', app: EMBER }, browser: 'Chrome' }, // = the Chrome tab
    { via: { url: 'https://ember.nookara.cc', app: EMBER }, browser: 'Firefox' }, // a second tab, only on the server
    { via: { url: 'https://ikelene.net', app: SC }, browser: 'Chrome' }, // ScratchCord, only on the server
    { via: {} }, // a script
  ];
  const out = mergeSessions(nookara, inst, lookup);
  assert.equal(out.length, 5);
  assert.deepEqual(out.slice(0, 2), nookara);
  assert.deepEqual(out.slice(2).map(s => s.inst), [true, true, true]);
  assert.equal(out[2].browser, 'Firefox');
  assert.equal(viaLabel(out[3].via, lookup, true), 'ScratchCord V2');
  assert.equal(viaLabel(out[4].via, lookup, true), 'Unknown client');
  assert.deepEqual(mergeSessions([], inst.slice(0, 1), lookup), [{ ...inst[0], inst: true }]);
  assert.deepEqual(mergeSessions(nookara, [], lookup), nookara);
});
test("an Ember server's session cannot borrow a verified mark either", () => {
  assert.equal(viaTitle({ app: SC, url: 'https://evil.example' }, lookup, true), 'Sent from ScratchCord V2');
  assert.equal(viaTitle({ app: EMBER, url: 'https://evil.example', kind: 'desktop' }, lookup, true), 'Sent from Ember');
});
test('bot gateway connections: a bot icon, never a token name', () => {
  assert.equal(sessionKind({ via: { kind: 'bot' } }), 'bot');
  assert.equal(viaLabel({ kind: 'bot' }, lookup, true), 'Bot connection');
  assert.equal(viaLabel({ kind: 'bot', token: 'secret name' }, lookup, true), 'Bot connection');
  assert.equal(viaLabel({ kind: 'bot', url: 'https://bot.example' }, lookup, true), 'bot.example');
});
