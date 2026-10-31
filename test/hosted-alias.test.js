import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedAlias } from '../src/chat/hosts.js';
import { normOrigin } from '../src/chat/ids.js';

test('e_<slug>.nookara.cc is read as e-<slug>.nookara.cc; everything else stays', () => {
  assert.equal(hostedAlias('e_dementia.nookara.cc'), 'e-dementia.nookara.cc');
  assert.equal(hostedAlias('E_Beep-Boop-Bot-Test.nookara.cc'), 'e-beep-boop-bot-test.nookara.cc');
  for (const h of ['e-dementia.nookara.cc', 'ember.nookara.cc', 'nookara.cc', 'dementia-bonfire.ikelene.net', 'chat.ikelene.net', 'e_x.nookara.cc', 'e_dementia.nookara.cc.evil.example', 'x.e_dementia.nookara.cc', 'e_-bad.nookara.cc']) {
    assert.equal(hostedAlias(h), h.toLowerCase(), h);
  }
});

test('normOrigin follows the alias (saved lists, invites, typed addresses), keeps scheme / port rules', () => {
  assert.equal(normOrigin('https://e_dementia.nookara.cc/invite/abc'), 'https://e-dementia.nookara.cc');
  assert.equal(normOrigin('e_testing.nookara.cc'), 'https://e-testing.nookara.cc');
  assert.equal(normOrigin('https://e-testing.nookara.cc'), 'https://e-testing.nookara.cc');
  assert.equal(normOrigin('https://dementia-bonfire.ikelene.net'), 'https://dementia-bonfire.ikelene.net');
  assert.equal(normOrigin('https://chat.ikelene.net'), 'https://chat.ikelene.net');
});
