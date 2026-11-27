import test from 'node:test';
import assert from 'node:assert/strict';
import * as so from '../src/chat/social.js';

const HOME = 'https://a.example', B = 'https://b.example';
const fed = (origin, accepts = 'all') => ({ protocol_version: 2, federation: { remote_url: `${origin}/api/v2/auth/remote`, accepts_remote: accepts } });

test('which sign-in a server gets: the Nookara one, the home session, or a token from home', () => {
  // a Nookara sign-in: a v1 server and one that takes Nookara's instance token stay on the old path, a homeserver session next to it or not
  assert.equal(so.tokenSource({ legacy: true, home: HOME, origin: B, info: { accounts_mode: 'velora' } }), 'legacy');
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: { accounts_mode: 'local' } }), 'legacy');
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: { ...fed(B), protocol_version: 1 } }), 'legacy');
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: { ...fed(B), accounts_mode: 'nookara' } }), 'legacy');
  // chat.nookara.cc: its accounts are Nookara accounts, the instance token signs in there
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: { ...fed(B), accounts_mode: 'local', accounts: { nookara_identity: true } } }), 'legacy');
  assert.equal(so.takesNookara({ accounts_mode: 'local', accounts: { nookara_identity: true } }), true);
  assert.equal(so.takesNookara({ accounts_mode: 'local', accounts: { nookara_identity: 'true' } }), false);
  assert.equal(so.takesNookara({ accounts_mode: 'local' }), false);
  // any other v2 homeserver that lets other homeservers' accounts in: a token Nookara signs, traded there
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: { ...fed(B), accounts_mode: 'local' } }), 'nookara');
  assert.equal(so.tokenSource({ legacy: true, home: HOME, origin: B, info: fed(B, 'allowlist') }), 'nookara');
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: fed(B, 'none') }), 'legacy');
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: { protocol_version: 2, federation: { remote_url: 'https://evil.example/api/v2/auth/remote', accepts_remote: 'all' } } }), 'legacy');
  // ... unless I signed in there with an account of its own: that stays
  assert.equal(so.tokenSource({ legacy: true, home: null, origin: B, info: fed(B), ownLogin: true }), 'legacy');
  // no homeserver session: as before (its own login)
  assert.equal(so.tokenSource({ legacy: false, home: null, origin: B, info: fed(B) }), 'legacy');
  // a v2 session: home is home, others take a remote token when they let other homeservers in
  assert.equal(so.tokenSource({ legacy: false, home: HOME, origin: HOME, info: null }), 'home');
  assert.equal(so.tokenSource({ legacy: false, home: HOME, origin: B, info: fed(B) }), 'remote');
  assert.equal(so.tokenSource({ legacy: false, home: HOME, origin: B, info: fed(B, 'allowlist') }), 'remote');
  assert.equal(so.tokenSource({ legacy: false, home: HOME, origin: B, info: fed(B, 'none') }), 'legacy');
  assert.equal(so.tokenSource({ legacy: false, home: HOME, origin: B, info: { accounts_mode: 'local' } }), 'legacy'); // an older server
  // a remote_url somewhere else is not used: the token is for that homeserver only
  assert.equal(so.tokenSource({ legacy: false, home: HOME, origin: B, info: { federation: { remote_url: 'https://evil.example/api/v2/auth/remote', accepts_remote: 'all' } } }), 'legacy');
  assert.equal(so.remoteUrlOf(B, fed(B)), `${B}/api/v2/auth/remote`);
  assert.equal(so.remoteUrlOf(B, { federation: { remote_url: '/api/v2/auth/remote', accepts_remote: 'all' } }), `${B}/api/v2/auth/remote`);
  assert.equal(so.remoteUrlOf(B, { federation: { remote_url: 'https://u:p@b.example/x', accepts_remote: 'all' } }), null);
});

