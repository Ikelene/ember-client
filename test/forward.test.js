import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardText, fitForward, forwardLimit, forwardHasFiles } from '../src/chat/forward.js';

test('says where it came from; @everyone and @here never ping again', () => {
  assert.equal(forwardText({ author: 'bob', body: 'hello' }), '-# Forwarded from @bob\nhello');
  assert.equal(forwardText({ author: 'bob', where: ' in a group chat', body: 'hi' }), '-# Forwarded from @bob in a group chat\nhi');
  const t = forwardText({ author: 'bob', body: 'hey @everyone and @here' });
  assert.ok(!/@everyone|@here/.test(t));
});

test('limits follow the destination', () => {
  assert.equal(forwardLimit({ kind: 'group' }), 2000);
  assert.equal(forwardLimit({ kind: 'dm' }), 4000);
  assert.equal(forwardLimit({ kind: 'channel' }), 4000);
});

test('a message too long for the destination loses text, not its file links', () => {
  const link = 'https://cdn.nookara.cc/temp/AbCdEfGhIjKlMnOpQrStUv/photo.png';
  const out = fitForward('-# Forwarded from @bob', `${'x'.repeat(3990)}\n${link}`, 2000);
  assert.ok(out.length <= 2000, `was ${out.length}`);
  assert.ok(out.startsWith('-# Forwarded from @bob\nxxx'));
  assert.ok(out.endsWith(`…\n${link}`));
});

test('short messages are left alone', () => {
  assert.equal(fitForward('h', 'body', 2000), 'h\nbody');
});

test('notices files whether they are attachments or links in the text, and only ours', () => {
  assert.equal(forwardHasFiles({ attachments: [{ url: 'https://x.example/a.png' }] }), true);
  assert.equal(forwardHasFiles({ body: 'look https://cdn.nookara.cc/temp/AbCdEfGhIjKlMnOpQrStUv/a.png' }), true);
  assert.equal(forwardHasFiles({ body: 'https://nookara.cc/uploads/images/a.png#n=a.png' }), true);
  assert.equal(forwardHasFiles({ body: 'https://example.com/a.png and words' }), false);
  assert.equal(forwardHasFiles({ body: 'https://cdn.nookara.cc.evil.example/temp/a.png' }), false);
  assert.equal(forwardHasFiles({}), false);
});
