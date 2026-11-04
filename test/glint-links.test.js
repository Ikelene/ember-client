import test from 'node:test';
import assert from 'node:assert/strict';
import { glintRef } from '../src/chat/inviteLink.js';

test('clip links on the new host and the old one make a card', () => {
  assert.deepEqual(glintRef('https://clips.nookara.cc/c/AbCdE12345'), { id: 'AbCdE12345', sure: true });
  assert.deepEqual(glintRef('https://ikelene.net/glint/c/AbCdE12345'), { id: 'AbCdE12345', sure: true });
  assert.deepEqual(glintRef('https://www.ikelene.net/glint/c/AbCdE12345/'), { id: 'AbCdE12345', sure: true });
});
test('anything else does not', () => {
  for (const u of ['https://clips.nookara.cc/glint/c/AbCdE12345', 'https://ikelene.net/c/AbCdE12345', 'https://clips.nookara.cc.evil.example/c/AbCdE12345', 'http://clips.nookara.cc/c/AbCdE12345', 'https://clips.nookara.cc:8443/c/AbCdE12345', 'https://clips.nookara.cc/c/short', 'nope']) assert.equal(glintRef(u), null, u);
});