test('stored sessions are tagged with the account they are for', () => {
  const alice = { id: 'l:5', domain: 'a.example' }, bob = { id: 'l:6', domain: 'a.example' };
  assert.equal(so.sessionTag('legacy', alice), null);
  assert.equal(so.sessionTag('remote', alice), 'hs:remote:l:5@a.example');
  assert.notEqual(so.sessionTag('remote', alice), so.sessionTag('remote', bob));
  assert.notEqual(so.sessionTag('remote', alice), so.sessionTag('home', alice));
  assert.equal(so.nookaraTag('k1'), 'nk:k1');
  assert.equal(so.nookaraTag(''), null);
  assert.deepEqual(['nk:k1', 'hs:remote:l:5@a.example', 'k1', null].map(so.isTradedTag), [true, true, false, false]);
});

test('handles: username@domain, the domain hidden for people on my own homeserver', () => {
  assert.deepEqual(so.splitHandle('alice@b.example'), { name: 'alice', domain: 'b.example' });
  assert.deepEqual(so.splitHandle('@alice'), { name: 'alice', domain: '' });
  assert.deepEqual(so.splitHandle('l:5@A.Example'), { name: 'l:5', domain: 'a.example' });
  assert.equal(so.shownHandle({ handle: 'alice@b.example' }, 'a.example'), 'alice@b.example');
  assert.equal(so.shownHandle({ handle: 'alice@a.example' }, 'a.example'), 'alice');
  assert.equal(so.shownHandle({ handle: 'alice@A.example' }, 'a.example'), 'alice');
  assert.equal(so.shownHandle({ handle: null, username: 'bob', domain: 'b.example' }, 'a.example'), 'bob@b.example');
  assert.equal(so.shownHandle({ handle: null, username: 'bob@b.example' }, 'b.example'), 'bob'); // (a remote user's username is the whole handle)
  assert.equal(so.shownHandle({ handle: null, id: 'l:9@b.example' }, 'a.example'), ''); // nothing fetched yet: no handle to show
  assert.equal(so.accountName({ id: 'l:9@b.example', handle: null, display_name: '' }, 'a.example'), 'l:9@b.example');
  assert.equal(so.accountName({ id: 'l:9@b.example', handle: 'nat@b.example', display_name: 'Nat' }, 'a.example'), 'Nat');
  assert.equal(so.accountName({ id: 'l:9@b.example', handle: 'nat@b.example' }, 'b.example'), 'nat');
  assert.equal(so.stableId('l:7', 'a.example'), 'l:7@a.example');
  assert.equal(so.stableId('l:7@b.example', 'a.example'), 'l:7@b.example');
  assert.ok(so.sameAccount('l:7', 'l:7@a.example', 'a.example'));
  assert.ok(!so.sameAccount('l:7', 'l:7@b.example', 'a.example'));
  assert.ok(so.isRemoteId('l:5@a.example') && !so.isRemoteId('l:5') && !so.isRemoteId('alice'));
});

test('what can be typed to add a friend', () => {
  assert.equal(so.cleanHandle(' @alice ', 'a.example'), 'alice');
  assert.equal(so.cleanHandle('alice@B.example', 'a.example'), 'alice@b.example');
  assert.equal(so.cleanHandle('alice@a.example', 'a.example'), 'alice');
  for (const bad of ['', '@', 'a b', 'alice@', 'alice@bad domain', 'alice@-x', 'a/b@c.example']) assert.equal(so.cleanHandle(bad, 'a.example'), '', bad);
});

test('friend lists: four lists, sorted by name, junk dropped', () => {
  const l = so.friendLists({ friends: [{ id: 'l:2', handle: 'zed@a.example', display_name: 'Zed' }, null, { id: 'l:3@b.example', handle: 'amy@b.example', display_name: '' }, { handle: 'no-id' }], incoming: [{ id: 1, handle: 'x@a.example', message: 'hi' }] }, 'a.example');
  assert.deepEqual(l.friends.map(f => f.id), ['l:3@b.example', 'l:2']);
  assert.equal(l.incoming[0].id, '1');
  assert.deepEqual(l.outgoing, []);
  assert.deepEqual(l.blocked, []);
});

