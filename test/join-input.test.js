// the "+" dialog's Join field (src/chat/joinInput.js) and the letters of a server without an icon (src/chat/initials.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinTarget } from '../src/chat/joinInput.js';
import { initials } from '../src/chat/initials.js';

test('join: addresses, with and without a code, and their links', () => {
  assert.deepEqual(joinTarget('garden@nookara.cc'), { kind: 'address', address: { slug: 'garden', domain: 'nookara.cc', address: 'garden@nookara.cc', code: null } });
  assert.equal(joinTarget(' cabin@b.test/Ab12Cd ').address.code, 'Ab12Cd');
  assert.equal(joinTarget('https://b.test/i/cabin/Ab12Cd').address.address, 'cabin@b.test');
});
test('join: old invite links and codes', () => {
  assert.deepEqual(joinTarget('https://ember.nookara.cc/#/invite/Xy12Ab'), { kind: 'invite', code: 'Xy12Ab', inst: null });
  assert.deepEqual(joinTarget('https://chat.example.org/invite/Xy12Ab'), { kind: 'invite', code: 'Xy12Ab', inst: 'https://chat.example.org' });
  assert.deepEqual(joinTarget('Xy12Ab'), { kind: 'invite', code: 'Xy12Ab', inst: null });
  assert.deepEqual(joinTarget('#/invite/Xy12Ab'), { kind: 'invite', code: 'Xy12Ab', inst: null });
});
test('join: anything else is an instance address; nothing is nothing', () => {
  assert.deepEqual(joinTarget('chat.example.org'), { kind: 'instance', url: 'chat.example.org' });
  assert.deepEqual(joinTarget('https://chat.example.org'), { kind: 'instance', url: 'https://chat.example.org' });
  assert.deepEqual(joinTarget('localhost:4102'), { kind: 'instance', url: 'localhost:4102' });
  assert.equal(joinTarget('   '), null);
  assert.equal(joinTarget('two words'), null);
});
test('initials: letters and digits of the first two words only', () => {
  assert.equal(initials('B Test (devstack HS-B)'), 'BT');
  assert.equal(initials('Nookara Chat (devstack HS-N)'), 'NC');
  assert.equal(initials("Alice's Garden"), 'AG');
  assert.equal(initials('(beta) 2nd home'), 'B2');
  assert.equal(initials('élan vital club'), 'ÉV');
  assert.equal(initials('---'), '?');
  assert.equal(initials(''), '?');
});
