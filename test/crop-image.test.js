import test from 'node:test';
import assert from 'node:assert/strict';
import { cropSize, keepsAnimation } from '../src/chat/cropImage.js';
import { bare } from '../src/chat/ids.js';

test('crop output: shrunk to the target, never blown up', () => {
  assert.deepEqual(cropSize({ x: 0, y: 0, w: 2000, h: 2000 }, 512, 512), { w: 512, h: 512 });
  assert.deepEqual(cropSize({ x: 10, y: 10, w: 300, h: 300 }, 512, 512), { w: 300, h: 300 });
  assert.deepEqual(cropSize({ x: 0, y: 0, w: 1920, h: 960 }, 960, 480), { w: 960, h: 480 });
  assert.deepEqual(cropSize({ x: 0, y: 0, w: 3000, h: 1000 }, 960, 320), { w: 960, h: 320 });
});

test('GIFs skip the crop only on Ember servers (they stay animated there)', () => {
  assert.equal(keepsAnimation({ type: 'image/gif' }, true), true);
  assert.equal(keepsAnimation({ type: 'image/gif' }, false), false);
  assert.equal(keepsAnimation({ type: 'image/png' }, true), false);
});

test('bridge links match Ember-server channels kept as origin|id', () => {
  assert.equal(bare('https://e-test.nookara.cc|c42'), 'c42');
  assert.equal(bare('c42'), 'c42');
});
