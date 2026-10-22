import test from 'node:test';
import assert from 'node:assert/strict';
import { canAttachInChannel } from '../src/chat/attachment-permissions.js';
import { prepareInstanceAttachments } from '../src/chat/attachment-preparation.js';
import { attachmentRefs } from '../src/chat/signing-payload.js';

test('attachment permission parity: everyone, channel deny, role allow, admin, disabled', () => {
  const detail = { server: { perms: 257, allow_uploads: true }, roles: [{ rid: 'everyone', is_default: true }], channels: [{ cid: 'general', overwrites: [] }] };
  const can = () => canAttachInChannel(detail, 'general', [{ username: 'local', roles: ['images'] }], 'local');
  assert.equal(can(), true);
  detail.channels[0].overwrites = [{ rid: 'everyone', deny: 256, allow: 0 }];
  assert.equal(can(), false);
  detail.channels[0].overwrites.push({ rid: 'images', deny: 0, allow: 256 });
  assert.equal(can(), true);
  detail.server.perms = 1;
  assert.equal(can(), true);
  detail.server.perms = 1023;
  assert.equal(can(), true);
  detail.server.allow_uploads = false;
  assert.equal(can(), false);
});

test('saved media import avoids browser fetch and signs destination hashes in attachment order', async () => {
  const instance = 'https://chat.test', calls = [];
  const upload = { url: instance + '/uploads/local.png', sha256: 'a'.repeat(64) };
  const gif = { url: 'https://static.klipy.com/giphy/cat.gif', type: 'gif' };
  const remote = { url: 'https://velora.test/uploads/saved.png', sha256: 'b'.repeat(64), name: 'saved.png' };
  const prepared = await prepareInstanceAttachments([upload, remote, gif], instance, 'https://velora.test', async a => {
    calls.push(a);
    return { url: instance + '/uploads/imported.png', sha256: 'c'.repeat(64) };
  });
  assert.deepEqual(calls, [remote]);
  assert.equal(prepared[0], upload); assert.equal(prepared[2], gif);
  assert.deepEqual(attachmentRefs(prepared), ['a'.repeat(64), 'c'.repeat(64), 'url:' + gif.url]);
  await assert.rejects(prepareInstanceAttachments([remote], instance, instance, async () => { throw Error('media_import_failed'); }), /media_import_failed/);
});
