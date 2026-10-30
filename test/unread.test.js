import test from 'node:test';
import assert from 'node:assert/strict';
import { loudUnread } from '../src/chat/unread.js';

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
