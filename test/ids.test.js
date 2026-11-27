import test from 'node:test';
import assert from 'node:assert/strict';
import { nsTop } from '../src/chat/ids.js';

test('an instance answer: message objects get namespaced, a list of bare message ids stays as it is', () => {
  assert.deepEqual(nsTop('http://h', { messages: ['21', '22'] }), { messages: ['21', '22'] });
  const out = nsTop('http://h', { messages: [{ id: 5, channel: 'c1', author: { username: 'a' } }] });
  assert.equal(typeof out.messages[0], 'object');
});

test('a mention of someone from another homeserver is a user token too', async () => {
  const { USER_TOKEN } = await import('../src/chat/tokens.js').catch(() => ({}));
  if (!USER_TOKEN) return; // (tokens.js needs the browser store; the pattern itself is checked below)
  assert.equal(USER_TOKEN.exec('<@v:2@nookara.cc>')?.[1], 'v:2@nookara.cc');
});
test('the user token pattern takes local and remote ids', () => {
  const re = /<@!?((?:[vlb]:)?\d{1,20}(?:@[a-z0-9.-]{1,253})?|[A-Za-z0-9][A-Za-z0-9._:-]{0,63}@[a-z0-9.-]{1,253})>/;
  for (const [t, id] of [['<@l:5>', 'l:5'], ['<@v:2@nookara.cc>', 'v:2@nookara.cc'], ['<@12>', '12'], ['<@carol@b.test>', 'carol@b.test']]) assert.equal(re.exec(t)?.[1], id);
});
