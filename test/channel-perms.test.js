import test from 'node:test';
import assert from 'node:assert/strict';
import { CH, resolveBits, bitsOf } from '../src/chat/channelPermsCore.js';

const all = Object.values(CH).reduce((a, b) => a | b, 0);
test('channel overwrites resolve in Discord order', () => {
  const ows = [
    { type: 'role', id: 'everyone', everyone: true, allow: [], deny: ['send_messages', 'add_reactions'] },
    { type: 'role', id: 'r1', allow: ['send_messages'], deny: ['attach_files'] },
    { type: 'role', id: 'r2', allow: ['attach_files'], deny: [] },
    { type: 'member', id: 'v:2@nookara.cc', allow: [], deny: ['view_channel'] },
  ];
  // @everyone's deny applies
  const plain = resolveBits({ server: all, overwrites: ows, roles: [], myId: 'l:9@b.test' });
  assert.equal(plain & CH.send_messages, 0);
  assert.equal(plain & CH.add_reactions, 0);
  assert.equal(plain & CH.view_channel, CH.view_channel);
  // a role allow beats @everyone's deny, and another role's allow beats a role deny
  const r12 = resolveBits({ server: all, overwrites: ows, roles: ['r1', 'r2'], myId: 'l:9@b.test' });
  assert.equal(r12 & CH.send_messages, CH.send_messages);
  assert.equal(r12 & CH.attach_files, CH.attach_files);
  assert.equal(resolveBits({ server: all, overwrites: ows, roles: ['r1'] }) & CH.attach_files, 0);
  // the member's own overwrite comes last
  assert.equal(resolveBits({ server: all, overwrites: ows, roles: ['r1'], myId: 'v:2@nookara.cc' }) & CH.view_channel, 0);
  // numbers work as well as names; the default role's rid counts as @everyone
  assert.equal(bitsOf(['view_channel', 'send_messages']), 1025);
  assert.equal(resolveBits({ server: all, overwrites: [{ type: 'role', id: '7', allow: 0, deny: 1 }], everyoneRid: '7' }) & 1, 0);
});
