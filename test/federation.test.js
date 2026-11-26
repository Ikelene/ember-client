import test from 'node:test';
import assert from 'node:assert/strict';
import { isDomainRule, isIP, isCidr, denyKind, cleanDeny, denyIssue, domainRules, domainRuleIssue, listUrl, listErrorText, listStatus,
  readNumbers, federationForm, federationPatch, remoteAccountsPatch, clampDays, effectiveDays, DEFAULT_DENYLIST } from '../src/chat/federation.js';
import { adminErrorText } from '../src/chat/homeAdmin.js';

test('domain rules: a name, or *. and a name', () => {
  for (const ok of ['example.org', 'a.b.example.org', '*.example.org', 'localhost', 'xn--bcher-kva.example']) assert.ok(isDomainRule(ok), ok);
  for (const bad of ['', '*example.org', 'ex ample.org', '-x.org', 'x-.org', 'a..b', '*.*.example.org', 'example.org.', 'https://example.org', 'Example.org']) assert.ok(!isDomainRule(bad), bad);
});

test('addresses and networks', () => {
  for (const ok of ['1.2.3.4', '::1', '2001:db8::', '::ffff:1.2.3.4', '2001:0db8:0000:0000:0000:0000:0000:0001']) assert.ok(isIP(ok), ok);
  for (const bad of ['1.2.3', '256.1.1.1', '1.2.3.4.5', '2001:db8', ':::1', '1::2::3', '12345::', 'g::1', '1:2:3:4:5:6:7:8:9']) assert.ok(!isIP(bad), bad);
  for (const ok of ['203.0.113.0/24', '10.0.0.0/8', '1.2.3.4', '1.2.3.4/32', '2001:db8::/32', '::/0', '::1/128']) assert.ok(isCidr(ok), ok);
  for (const bad of ['203.0.113.0/33', '2001:db8::/129', '1.2.3/24', 'x/24', '1.2.3.4/']) assert.ok(!isCidr(bad), bad);
});

test('deny entries: domain, *.domain, network, account', () => {
  assert.equal(denyKind('bad.example'), 'domain');
  assert.equal(denyKind('*.bad.example'), 'subdomains');
  assert.equal(denyKind('203.0.113.0/24'), 'network');
  assert.equal(denyKind('2001:db8::/32'), 'network');
  assert.equal(denyKind('198.51.100.7'), 'network');
  assert.equal(denyKind('l:9@some.example'), 'account');
  assert.equal(denyKind('alice@some.example'), 'account');
  for (const bad of ['', '   ', '1.2.3', '300.1.1.1/8', '203.0.113.0/40', '@x.org', 'a b@x.org', 'alice@*.x.org', 'alice@', 'bad_name.org', '*bad.org', 'https://bad.org', 'x'.repeat(321)]) assert.equal(denyKind(bad), null, bad);
  // what the server keeps: domains lower case, an account id keeps its case
  assert.equal(cleanDeny('  Bad.Example '), 'bad.example');
  assert.equal(cleanDeny('L:9@Some.Example'), 'L:9@some.example');
  assert.equal(cleanDeny('2001:DB8::/32'), '2001:db8::/32');
  assert.equal(cleanDeny('nope nope'), null);
});

test('deny entries: what is wrong, in words', () => {
  assert.equal(denyIssue('bad.example'), '');
  assert.match(denyIssue(''), /Type something/);
  assert.match(denyIssue('https://bad.example'), /without https/);
  assert.match(denyIssue('a b@x.org'), /id@domain/);
  assert.match(denyIssue('203.0.113.0/40'), /IP address or range/);
  assert.match(denyIssue('1.2.3'), /IP address or range/);
  assert.match(denyIssue('bad.*.org'), /star only goes at the front/);
  assert.match(denyIssue('bad_name'), /Not a domain, IP range or account/);
});