test('in DMs: always username@domain, my own homeserver people too', () => {
  assert.equal(so.dmHandle({ handle: 'alice@a.example' }, 'a.example'), 'alice@a.example');
  assert.equal(so.dmHandle({ handle: 'alice@B.example' }, 'a.example'), 'alice@b.example');
  assert.equal(so.dmHandle({ handle: null, username: 'bob', domain: 'b.example' }), 'bob@b.example');
  assert.equal(so.dmHandle('alice', 'nookara.cc'), 'alice@nookara.cc'); // (a Nookara name: on Nookara's domain)
  assert.equal(so.dmHandle('@alice@b.example', 'nookara.cc'), 'alice@b.example');
  assert.equal(so.dmHandle('alice'), 'alice'); // no domain known: the name alone
  assert.equal(so.dmHandle({ handle: null, id: 'l:9@b.example' }, 'a.example'), '');
  assert.equal(so.dmHandle(null, 'a.example'), '');
  assert.equal(so.dmTitle({ others: [{ id: 'l:6@a.example', handle: 'bob@a.example', display_name: '' }] }, 'a.example'), 'bob@a.example');
});

const ctx = { home: HOME, me: 'l:5', domain: 'a.example' };
const member = (id, name) => ({ id, handle: `${name}@${id.split('@')[1]}`, display_name: name, avatar_url: null });
const ME = member('l:5@a.example', 'alice');
const hosted = (id, t, extra = {}) => ({ id: `${id}@a.example`, host: 'a.example', host_origin: HOME, hosted_here: true, group: false, name: null, owner: null, sid: id, channel: `c${id}`, members: [ME, member('l:6@a.example', 'bob')], created_at: 1, updated_at: t, last_message_id: '4', unread: 0, mention: false, ...extra });
const pointer = (id, t, extra = {}) => ({ id: `${id}@b.example`, host: 'b.example', host_origin: B, hosted_here: false, group: false, name: null, owner: null, sid: id, channel: `c${id}`, members: [ME, member('l:2@b.example', 'carol')], created_at: 1, updated_at: t, last_message_id: '9', unread: 2, mention: true, ...extra });

test('the DM list: hosted here and pointers together, newest activity first, unread counted', () => {
  const list = so.mergeDms([{ origin: HOME, dms: [hosted('d1', 100), pointer('d2', 300), hosted('d3', 200, { group: true, name: 'Camp', unread: 5 }), { nope: 1 }, null] }], ctx);
  assert.deepEqual(list.map(d => d.id), ['d2@b.example', 'd3@a.example', 'd1@a.example']);
  assert.deepEqual(list.map(d => d.hosted_here), [false, true, true]);
  assert.equal(list[0].host_origin, B);
  assert.deepEqual(list[0].others.map(m => m.id), ['l:2@b.example']); // (me left out, by my id with or without the domain)
  assert.equal(so.dmTitle(list[0], 'a.example'), 'carol');
  assert.equal(so.dmTitle(list[1], 'a.example'), 'Camp');
  assert.equal(so.dmUnread(list), 7);
  assert.equal(so.dmMentions(list), 1);
  // the same activity time: a steady order
  const tie = so.mergeDms([{ origin: HOME, dms: [hosted('db', 5), hosted('da', 5)] }], ctx);
  assert.deepEqual(tie.map(d => d.id), ['da@a.example', 'db@a.example']);
});

test('the DM list: a host fills in what the pointer lacks, home keeps the unread count', () => {
  // what the host says about itself ("hosted_here", from where it stands) is not "hosted on my homeserver"
  const fromHost = { ...pointer('d2', 400), hosted_here: true, host_origin: undefined, unread: 0, mention: false, name: 'Renamed', group: true };
  const list = so.mergeDms([{ origin: B, dms: [fromHost, { ...pointer('d9', 50), hosted_here: true, unread: 1 }] }, { origin: HOME, dms: [pointer('d2', 300, { sid: null, channel: null })] }], ctx);
  const d2 = list.find(d => d.id === 'd2@b.example');
  assert.equal(d2.hosted_here, false);
  assert.equal(d2.host_origin, B);
  assert.equal(d2.unread, 2);
  assert.equal(d2.mention, true);
  assert.equal(d2.sid, 'd2');
  assert.equal(d2.channel, 'cd2');
  assert.equal(d2.updated_at, 400);
  const d9 = list.find(d => d.id === 'd9@b.example'); // a DM home has no pointer for (yet) still shows
  assert.equal(d9.hosted_here, false);
  assert.equal(d9.unread, 1);
  assert.deepEqual(list.map(d => d.id), ['d2@b.example', 'd9@b.example']);
});

