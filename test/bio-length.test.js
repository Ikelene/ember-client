import test from 'node:test';
import assert from 'node:assert/strict';
import { bioLength, bioEmojiCount, BIO_EMOJI_MAX } from '../src/chat/bioLength.js';

test('bios: a custom emoji token counts as one character (the same rule as Nookara bio-length.js)', () => {
  assert.equal(bioLength('hi <:kiyori_wave:e0123456789> and <a:spin:eabcdef0123>'), 'hi * and *'.length);
  assert.equal(bioLength(''), 0);
  assert.equal(bioLength(undefined), 0);
  assert.equal(bioEmojiCount('<:a:e0123456789><:b:e0123456789> <:not a token:e0123456789> 😀'), 2);
  assert.equal(BIO_EMOJI_MAX, 10);
});
