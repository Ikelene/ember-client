import test from 'node:test';
import assert from 'node:assert/strict';
import { stickerOfBody } from '../src/chat/stickerLink.js';

test('a body that is only a personal sticker link is a sticker', () => {
  assert.deepEqual(stickerOfBody('https://nookara.cc/uploads/stickers/s0123456789.png#cat_wave'), { psid: 's0123456789', name: 'cat_wave', url: 'https://nookara.cc/uploads/stickers/s0123456789.png', animated: false });
  assert.equal(stickerOfBody(' https://cdn.nookara.cc/uploads/stickers/sabcdefabcd.gif \n').animated, true);
  assert.equal(stickerOfBody('https://nookara.cc/uploads/stickers/s0123456789.png').name, 'sticker');
});
test('anything else is not', () => {
  assert.equal(stickerOfBody('look https://nookara.cc/uploads/stickers/s0123456789.png'), null);
  assert.equal(stickerOfBody('https://evil.example/uploads/stickers/s0123456789.png'), null);
  assert.equal(stickerOfBody('https://nookara.cc/uploads/emojis/e0123456789.png'), null);
  assert.equal(stickerOfBody('https://nookara.cc/uploads/stickers/s0123456789.png#bad name'), null);
  assert.equal(stickerOfBody(''), null);
});
