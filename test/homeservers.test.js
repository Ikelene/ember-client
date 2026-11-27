import test from 'node:test';
import assert from 'node:assert/strict';
import { homeDomainOf, homeLine, statusOf, homeserverRows, forgetText } from '../src/chat/homeservers.js';

const inst = o => ({ origin: 'https://chat.b.test', host: 'chat.b.test', v2: true, status: 'open', sleep: null, homeserver: { domain: 'b.test', name: 'B' }, ...o });

test('homeservers: a server is on the domain its homeserver names, else its address, else the host', () => {
  assert.equal(homeDomainOf(inst(), { address: 'cabin@other.test' }), 'b.test');
  assert.equal(homeDomainOf(inst({ homeserver: null }), { address: 'cabin@b.test' }), 'b.test');
  assert.equal(homeDomainOf(inst({ homeserver: null }), null), 'chat.b.test');
});

test('server menu: nothing about the homeserver while it is connected; reconnect or sign in when it is not', () => {
  assert.equal(homeLine(inst()), null);
  assert.equal(homeLine(inst({ status: 'connecting' })), null);
  assert.deepEqual(homeLine(inst({ sleep: 'manual' })), { action: 'reconnect', hint: 'You disconnected it' });
  assert.deepEqual(homeLine(inst({ sleep: 'idle', status: 'asleep' })), { action: 'reconnect', hint: 'Asleep (sleep mode)' });
  assert.deepEqual(homeLine(inst({ status: 'login' })), { action: 'signin', hint: 'Signed out' });
  assert.equal(homeLine(inst({ status: 'error' })).action, 'reconnect');
  assert.equal(homeLine(inst({ status: 'closed' })).action, 'reconnect');
  assert.equal(homeLine(inst({ status: 'banned' })), null);
  assert.equal(homeLine(null), null);
});

test('settings rows: every signed-in homeserver and every connection, once each', () => {
  const sessions = [{ origin: 'https://chat.b.test', domain: 'b.test', name: 'B Test', icon_url: null, account: { handle: 'carol@b.test' } }];
  const instances = [
    inst({ source: 'home', quiet: true, user: { username: 'carol' } }),
    inst({ origin: 'https://nookara.cc', host: 'nookara.cc', homeserver: { domain: 'nookara.cc', name: 'Nookara' }, source: 'remote', user: { username: 'carol' }, status: 'login' }),
    inst({ origin: 'https://dm.example', host: 'dm.example', quiet: true, source: null }), // a DM host: left out
    inst({ origin: 'https://old.example', host: 'old.example', v2: false, homeserver: null, name: 'Old', user: { username: 'carl' }, status: 'error' }),
  ];
  const servers = [{ inst: 'https://chat.b.test', name: 'Cabin' }, { inst: 'https://nookara.cc', name: 'Lounge' }];
  const rows = homeserverRows(sessions, instances, servers, { homeHandle: 'carol@b.test' });
  assert.deepEqual(rows.map(r => r.origin), ['https://chat.b.test', 'https://nookara.cc', 'https://old.example']);
  const [b, nk, old] = rows;
  assert.equal(b.name, 'B Test'); assert.equal(b.handle, 'carol@b.test'); assert.ok(b.session); assert.deepEqual(b.status, ['ok', 'Connected']); assert.deepEqual(b.servers, ['Cabin']);
  assert.equal(nk.handle, 'carol@b.test'); assert.equal(nk.session, false); assert.deepEqual(nk.status, ['warn', 'Signed out']);
  assert.equal(old.handle, 'carl@old.example'); assert.ok(old.legacy); assert.deepEqual(old.status, ['warn', "Can't connect"]);
  assert.deepEqual(homeserverRows(sessions, [], [])[0].status, ['ok', 'Signed in']);
  assert.deepEqual(statusOf(inst({ sleep: 'manual' })), ['warn', 'Disconnected']);
});

test('forget: the confirmation names the servers that leave the rail', () => {
  const row = { domain: 'b.test', session: true, servers: ['Cabin', 'Den'] };
  assert.match(forgetText(row), /Your 2 servers on it \(Cabin, Den\) leave your server list/);
  assert.match(forgetText(row), /signs out of b\.test/);
  assert.match(forgetText({ ...row, servers: ['a', 'b', 'c', 'd', 'e'] }), /\(a, b, c and 2 more\)/);
  assert.doesNotMatch(forgetText({ domain: 'x.test', session: false, servers: [] }), /servers on it|signs out/);
});
