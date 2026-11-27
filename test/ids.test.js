import test from 'node:test';
import assert from 'node:assert/strict';
import { nsTop } from '../src/chat/ids.js';

test('an instance answer: message objects get namespaced, a list of bare message ids stays as it is', () => {
  assert.deepEqual(nsTop('http://h', { messages: ['21', '22'] }), { messages: ['21', '22'] });
  const out = nsTop('http://h', { messages: [{ id: 5, channel: 'c1', author: { username: 'a' } }] });
  assert.equal(typeof out.messages[0], 'object');
});