test('gateway: social_dm_update adds, changes and re-sorts', () => {
  let s = { ...so.emptySocial(), dms: so.mergeDms([{ origin: HOME, dms: [hosted('d1', 100), pointer('d2', 300)] }], ctx) };
  s = so.socialReduce(s, { type: 'social_dm_update', dm: hosted('d1', 500, { name: 'x', unread: 1 }) }, { ...ctx, from: HOME });
  assert.deepEqual(s.dms.map(d => d.id), ['d1@a.example', 'd2@b.example']);
  assert.equal(s.dms[0].unread, 1);
  s = so.socialReduce(s, { type: 'social_dm_update', dm: hosted('d7', 600) }, { ...ctx, from: HOME });
  assert.equal(s.dms[0].id, 'd7@a.example');
  // the host of a DM I only point at says it changed: the name follows, my unread count stays the pointer's
  s = so.socialReduce(s, { type: 'social_dm_update', dm: { ...pointer('d2', 700), hosted_here: true, unread: 0, mention: false, name: 'New name' } }, { ...ctx, from: B });
  assert.equal(s.dms[0].id, 'd2@b.example');
  assert.equal(s.dms[0].name, 'New name');
  assert.equal(s.dms[0].unread, 2);
  assert.equal(s.dms[0].hosted_here, false);
  // the one on screen never shows unread
  s = so.socialReduce(s, { type: 'social_dm_update', dm: hosted('d1', 800, { unread: 3, mention: true }) }, { ...ctx, from: HOME, open: 'd1@a.example' });
  assert.equal(s.dms[0].unread, 0);
  assert.equal(s.dms[0].mention, false);
  const same = so.socialReduce(s, { type: 'social_dm_update', dm: null }, ctx);
  assert.equal(same, s);
});

test('gateway: social_dm_remove, social_dm_activity, social_presence', () => {
  let s = { ...so.emptySocial(), dms: so.mergeDms([{ origin: HOME, dms: [hosted('d1', 100), pointer('d2', 300, { unread: 0, mention: false })] }], ctx) };
  // activity with only the id: one more unread (or `count`), to the top
  s = so.socialReduce(s, { type: 'social_dm_activity', dm: 'd1@a.example', mention: false, preview: 'note: hi', sender: { id: 'l:6@a.example', display_name: 'bob' } }, { ...ctx, now: 900 });
  assert.equal(s.dms[0].id, 'd1@a.example');
  assert.equal(s.dms[0].unread, 1);
  assert.equal(s.dms[0].preview, 'note: hi');
  assert.equal(s.dms[0].sender.display_name, 'bob');
  s = so.socialReduce(s, { type: 'social_dm_activity', dm: 'd1@a.example', count: 3, mention: true, last_message_id: 12 }, { ...ctx, now: 901 });
  assert.equal(s.dms[0].unread, 4);
  assert.equal(s.dms[0].mention, true);
  assert.equal(s.dms[0].last_message_id, '12');
  // activity carrying the DM: its own count is the count
  s = so.socialReduce(s, { type: 'social_dm_activity', dm: pointer('d2', 950, { unread: 6, mention: false }), mention: false }, { ...ctx, now: 950 });
  assert.equal(s.dms[0].id, 'd2@b.example');
  assert.equal(s.dms[0].unread, 6);
  // on screen: read as it arrives
  s = so.socialReduce(s, { type: 'social_dm_activity', dm: 'd2@b.example', mention: true }, { ...ctx, now: 960, open: 'd2@b.example' });
  assert.equal(s.dms[0].unread, 0);
  assert.equal(s.dms[0].mention, false);
  // one we have never heard of, and the frame did not bring it: nothing to show
  assert.equal(so.socialReduce(s, { type: 'social_dm_activity', dm: 'zz@b.example' }, ctx), s);
  s = so.socialReduce(s, { type: 'social_dm_remove', id: 'd1@a.example' }, ctx);
  assert.deepEqual(s.dms.map(d => d.id), ['d2@b.example']);
  assert.equal(so.socialReduce(s, { type: 'social_dm_remove', id: 'gone' }, ctx), s);
  s = so.socialReduce(s, { type: 'social_presence', id: 'l:6', status: 'idle' }, ctx);
  assert.equal(s.presence['l:6@a.example'], 'idle');
  s = so.socialReduce(s, { type: 'social_presence', id: 'l:2@b.example', status: 'weird' }, ctx);
  assert.equal(s.presence['l:2@b.example'], 'offline');
  assert.equal(so.socialRefetch({ type: 'social_friends_update' }), 'friends');
  assert.equal(so.socialRefetch({ type: 'social_presence' }), null);
  for (const t of ['social_friends_update', 'social_presence', 'social_dm_update', 'social_dm_remove', 'social_dm_activity']) assert.ok(so.SOCIAL_EVENTS.has(t));
});

