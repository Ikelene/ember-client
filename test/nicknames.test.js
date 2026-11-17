// Server nicknames: a chat_member_update with `nick` renames that member on loaded messages of that server only
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNick } from '../src/chat/identity.js';
import { personName } from '../src/chat/displayNames.js';

const author = { id: 'v:7', kind: 'velora', username: 'carol', display_name: 'Carol' };
const state = () => ({ msgs: {
  'c:https://a.test|c1': { list: [{ id: '1', author }, { id: '2', author: { id: 'v:8', username: 'bob', display_name: 'bob' }, reply: { author } }] },
  'c:https://a.test|c9': { list: [{ id: '3', author }] }, // another server's channel
} });

test('a nickname shows on that server\'s loaded messages, replies included', () => {
  const s = applyNick(state(), { id: 'v:7', username: 'carol', display_name: 'Caz', nick: 'Caz', global_display_name: 'Carol' }, ['https://a.test|c1']);
  const l = s.msgs['c:https://a.test|c1'].list;
  assert.equal(personName(l[0].author), 'Caz');
  assert.equal(l[1].reply.author.display_name, 'Caz');
  assert.equal(l[1].author.display_name, 'bob');
  assert.equal(s.msgs['c:https://a.test|c9'].list[0].author.display_name, 'Carol');
});

test('clearing it goes back to their own name', () => {
  const s1 = applyNick(state(), { id: 'v:7', display_name: 'Caz', nick: 'Caz', global_display_name: 'Carol' }, ['https://a.test|c1']);
  const s2 = applyNick(s1, { id: 'v:7', display_name: 'Carol', nick: null }, ['https://a.test|c1']);
  assert.equal(s2.msgs['c:https://a.test|c1'].list[0].author.display_name, 'Carol');
  assert.equal(s2.msgs['c:https://a.test|c1'].list[0].author.nick, null);
});

test('no change, same state object', () => {
  const s = state();
  assert.equal(applyNick(s, { id: 'v:99', nick: 'x' }, ['https://a.test|c1']), s);
});
