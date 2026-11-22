import test from 'node:test';
import assert from 'node:assert/strict';
import { loudUnread, serverUnreadCount } from '../src/chat/unread.js';

const mutedSet = (...cids) => cid => cids.includes(cid);

test('nothing unread, or the whole server muted: no pip', () => {
  assert.equal(loudUnread({ sid: 's', unread: false }), false);
  assert.equal(loudUnread({ sid: 's', unread: true, unread_channels: ['a'] }, { serverMuted: true }), false);
});

test('loaded channels: only unread channels that are not muted count', () => {
  const channels = [{ cid: 'logs', unread: true }, { cid: 'general', unread: false }];
  assert.equal(loudUnread({ sid: 's', unread: true }, { channels, muted: mutedSet('logs') }), false);
  assert.equal(loudUnread({ sid: 's', unread: true }, { channels, muted: mutedSet() }), true);
  assert.equal(loudUnread({ sid: 's', unread: true }, { channels, unread: { 'c:general': true }, muted: mutedSet('logs') }), true);
});

test('channels not loaded: the server list of unread channels decides', () => {
  assert.equal(loudUnread({ sid: 's', unread: true, unread_channels: ['logs'] }, { muted: mutedSet('logs') }), false);
  assert.equal(loudUnread({ sid: 's', unread: true, unread_channels: ['logs', 'general'] }, { muted: mutedSet('logs') }), true);
});

test('channels not loaded: live messages in unmuted channels light it up', () => {
  const unreadN = { general: { sid: 's', n: 1 }, other: { sid: 'x', n: 4 } };
  assert.equal(loudUnread({ sid: 's', unread: true, unread_channels: [] }, { unreadN, muted: mutedSet() }), true);
  assert.equal(loudUnread({ sid: 's', unread: true, unread_channels: [] }, { unreadN, muted: mutedSet('general') }), false);
});

test("an older server that doesn't list its unread channels: unknown (the rail loads the channels)", () => {
  assert.equal(loudUnread({ sid: 's', unread: true }, { muted: mutedSet('logs') }), null);
});

test('totals: muted channels never add to the count (loaded channels)', () => {
  const channels = [{ cid: 'a', unread: true, unread_count: 5 }, { cid: 'b', unread: true, unread_count: 3 }, { cid: 'c' }];
  assert.equal(serverUnreadCount({ sid: 's', unread: true }, { channels }), 8);
  assert.equal(serverUnreadCount({ sid: 's', unread: true }, { channels, muted: mutedSet('a') }), 3);
  assert.equal(serverUnreadCount({ sid: 's', unread: true }, { channels, muted: mutedSet('a', 'b') }), 0);
  assert.equal(serverUnreadCount({ sid: 's' }, { channels, unreadN: { c: { sid: 's', n: 2 } }, muted: mutedSet('a', 'b', 'c') }), 0); // live messages in a muted channel too
  assert.equal(serverUnreadCount({ sid: 's' }, { channels, unreadN: { c: { sid: 's', n: 2 } }, muted: mutedSet('a', 'b') }), 2);
});

test('totals: a server whose channels are not loaded skips its muted unread channels', () => {
  const srv = { sid: 's', unread: true, unread_count: 9, unread_channels: ['a', 'b'] };
  assert.equal(serverUnreadCount(srv), 9);
  assert.equal(serverUnreadCount(srv, { muted: mutedSet('a', 'b') }), 0);
  assert.equal(serverUnreadCount(srv, { muted: mutedSet('a') }), 1);
  assert.equal(serverUnreadCount(srv, { unreadN: { a: { sid: 's', n: 4 }, x: { sid: 's', n: 1 } }, muted: mutedSet('a', 'b') }), 1);
  assert.equal(serverUnreadCount({ sid: 's', unread: true, unread_count: 2 }), 2); // older servers don't say which channels
  assert.equal(serverUnreadCount({ sid: 's', unread: false }), 0);
});
