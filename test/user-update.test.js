import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUserUpdate, nextPfp, instancesWithAccount } from '../src/chat/userUpdate.js';

const O = 'https://chat.example';
const OLD = 'https://v/uploads/pfp/ann_1.jpeg';
const mk = () => ({
  me: { id: '1', username: 'me', pfp: 'https://v/uploads/pfp/me_1.jpeg', color: '#111111', rank: 'free', bio: 'old' },
  people: { ann: { id: '2', username: 'ann', pfp: OLD, color: '#aa0000', rank: 'free' }, zed: { username: 'zed', pfp: 'z' } },
  friends: [{ friend_username: 'ann', pfp_url: OLD, color: '#aa0000', rank: 'free' }, { friend_username: 'zed', pfp_url: 'z' }],
  dms: [{ username: 'ann', pfp: OLD, unread: 2 }, { username: 'zed', pfp: 'z' }],
  groups: [{ room: 'grp_1', name: 'g', owner: 'ann', members: ['me', 'ann'] }],
  members: {
    s1: [{ id: '2', username: 'ann', pfp: OLD, color: '#aa0000', role: 'member' }, { id: '3', username: 'zed', pfp: 'z' }],
    [`${O}|c9`]: [{ id: 'v:2', velora_id: '2', kind: 'velora', username: 'ann', pfp: 'old' }, { id: 'u:2', username: 'ann', kind: 'local', pfp: null }],
  },
  msgs: {
    'c:5': { list: [{ id: 'a', author: { id: '2', username: 'ann', pfp: OLD }, reply: { author: { id: '2', username: 'ann', pfp: OLD } } }, { id: 'b', author: { id: '3', username: 'zed' } }] },
    'd:ann': { list: [{ id: 'm1', author: { username: 'ann', pfp: OLD } }, { id: 'm2', author: { username: 'me' } }] },
    [`c:${O}|c9`]: { list: [{ id: 'x', author: { id: 'v:2', username: 'ann' } }, { id: 'y', author: { id: 'u:2', username: 'ann' } }] },
  },
  presence: { ann: { status: 'online' } },
  typing: { 'c:5': { ann: 123 } },
  voiceStates: { c7: [{ username: 'ann', muted: false }] },
  veloraFaces: { 2: { id: '2', username: 'ann', pfp: 'old', color: null, rank: 'free' } },
  veloraNames: { 2: 'ann' },
});
const ev = (user, extra = {}) => ({ user: { id: '2', username: 'ann', ...user }, changed: ['pfp'], v: 99, ...extra });

test('a new picture updates every cache that holds that account', () => {
  const s0 = mk(), NEW = 'https://v/uploads/pfp/ann_2.jpeg';
  const s = applyUserUpdate(s0, ev({ pfp_url: NEW, color: '#00ff00' }));
  assert.equal(s.people.ann.pfp, NEW); assert.equal(s.people.ann.color, '#00ff00');
  assert.equal(s.friends[0].pfp_url, NEW); assert.equal(s.dms[0].pfp, NEW); assert.equal(s.dms[0].unread, 2);
  assert.equal(s.members.s1[0].pfp, NEW); assert.equal(s.members.s1[0].role, 'member');
  assert.equal(s.members[`${O}|c9`][0].pfp, NEW);
  assert.equal(s.msgs['c:5'].list[0].author.pfp, NEW); assert.equal(s.msgs['c:5'].list[0].reply.author.pfp, NEW);
  assert.equal(s.msgs['d:ann'].list[0].author.pfp, NEW);
  assert.equal(s.veloraFaces[2].pfp, NEW);
  // other people and the original state are untouched
  assert.equal(s.people.zed.pfp, 'z'); assert.equal(s.members.s1[1].pfp, 'z'); assert.equal(s.dms[1].pfp, 'z');
  assert.equal(s0.people.ann.pfp, OLD);
  assert.equal(s.msgs['c:5'].list[1], s0.msgs['c:5'].list[1]); // untouched messages keep identity (cheap re-render)
});