test('push: a pusher for every homeserver that takes them, and the relay push off only where one is in', () => {
  const push = o => ({ push: { pushers_url: `${o}/api/v2/pushers` } });
  const instances = [
    { origin: HOME, info: push(HOME), signedIn: true, relayPush: false },
    { origin: B, info: push(B), signedIn: true, relayPush: true },
    { origin: 'https://c.example', info: {}, signedIn: true, relayPush: true }, // an older server: the relay stays its only way
    { origin: 'https://d.example', info: push('https://d.example'), signedIn: false, relayPush: true }, // not signed in there
    { origin: 'https://e.example', info: { push: { pushers_url: 'https://elsewhere.example/api/v2/pushers' } }, signedIn: true, relayPush: true },
  ];
  assert.deepEqual(so.pushPlan({ v2: false, pushkey: 'epk_x', instances }), { register: [], relayOff: [] }); // the Nookara sign-in: as before
  assert.deepEqual(so.pushPlan({ v2: true, pushkey: null, instances }), { register: [], relayOff: [] }); // no device key yet
  const plan = so.pushPlan({ v2: true, pushkey: 'epk_x', instances });
  assert.deepEqual(plan.register, [{ origin: HOME, url: `${HOME}/api/v2/pushers` }, { origin: B, url: `${B}/api/v2/pushers` }]);
  assert.deepEqual(plan.relayOff, []); // nothing registered yet: nothing is switched off
  assert.deepEqual(so.pushPlan({ v2: true, pushkey: 'epk_x', instances, registered: [HOME, B, 'https://c.example'] }).relayOff, [B]);
  assert.deepEqual(so.pushPlan({ v2: true, pushkey: 'epk_x', instances, registered: [HOME] }).relayOff, []); // (b's failed: its relay push stays)
});

// ── a Nookara session: Nookara's own friends and DMs stay in its UI, /api/v2/social adds the ones elsewhere ──
const NK = 'https://nookara.cc', CHAT = 'https://chat.nookara.cc';
const nkMe = { id: 'v:5@nookara.cc', handle: 'alice@nookara.cc', display_name: 'alice', avatar_url: null };
const nkIm = (them, id, t, unread = 0) => ({ id: `im:5-${id}@nookara.cc`, host: 'nookara.cc', host_origin: NK, hosted_here: true, sid: null, channel: null, group: false, name: null, owner: null, nookara: { kind: 'im', username: them }, members: [nkMe, { id: `v:${id}@nookara.cc`, handle: `${them}@nookara.cc`, display_name: them }], created_at: 1, updated_at: t, last_message_id: '9', unread, mention: false });
const nkGroup = (room, t) => ({ id: `g:${room.replace(/^grp_/, '')}@nookara.cc`, host: 'nookara.cc', host_origin: NK, hosted_here: true, sid: null, channel: null, group: true, name: 'The squad', owner: 'v:5@nookara.cc', nookara: { kind: 'group', room }, members: [nkMe], created_at: t, updated_at: t, last_message_id: '0', unread: 0, mention: false });
const nkPointer = (id, host, origin, t, extra = {}) => ({ id: `${id}@${host}`, host, host_origin: origin, hosted_here: false, group: false, name: null, owner: null, sid: id, channel: `c${id}`, members: [nkMe, { id: `l:2@${host}`, handle: `carol@${host}`, display_name: 'Carol' }], created_at: 1, updated_at: t, last_message_id: '3', unread: 1, mention: false, ...extra });

