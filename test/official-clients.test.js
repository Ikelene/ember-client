import test from 'node:test';
import assert from 'node:assert/strict';
import { matchClient, describeVia, hostMatches, normHost } from '../src/chat/officialClients.js';

// the same seed Velora starts with (official-clients.js SEED), plus a third-party entry without the badge
const LIST = [
  { id: 1, name: 'Ember Desktop', origins: ['velora.ikelene.net'], kinds: ['desktop'], app_ids: ['Ember (desktop app)', 'Bonfire (desktop app)'], icon_url: null, verified: true },
  { id: 2, name: 'Ember Android', origins: ['velora.ikelene.net'], kinds: ['android'], app_ids: ['Ember (Android app)', 'Bonfire (Android app)'], icon_url: null, verified: true },
  { id: 3, name: 'Ember', origins: ['velora.ikelene.net'], kinds: [], app_ids: ['Ember (web)', 'Bonfire (web)'], icon_url: null, verified: true },
  { id: 4, name: 'Velocity', origins: ['amperes.ikelene.net'], kinds: [], app_ids: [], icon_url: 'https://amperes.ikelene.net/i.png', verified: false },
];

test('hosts: scheme / path / case are ignored, wildcards are subdomains only', () => {
  assert.equal(normHost('https://Velora.ikelene.net/chat?x'), 'velora.ikelene.net');
  assert.ok(hostMatches('*.ikelene.net', 'amperes.ikelene.net'));
  assert.ok(!hostMatches('*.ikelene.net', 'ikelene.net'));
  assert.ok(!hostMatches('ikelene.net', 'evilikelene.net'));
});
test('Velora messages: the apps by token name, the site by origin', () => {
  assert.equal(matchClient({ official: true, kind: 'desktop', app: 'Ember (desktop app)', url: null }, LIST).name, 'Ember Desktop');
  assert.equal(matchClient({ official: true, kind: 'android', app: 'Bonfire (Android app)' }, LIST).name, 'Ember Android');
  assert.equal(matchClient({ official: true, kind: 'web', url: 'https://velora.ikelene.net' }, LIST).name, 'Ember');
});
test('Ember server messages: origin + the kind from the User-Agent', () => {
  assert.equal(matchClient({ url: 'https://velora.ikelene.net', kind: 'desktop' }, LIST).name, 'Ember Desktop');
  assert.equal(matchClient({ url: 'https://velora.ikelene.net', kind: 'android' }, LIST).name, 'Ember Android');
  assert.equal(matchClient({ url: 'https://velora.ikelene.net' }, LIST).name, 'Ember');
});
test('named third-party tokens and unknown origins do not match', () => {
  assert.equal(matchClient({ token: 'My bot', url: 'https://velora.ikelene.net', kind: 'other' }, LIST), null);
  assert.equal(matchClient({ url: 'https://studio.penguinmod.com' }, LIST), null);
  assert.equal(matchClient({ url: 'https://velora.ikelene.net' }, null), null);
});
test('describeVia: name + badge for official ones, domain / token for the rest', () => {
  assert.deepEqual(describeVia({ url: 'https://velora.ikelene.net' }, LIST), { name: 'Ember', verified: true, icon: null, domain: 'velora.ikelene.net', known: true });
  assert.deepEqual(describeVia({ url: 'https://amperes.ikelene.net' }, LIST), { name: 'Velocity', verified: false, icon: 'https://amperes.ikelene.net/i.png', domain: 'amperes.ikelene.net', known: true });
  assert.deepEqual(describeVia({ url: 'https://studio.penguinmod.com' }, LIST), { name: 'studio.penguinmod.com', verified: false, icon: null, domain: '', known: false });
  assert.equal(describeVia({ token: 'My bot' }, LIST).name, 'My bot');
  assert.equal(describeVia({}, LIST).name, 'Unknown client');
  // list not loaded yet: Velora's own flag stands in
  assert.equal(describeVia({ official: true, name: 'Ember' }, null).verified, true);
  // loaded, but no entry: an Ember server can't make itself verified by sending official: true
  assert.equal(describeVia({ official: true, url: 'https://evil.example' }, LIST).verified, false);
  // icons: https or a Velora path only
  assert.equal(describeVia({ url: 'https://x.example' }, [{ name: 'X', origins: ['x.example'], kinds: [], app_ids: [], icon_url: 'javascript:alert(1)', verified: true }]).icon, null);
});