test('a local account on an instance with the same number is not touched', () => {
  const s = applyUserUpdate(mk(), ev({ pfp_url: 'https://v/new.jpeg' }));
  assert.equal(s.members[`${O}|c9`][1].pfp, null);
  assert.equal(s.msgs[`c:${O}|c9`].list[1].author.pfp, undefined);
  assert.equal(s.msgs[`c:${O}|c9`].list[0].author.pfp, 'https://v/new.jpeg');
});

test('my own account: me + my messages in a DM', () => {
  const s = applyUserUpdate(mk(), { user: { id: '1', username: 'me', pfp_url: 'https://v/uploads/pfp/me_2.jpeg', bio: 'new' }, changed: ['pfp', 'bio'], v: 5 });
  assert.equal(s.me.pfp, 'https://v/uploads/pfp/me_2.jpeg'); assert.equal(s.me.bio, 'new'); assert.equal(s.me.color, '#111111');
  assert.equal(s.msgs['d:ann'].list[1].author.pfp, 'https://v/uploads/pfp/me_2.jpeg');
});

test('rename: name-keyed caches move to the new name', () => {
  const s = applyUserUpdate(mk(), ev({ username: 'annie' }, { previous_username: 'ann', changed: ['username'] }));
  assert.equal(s.people.ann, undefined); assert.equal(s.people.annie.username, 'annie'); assert.equal(s.people.annie.pfp, OLD);
  assert.equal(s.friends[0].friend_username, 'annie'); assert.equal(s.dms[0].username, 'annie');
  assert.deepEqual(s.groups[0].members, ['me', 'annie']); assert.equal(s.groups[0].owner, 'annie');
  assert.equal(s.members.s1[0].username, 'annie'); assert.equal(s.msgs['c:5'].list[0].author.username, 'annie');
  assert.equal(s.msgs['d:ann'].list[0].author.username, 'annie');
  assert.equal(s.presence.annie.status, 'online'); assert.equal(s.presence.ann, undefined);
  assert.equal(s.typing['c:5'].annie, 123); assert.equal(s.voiceStates.c7[0].username, 'annie');
  assert.equal(s.veloraNames[2], 'annie');
});

test('same URL + pfp changed => cache-busted; colour-only change keeps the busted URL', () => {
  assert.equal(nextPfp(OLD, { pfp_url: OLD }, ['pfp'], 7), `${OLD}?v=7`);
  assert.equal(nextPfp(`${OLD}?v=7`, { pfp_url: OLD }, ['pfp'], 8), `${OLD}?v=8`);
  assert.equal(nextPfp(`${OLD}?v=8`, { pfp_url: OLD }, ['color'], 9), `${OLD}?v=8`);
  assert.equal(nextPfp(OLD, { pfp_url: OLD + '2' }, ['pfp'], 9), OLD + '2');
  assert.equal(nextPfp(OLD, { pfp_url: null }, ['pfp'], 9), null);
  assert.equal(nextPfp(OLD, {}, ['color'], 9), OLD);
});

test('limited (friends-only) updates never write restricted fields; malformed events are ignored', () => {
  const s = applyUserUpdate(mk(), { user: { id: '1', username: 'me', color: '#222222', limited: true, bio: 'leak' }, changed: ['color'], v: 1 });
  assert.equal(s.me.bio, 'old'); assert.equal(s.me.color, '#222222');
  const s0 = mk();
  assert.equal(applyUserUpdate(s0, { user: { id: 'x:1', username: 'q' } }), s0);
  assert.equal(applyUserUpdate(s0, {}), s0);
});

test('instancesWithAccount finds the instances to nudge', () => {
  assert.deepEqual(instancesWithAccount(mk(), '2'), [O]);
  assert.deepEqual(instancesWithAccount(mk(), '9'), []);
});