test('a Nookara session: friends who are not Nookara accounts come from the social API, the rest stay in the lists Nookara has', () => {
  assert.equal(so.isNookaraAccount('v:5@nookara.cc', 'nookara.cc'), true);
  assert.equal(so.isNookaraAccount('v:5', 'nookara.cc'), true);
  assert.equal(so.isNookaraAccount('v:5@other.example', 'nookara.cc'), false);
  assert.equal(so.isNookaraAccount('l:5@nookara.cc', 'nookara.cc'), false); // one of nookara.cc's homeserver's own accounts: elsewhere, to Nookara
  assert.equal(so.isNookaraAccount('v:05@nookara.cc', 'nookara.cc'), false);
  assert.equal(so.isNookaraAccount(null, 'nookara.cc'), false);
  const l = so.remoteFriendLists({
    friends: [{ id: 'v:6@nookara.cc', handle: 'bob@nookara.cc', display_name: 'bob' }, { id: 'l:2@b.example', handle: 'carol@b.example', display_name: 'Carol' }, { id: 'l:9@nookara.cc', handle: 'dan@nookara.cc', display_name: 'Dan' }],
    incoming: [{ id: 'v:7@nookara.cc', handle: 'eve@nookara.cc' }, { id: 'l:4@c.example', handle: 'fay@c.example', message: 'hi' }],
    outgoing: [{ id: 'v:8@nookara.cc', handle: 'gus@nookara.cc' }],
    blocked: [{ id: 'v:9@nookara.cc', handle: 'hal@nookara.cc' }, { id: 'l:1@d.example', handle: 'ian@d.example' }],
  }, 'nookara.cc');
  assert.deepEqual(l.friends.map(f => f.id), ['l:2@b.example', 'l:9@nookara.cc']);
  assert.deepEqual(l.incoming.map(f => [f.id, f.message]), [['l:4@c.example', 'hi']]);
  assert.deepEqual(l.outgoing, []);
  assert.deepEqual(l.blocked.map(f => f.id), ['l:1@d.example']);
  // names: my own domain is left out, theirs is shown
  assert.equal(so.shownHandle(l.friends[0], 'nookara.cc'), 'carol@b.example');
  assert.equal(so.shownHandle(l.friends[1], 'nookara.cc'), 'dan');
  assert.equal(so.cleanHandle('alice@other.example', 'nookara.cc'), 'alice@other.example');
  assert.equal(so.cleanHandle('bob@nookara.cc', 'nookara.cc'), 'bob'); // (a Nookara name: the friend request Nookara always had)
});

