import test from 'node:test';
import assert from 'node:assert/strict';
import { normalDays, daysText, shortDays, expiryChoices, pickedDays } from '../src/chat/temp-pick.js';

const MB = 1024 * 1024;
const FREE = { image: 30, media: 14, file: 7, large: 3 };
const PRO = { image: 60, media: 28, file: 14, large: 6 };

test('normal lifetime follows the server table', () => {
  assert.equal(normalDays(FREE, 'image', 2 * MB), 30);
  assert.equal(normalDays(FREE, 'gif', 10 * MB), 30);
  assert.equal(normalDays(FREE, 'image', 12 * MB), 7, 'a big picture counts as another file');
  assert.equal(normalDays(FREE, 'video', 40 * MB), 14);
  assert.equal(normalDays(FREE, 'audio', 50 * MB), 14);
  assert.equal(normalDays(FREE, 'video', 60 * MB), 3);
  assert.equal(normalDays(FREE, 'file', 25 * MB), 7);
  assert.equal(normalDays(FREE, 'file', 26 * MB), 3);
  assert.equal(normalDays(PRO, 'image', MB), 60);
  assert.equal(normalDays(null, 'image', MB), null);
});
test('labels', () => {
  assert.equal(daysText(1), '1 day');
  assert.equal(daysText(7), '1 week');
  assert.equal(daysText(30), '30 days');
  assert.equal(daysText(10.5), '10.5 days');
  assert.equal(daysText(0.5), '12 hours');
  assert.equal(shortDays(7), '7d');
  assert.equal(shortDays(1 / 24), '1h');
});
test('choices: default first, presets in order, the longest sent as max', () => {
  assert.deepEqual(expiryChoices([1, 7, 30, 90, 120], 120), [
    { value: 'default', days: null }, { value: 1, days: 1 }, { value: 7, days: 7 }, { value: 30, days: 30 }, { value: 90, days: 90 }, { value: 'max', days: 120 },
  ]);
  assert.deepEqual(expiryChoices([1, 7, 30, 90], 60).map(c => c.value), ['default', 1, 7, 30, 'max'], 'presets past the max are dropped, the max is added');
  assert.equal(pickedDays('max', 120), 120);
  assert.equal(pickedDays(7, 120), 7);
  assert.equal(pickedDays('default', 120), null);
  assert.equal(pickedDays(undefined, 120), null);
});