test('homeserver lists: cleaned, no repeats, the bad ones named', () => {
  assert.deepEqual(domainRules('nookara.cc\n*.Example.org, https://x.org/path  nookara.cc'), { list: ['nookara.cc', '*.example.org', 'x.org'], bad: [] });
  assert.deepEqual(domainRules(['a.org', 'not a domain', 'b.*.org']), { list: ['a.org'], bad: ['not a domain', 'b.*.org'] });
  assert.deepEqual(domainRules(''), { list: [], bad: [] });
  assert.equal(domainRuleIssue([]), '');
  assert.match(domainRuleIssue(['x_y']), /"x_y" isn't a domain/);
  assert.match(domainRuleIssue(['a_', 'b_', 'c_', 'd_']), /"a_", "b_", "c_" and more aren't a domain/);
});

test('deny list addresses: https only', () => {
  assert.equal(listUrl(DEFAULT_DENYLIST), DEFAULT_DENYLIST);
  assert.equal(listUrl(' https://lists.example/deny.json '), 'https://lists.example/deny.json');
  for (const bad of ['http://lists.example/x', 'https://u:p@lists.example/x', 'https://lists.example/x#y', 'lists.example/x', '']) assert.equal(listUrl(bad), null, bad);
});

test('list status: the error in plain words, the last good copy still counts', () => {
  assert.match(listErrorText('bad_signature'), /signature doesn't match/);
  assert.match(listErrorText('unsigned'), /isn't signed/);
  assert.match(listErrorText('unknown_kid'), /key its host doesn't publish/);
  assert.match(listErrorText('http_404'), /no list at that address \(404\)/);
  assert.match(listErrorText('http_503'), /had a problem \(503\)/);
  assert.match(listErrorText('http_418'), /answered 418/);
  assert.match(listErrorText('getaddrinfo ENOTFOUND lists.example'), /Couldn't reach/);
  assert.match(listErrorText('timeout'), /too long/);
  const now = 1_700_000_000_000;
  assert.deepEqual(listStatus({ url: 'x', entries: 12, fetched_at: now - 5 * 60e3, error: null }, now), { tone: 'ok', text: '12 entries, checked 5 minutes ago.' });
  assert.deepEqual(listStatus({ url: 'x', entries: 1, fetched_at: now - 10e3, error: null }, now), { tone: 'ok', text: '1 entry, checked just now.' });
  assert.deepEqual(listStatus({ url: 'x', entries: 0, fetched_at: null, error: null }, now), { tone: 'wait', text: 'Not fetched yet.' });
  const bad = listStatus({ url: 'x', entries: 40, fetched_at: now - 3 * 3600e3, error: 'bad_signature' }, now);
  assert.equal(bad.tone, 'warn');
  assert.match(bad.text, /signature.*The copy from 3 hours ago \(40 entries\) still applies\./);
  assert.equal(listStatus({ url: 'x', entries: 0, fetched_at: null, error: 'http_404' }, now).text, "There's no list at that address (404).");
});

const view = {
  federation: { rate_limits: { exchanges_per_minute: 30, joins_per_hour: 60, messages_per_minute: 300, reports_per_hour: 30, new_days: 30, new_divisor: 4, hold_after: 5, hold_minutes: 60 },
    min_age_floor_days: 0, denylists: [DEFAULT_DENYLIST], deny: ['bad.example'] },
};
test('federation PATCH: only what changed', () => {
  const f = federationForm(view);
  assert.equal(f.rate_limits.joins_per_hour, '60');
  assert.deepEqual(federationPatch(view, f), {});
  f.rate_limits.joins_per_hour = '120'; f.min_age_floor_days = '7';
  assert.deepEqual(federationPatch(view, f), { rate_limits: { joins_per_hour: 120 }, min_age_floor_days: 7 });
  const g = federationForm(view);
  g.denylists = []; g.deny = ['bad.example', '*.worse.example'];
  assert.deepEqual(federationPatch(view, g), { denylists: [], deny: ['bad.example', '*.worse.example'] });
  const h = federationForm(view);
  h.rate_limits.new_divisor = '0';
  assert.equal(federationPatch(view, h), null); // a wrong number: nothing to send
  assert.ok(readNumbers(h).bad.new_divisor);
  h.rate_limits.new_divisor = '4'; h.min_age_floor_days = '366';
  assert.match(readNumbers(h).bad.min_age_floor_days, /0 to 365/);
  h.min_age_floor_days = '1.5';
  assert.ok(readNumbers(h).bad.min_age_floor_days);
});

test('remote accounts PATCH: only the changed half', () => {
  const cur = { mode: 'allowlist', list: ['nookara.cc'] };
  assert.deepEqual(remoteAccountsPatch(cur, 'allowlist', 'nookara.cc'), {});
  assert.deepEqual(remoteAccountsPatch(cur, 'all', 'nookara.cc'), { remote_accounts: { mode: 'all' } });
  assert.deepEqual(remoteAccountsPatch(cur, 'allowlist', 'nookara.cc\n*.example.org'), { remote_accounts: { list: ['nookara.cc', '*.example.org'] } });
  assert.deepEqual(remoteAccountsPatch(undefined, 'none', ''), {});
  assert.equal(remoteAccountsPatch(cur, 'allowlist', 'not_a domain'), null);
});

test("a server's wait: never under the homeserver's floor", () => {
  assert.equal(clampDays(3, 0), 3);
  assert.equal(clampDays(3, 7), 7);
  assert.equal(clampDays(400, 0), 365);
  assert.equal(clampDays(-2, 0), 0);
  assert.equal(clampDays('', 5), 5);
  assert.equal(clampDays('abc', 2), 2);
  assert.equal(clampDays(2.7, 0), 2);
  assert.equal(clampDays(10, 500), 365);
  assert.equal(effectiveDays(3, 7), 7);
  assert.equal(effectiveDays(10, 7), 10);
  assert.equal(effectiveDays(undefined, 0), 0);
});

test('federation errors in plain words', () => {
  assert.match(adminErrorText({ error: 'invalid_rate_limits', field: 'joins_per_hour' }), /"joins an hour" limit is out of range/);
  assert.match(adminErrorText('invalid_rate_limits'), /limits for other homeservers/);
  assert.match(adminErrorText('invalid_denylists'), /https addresses, at most 20/);
  assert.match(adminErrorText('invalid_deny'), /domain, \*\.domain, an IP range or an account/);
  assert.match(adminErrorText('invalid_min_age_floor_days'), /0 to 365 days/);
  assert.match(adminErrorText('invalid_remote_accounts'), /\*\.example\.org/);
  assert.match(adminErrorText('invalid_remote_min_age_days'), /0 to 365 days/);
  assert.match(adminErrorText('owner_only'), /owner/);
});