test('a Nookara session: the DM list keeps the DMs Nookara has where they are and takes the pointers', () => {
  const answer = { dms: [nkPointer('7', 'b.example', B, 900), nkIm('bob', 6, 800, 2), nkPointer('3', 'nookara.cc', CHAT, 700, { group: true, name: 'Mixed' }), nkGroup('grp_ab12', 600), { id: 'odd@nookara.cc', hosted_here: true }, null, { hosted_here: false }] };
  const { pointers, hosted } = so.splitNookaraDms(answer);
  assert.deepEqual(pointers.map(d => d.id), ['7@b.example', '3@nookara.cc']);
  assert.deepEqual(hosted, [{ id: 'im:5-6@nookara.cc', view: { kind: 'dm', username: 'bob' } }, { id: 'g:ab12@nookara.cc', view: { kind: 'group', room: 'grp_ab12' } }]);
  // where each opens: the DM / group view Nookara has (end-to-end encrypted, as ever), or the homeserver the pointer names
  assert.deepEqual(so.nookaraDmView(answer.dms[1]), { kind: 'dm', username: 'bob' });
  assert.deepEqual(so.nookaraDmView(answer.dms[3]), { kind: 'group', room: 'grp_ab12' });
  assert.deepEqual(so.nookaraDmView(answer.dms[0]), { kind: 'sdm', id: '7@b.example' });
  assert.equal(so.nookaraDmView(answer.dms[4]), null);
  assert.equal(so.nookaraDmView({ id: 'x@nookara.cc', hosted_here: true, nookara: { kind: 'im' } }), null);
  // the pointers as the list keeps them: on the homeserver that hosts them, never "hosted here" (chat.nookara.cc is not Nookara)
  const list = so.mergeDms([{ origin: NK, dms: pointers }], { home: NK, me: 'v:5@nookara.cc', domain: 'nookara.cc' });
  assert.deepEqual(list.map(d => [d.id, d.host_origin, d.hosted_here, d.unread]), [['7@b.example', B, false, 1], ['3@nookara.cc', CHAT, false, 1]]);
  assert.deepEqual(list[0].others.map(m => m.id), ['l:2@b.example']);
  assert.equal(so.dmTitle(list[0], 'nookara.cc'), 'Carol');
  assert.equal(so.dmTitle(list[1], 'nookara.cc'), 'Mixed');
});

test('a Nookara session: one DM list, the conversations Nookara has and the pointers by activity', () => {
  const conv = (username, sent_at, unread = 0) => ({ username, unread, last_message: { id: 1, sent_at } });
  const convs = [conv('bob', '2026-11-20T12:00:00.000Z', 2), conv('System', '2026-11-10T12:00:00.000Z'), conv('zed', '2026-11-01T12:00:00.000Z')];
  const at = iso => Date.parse(iso);
  const ctx2 = { home: NK, me: 'v:5@nookara.cc', domain: 'nookara.cc' };
  const pointers = so.mergeDms([{ origin: NK, dms: [nkPointer('3', 'nookara.cc', CHAT, at('2026-11-05T00:00:00Z')), nkPointer('7', 'b.example', B, at('2026-11-15T00:00:00Z')), nkPointer('8', 'c.example', 'https://c.example', at('2026-11-25T00:00:00Z'))] }], ctx2);
  const rows = so.nookaraDmRows(convs, pointers);
  assert.deepEqual(rows.map(r => (r.kind === 'dm' ? r.c.username : r.dm.id)), ['8@c.example', 'bob', '7@b.example', 'System', '3@nookara.cc', 'zed']);
  assert.deepEqual(rows.map(r => r.kind), ['sdm', 'dm', 'sdm', 'dm', 'sdm', 'dm']);
  // nothing on other homeservers: the list exactly as it was
  assert.deepEqual(so.nookaraDmRows(convs, []).map(r => r.c), convs);
  assert.deepEqual(so.nookaraDmRows([], pointers).map(r => r.dm.id), ['8@c.example', '7@b.example', '3@nookara.cc']);
  // the order Nookara gave is never changed (a conversation with no time stays where it was put)
  assert.deepEqual(so.nookaraDmRows([conv('a', '2026-11-20T12:00:00Z'), { username: 'b', unread: 0 }, conv('c', '2026-11-19T12:00:00Z')], []).map(r => r.c.username), ['a', 'b', 'c']);
  // new activity on a pointer (social_dm_activity over the Nookara socket) moves it to the top and counts it
  const s = so.socialReduce({ ...so.emptySocial(), dms: pointers }, { type: 'social_dm_activity', dm: nkPointer('3', 'nookara.cc', CHAT, at('2026-11-26T00:00:00Z'), { unread: 4 }), preview: 'hello' }, { ...ctx2, from: NK, now: at('2026-11-26T00:00:01Z') });
  assert.equal(so.nookaraDmRows(convs, s.dms)[0].dm.id, '3@nookara.cc');
  assert.equal(s.dms[0].unread, 4);
  assert.equal(s.dms[0].preview, 'hello');
  assert.equal(so.dmUnread(s.dms), 6);
});
