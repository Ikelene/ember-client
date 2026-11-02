import test from 'node:test';
import assert from 'node:assert/strict';
import { messageCaps, myReactions } from '../src/chat/msg-actions.js';

const dm = { kind: 'dm', username: 'bob' };
const grp = { kind: 'group', room: 'grp_abc' };
const chan = { kind: 'channel', sid: 's1', cid: 'c1' };
const inDm = { id: 'im12', imId: 12, author: { username: 'bob' }, body: 'hi' };
const inGroup = { id: 'ga1b2', gid: 'a1b2', author: { username: 'bob' }, body: 'hi' };
const inChan = { id: '77', author: { username: 'bob' }, body: 'hi' };

test('a DM message: reply, react, forward, and edit + delete only when it is mine; no link', () => {
  assert.deepEqual(messageCaps(dm, inDm, { mine: false }), { reply: true, react: true, forward: true, edit: false, del: false, copyLink: false });
  assert.deepEqual(messageCaps(dm, inDm, { mine: true }), { reply: true, react: true, forward: true, edit: true, del: true, copyLink: false });
});

test('a group message: reply, forward, link, delete when mine; no reactions or edits', () => {
  assert.deepEqual(messageCaps(grp, inGroup, { mine: false }), { reply: true, react: false, forward: true, edit: false, del: false, copyLink: true });
  assert.deepEqual(messageCaps(grp, inGroup, { mine: true }), { reply: true, react: false, forward: true, edit: false, del: true, copyLink: true });
  assert.equal(messageCaps(grp, { ...inGroup, gid: null }, { mine: true }).del, false, 'old group messages have no id to delete by');
  assert.equal(messageCaps(grp, { ...inGroup, gid: null }).reply, false);
});

test('a channel message keeps what it had: Manage messages deletes others, posting decides reply', () => {
  assert.deepEqual(messageCaps(chan, inChan, { canPost: true }), { reply: true, react: true, forward: true, edit: false, del: false, copyLink: true });
  assert.equal(messageCaps(chan, inChan, { canMod: true }).del, true);
  assert.equal(messageCaps(chan, inChan, { canPost: false }).reply, false);
  assert.equal(messageCaps(chan, inChan, { mine: true }).edit, true);
});

test('Manage messages from a server never carries into a DM or group', () => {
  assert.equal(messageCaps(dm, inDm, { canMod: true }).del, false);
  assert.equal(messageCaps(grp, inGroup, { canMod: true }).del, false);
});

test('unsent, failed and system messages can not be forwarded or reacted to; Nookara notices can not be answered', () => {
  for (const x of [{ pending: true }, { failed: 'offline' }, { system: true }, { ephemeral: true }]) {
    assert.equal(messageCaps(dm, { ...inDm, ...x }).forward, false);
    assert.equal(messageCaps(dm, { ...inDm, ...x }).react, false);
  }
  const notice = messageCaps({ kind: 'dm', username: 'System' }, inDm, { mine: true });
  assert.equal(notice.reply, false);
  assert.equal(notice.del, false);
});

test('my reactions on a message (this used to throw whenever a message had any)', () => {
  const m = { reactions: [{ emoji: 'x', users: ['alice'] }, { emoji: 'y', users: ['bob'] }, { emoji: 'z' }] };
  assert.deepEqual(myReactions(m, 'alice'), ['x']);
  assert.deepEqual(myReactions({}, 'alice'), []);
});
