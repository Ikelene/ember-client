import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, addressHash, slugIssue, validSlug, slugFrom, createErrorText, railEntries, railOrigin, railPos, isV2, communityOf, inviteBase, inviteUrl, parseInviteUrl, parseProtocolLink, openRouteLink, serverOfInst, routeAddress, addressRoute } from '../src/chat/addresses.js';
import { addressInviteRef, setInviteHomes, isHiddenInviteLine, embedLabel } from '../src/chat/inviteLink.js';

test('addresses: slug@domain, with and without a code', () => {
  assert.deepEqual(parseAddress('cool@nookara.cc'), { slug: 'cool', domain: 'nookara.cc', address: 'cool@nookara.cc', code: null });
  assert.deepEqual(parseAddress('  Cool-Place@Chat.Example.org/aB3xYz  '), { slug: 'cool-place', domain: 'chat.example.org', address: 'cool-place@chat.example.org', code: 'aB3xYz' });
  assert.equal(parseAddress('cool@nookara.cc/').code, null);
  assert.equal(parseAddress('cool@example.org:8443/abc').domain, 'example.org:8443');
});
test('addresses: the homeserver invite link and the #/ route', () => {
  const want = { slug: 'cool', domain: 'nookara.cc', address: 'cool@nookara.cc', code: 'abc123' };
  assert.deepEqual(parseAddress('https://nookara.cc/i/cool/abc123'), want);
  assert.deepEqual(parseAddress('https://nookara.cc/i/cool/abc123/'), want);
  assert.deepEqual(parseAddress('#/i/cool@nookara.cc/abc123'), want);
  assert.deepEqual(parseAddress('https://ember.nookara.cc/#/i/cool@nookara.cc/abc123'), want);
  assert.deepEqual(parseAddress('#/i/cool%40nookara.cc/abc123'), want);
  assert.equal(parseAddress('#/i/cool@nookara.cc').code, null);
  assert.equal(addressHash(want), '#/i/cool@nookara.cc/abc123');
  assert.equal(addressHash({ slug: 'cool', domain: 'nookara.cc' }), '#/i/cool@nookara.cc');
  assert.deepEqual(parseAddress(addressHash(want)), want);
});
test('addresses: everything else is not one', () => {
  for (const bad of ['', '   ', 'chat.example.com', 'https://chat.example.com', 'abc123', 'https://chat.example.com/invite/abc123',
    '#/invite/abc123', '#/i/https%3A%2F%2Fchat.example.com/invite/abc123', 'https://ember.nookara.cc/#/i/https%3A%2F%2Fchat.example.com/invite/abc',
    'http://nookara.cc/i/cool/abc', 'https://nookara.cc/i/cool', 'https://nookara.cc/i/cool/abc/extra', 'https://nookara.cc/i/cool/abc?x=1', 'https://u:p@nookara.cc/i/cool/abc',
    'co@nookara.cc', '-cool@nookara.cc', 'cool-@nookara.cc', 'co--ol@nookara.cc', 'co_ol@nookara.cc', 'cool@localhost', 'cool@', '@nookara.cc', 'a@b@nookara.cc',
    'cool@nookara.cc/bad code', 'cool@nookara.cc/a/b', 'cool@nookara.cc/a$b', 'cool @nookara.cc', 'cool@noo kara.cc', 'https://nookara.cc/i/co/abc'])
    assert.equal(parseAddress(bad), null, bad);
  assert.equal(parseAddress(null), null);
});
test('slugs: 3-32 of a-z 0-9 and dashes, none at the ends, no two in a row', () => {
  for (const ok of ['abc', 'a-b', 'cool-place-2', 'a1b2c3', 'x'.repeat(32)]) assert.equal(slugIssue(ok), null, ok);
  for (const bad of ['', 'ab', 'x'.repeat(33), 'Abc', 'a_b', 'a b', 'ab.c', '-abc', 'abc-', 'a--b', 'café']) { assert.equal(typeof slugIssue(bad), 'string', bad); assert.equal(validSlug(bad), false); }
  assert.match(slugIssue('ab'), /3/);
  assert.match(slugIssue('x'.repeat(33)), /32/);
  assert.equal(slugFrom('My Cool Server!'), 'my-cool-server');
  assert.equal(slugFrom('  --A  b--  '), 'a-b');
  assert.equal(slugFrom('!!'), '');
  assert.equal(validSlug(slugFrom('x'.repeat(31) + ' y')), true);
});
test('create errors in plain words', () => {
  assert.equal(createErrorText({ error: 'creation_requires_approval' }), 'This homeserver only lets admins create servers.');
  assert.equal(createErrorText(Object.assign(new Error('creation_limit'), { limit: 3, used: 3 })), "You've reached this homeserver's limit of 3 servers.");
  assert.equal(createErrorText({ error: 'creation_limit', limit: 1 }), "You've reached this homeserver's limit of 1 server.");
  assert.match(createErrorText({ error: 'creation_limit' }), /limit of servers/);
  assert.match(createErrorText('slug_taken'), /already taken/);
  assert.match(createErrorText(new Error('invalid_slug')), /3-32/);
  assert.match(createErrorText('forbidden'), /not allowed/);
  assert.match(createErrorText('server_not_found'), /no server/);
  assert.match(createErrorText('wrong_homeserver'), /isn't on this homeserver/);
  assert.match(createErrorText('something_new'), /didn't work/);
  assert.match(createErrorText(null), /didn't work/);
});

const A = 'https://a.example', B = 'https://b.example';
const srv = (origin, id) => ({ sid: `${origin}|${id}`, inst: origin, name: id });
test('rail: an instance with one server keeps the id it always had', () => {
  const one = railEntries([{ origin: A }, { origin: B, v2: true }], [srv(A, 's1'), srv(B, 's9')]);
  assert.deepEqual(one.map(e => e.id), [`i:${A}`, `i:${B}`]);
  assert.equal(one[0].server.sid, `${A}|s1`);
  assert.equal(one[1].server.sid, `${B}|s9`);
  // not joined yet: still one entry, no server
  assert.deepEqual(railEntries([{ origin: A, v2: true }], []), [{ id: `i:${A}`, inst: { origin: A, v2: true }, server: null }]);
  // an older instance never splits, whatever it lists
  assert.deepEqual(railEntries([{ origin: A }], [srv(A, 's1'), srv(A, 's2')]).map(e => e.id), [`i:${A}`]);
});
test('rail: a homeserver I am in several servers on gets one entry each, keyed origin|sid', () => {
  const many = railEntries([{ origin: A, v2: true }, { origin: B }], [srv(A, 's1'), srv(B, 'x'), srv(A, 's2')]);
  assert.deepEqual(many.map(e => e.id), [`i:${A}|s1`, `i:${A}|s2`, `i:${B}`]);
  assert.deepEqual(many.map(e => e.server.sid), [`${A}|s1`, `${A}|s2`, `${B}|x`]);
  assert.equal(railOrigin(`i:${A}|s1`), A);
  assert.equal(railOrigin(`i:${A}`), A);
  assert.equal(railOrigin('v:123'), null);
});
test('rail: saved order carries over between one and many', () => {
  const order = ['v:1', `i:${A}`, 'v:2', `i:${B}`];
  assert.equal(railPos(order, `i:${A}`), 1);
  assert.equal(railPos(order, `i:${A}|s2`), 1); // a second server lands where the first is
  assert.equal(railPos(order, 'v:2'), 2);
  assert.equal(railPos(order, 'v:9'), -1);
  assert.equal(railPos(['v:1', `i:${A}|s2`, `i:${A}|s1`], `i:${A}`), 1); // back to one server: where they were
  assert.equal(railPos(['v:1', `i:${A}|s2`, `i:${A}|s1`], `i:${A}|s1`), 2);
  assert.equal(railPos(null, `i:${A}`), -1);
});
test('discovery docs: v2 and the listed servers', () => {
  assert.equal(isV2({ protocol: 1, protocol_version: 2 }), true);
  assert.equal(isV2({ protocol: 1 }), false);
  assert.equal(isV2(null), false);
  const info = { community: { sid: 'a', name: 'A' }, communities: [{ sid: 'a', name: 'A' }, { sid: 'b', name: 'B' }] };
  assert.equal(communityOf(info).name, 'A');
  assert.equal(communityOf(info, 'b').name, 'B');
  assert.equal(communityOf(info, 'zz'), null);
  assert.equal(communityOf({ community: { sid: 'a' } }, 'a').sid, 'a');
});

test('the rail: a homeserver only there for my account or a DM has no entry until I am in a server on it', () => {
  const home = { origin: 'https://a.example', v2: true, quiet: true }, other = { origin: 'https://b.example', v2: true };
  assert.deepEqual(railEntries([home, other], []).map(e => e.id), ['i:https://b.example']);
  const mine = [{ sid: 'https://a.example|s1', inst: 'https://a.example' }];
  assert.deepEqual(railEntries([home, other], mine).map(e => e.id), ['i:https://a.example', 'i:https://b.example']);
});

test("invite links: built from the homeserver's url_base, else https://<domain>/i/", () => {
  const a = { slug: 'cabin', domain: 'b.test', code: 'Ab12' };
  assert.equal(inviteUrl(a), 'https://b.test/i/cabin/Ab12');
  assert.equal(inviteUrl(a, {}), 'https://b.test/i/cabin/Ab12');
  assert.equal(inviteUrl(a, { url_base: 'http://localhost:4102/i/' }), 'http://localhost:4102/i/cabin/Ab12');
  assert.equal(inviteUrl(a, { url_base: 'https://join.example/x/i' }), 'https://join.example/x/i/cabin/Ab12');
  assert.equal(inviteBase('b.test', { url_base: 'javascript:alert(1)' }), 'https://b.test/i/');
  assert.equal(inviteBase('b.test', { url_base: 'https://x.example/i/?a=1' }), 'https://b.test/i/');
  assert.equal(inviteBase('b.test', { url_base: 42 }), 'https://b.test/i/');
});
test('invite links: any host, resolved through its discovery doc', () => {
  assert.deepEqual(parseInviteUrl('http://localhost:4102/i/cabin/abc'), { slug: 'cabin', code: 'abc', origin: 'http://localhost:4102' });
  assert.deepEqual(parseInviteUrl('https://join.example/x/i/Cabin/abc/'), { slug: 'cabin', code: 'abc', origin: 'https://join.example' });
  assert.equal(parseInviteUrl('http://localhost:4102/i/cabin'), null);
  assert.equal(parseInviteUrl('http://localhost:4102/i/cabin/abc?x=1'), null);
  assert.equal(parseInviteUrl('ftp://localhost/i/cabin/abc'), null);
  assert.equal(parseInviteUrl('https://x.example/i/-bad/abc'), null);
  assert.equal(parseAddress('http://localhost:4102/i/cabin/abc'), null); // (not a domain: it goes through parseInviteUrl)
});
test("invite links: web+ember: links from the browser's protocol handler", () => {
  const want = { slug: 'cabin', domain: 'b.test', address: 'cabin@b.test', code: 'X1' };
  assert.deepEqual(parseProtocolLink('web+ember:invite?address=cabin@b.test&code=X1'), want);
  assert.deepEqual(parseProtocolLink('web+ember:invite?address=cabin%40b.test&code=X1'), want);
  assert.deepEqual(parseProtocolLink('web+ember://invite/?address=cabin@b.test&code=X1'), want);
  assert.equal(parseProtocolLink('web+ember:invite?address=cabin@b.test').code, null);
  assert.equal(parseProtocolLink('web+ember:invite?address=nope'), null);
  assert.equal(parseProtocolLink('web+ember:dm?address=cabin@b.test'), null);
  assert.equal(parseProtocolLink('https://b.test/i/cabin/X1'), null);
  const hash = `#/open?u=${encodeURIComponent('web+ember:invite?address=cabin@b.test&code=X1')}`;
  assert.deepEqual(parseProtocolLink(openRouteLink(hash)), want);
  assert.equal(openRouteLink('#/home'), null);
});
test('invite links: cards in messages, hidden only for homeservers this device uses', () => {
  setInviteHomes([]);
  assert.deepEqual(addressInviteRef('https://b.test/i/cabin/Ab12'), { slug: 'cabin', domain: 'b.test', address: 'cabin@b.test', code: 'Ab12', sure: false });
  assert.equal(addressInviteRef('https://ember.nookara.cc/#/i/cabin@b.test/Ab12').sure, true);
  assert.equal(addressInviteRef('http://localhost:4102/i/cabin/Ab12'), null);
  assert.equal(addressInviteRef('https://b.test/i/cabin'), null); // (no code: not an invite)
  assert.equal(isHiddenInviteLine('https://b.test/i/cabin/Ab12'), false);
  setInviteHomes([{ domain: 'b.test', bases: ['http://localhost:4102/i/'] }]);
  assert.equal(addressInviteRef('https://b.test/i/cabin/Ab12').sure, true);
  assert.deepEqual(addressInviteRef('http://localhost:4102/i/cabin/Ab12'), { slug: 'cabin', code: 'Ab12', origin: 'http://localhost:4102', sure: true });
  assert.equal(isHiddenInviteLine('http://localhost:4102/i/cabin/Ab12'), true);
  assert.equal(embedLabel('https://b.test/i/cabin/Ab12'), 'Server Invite');
  setInviteHomes([]);
});

test('the server a lookup on a homeserver with several means: on screen, else its default, else the first', () => {
  const H = 'http://hs', servers = [{ sid: 'http://other|x', inst: 'http://other' }, { sid: `${H}|a`, inst: H }, { sid: `${H}|b`, inst: H }];
  assert.equal(serverOfInst(servers, H, { viewSid: `${H}|b`, communitySid: 'a' }).sid, `${H}|b`);
  assert.equal(serverOfInst(servers, H, { viewSid: 'http://other|x', communitySid: 'b' }).sid, `${H}|b`);
  assert.equal(serverOfInst(servers, H).sid, `${H}|a`);
  assert.equal(serverOfInst(servers, 'http://none'), null);
});

test('server routes by address: #/s/<slug@domain>/<channel>/<message>', () => {
  assert.equal(routeAddress('garden@nookara.cc'), 'garden@nookara.cc');
  assert.equal(routeAddress('Garden%40Nookara.cc'), 'garden@nookara.cc');
  assert.equal(routeAddress('s02f9921428'), null); // (a Nookara-hosted server's id)
  assert.equal(routeAddress('garden@nookara.cc/abc'), null);
  assert.equal(routeAddress('%E0%A4%A'), null);
  assert.equal(addressRoute('garden@nookara.cc', 'c1', '42'), '#/s/garden@nookara.cc/c1/42');
  assert.equal(addressRoute('garden@nookara.cc'), '#/s/garden@nookara.cc');
  assert.equal(addressRoute('garden@nookara.cc', null, '42'), '#/s/garden@nookara.cc');
});
