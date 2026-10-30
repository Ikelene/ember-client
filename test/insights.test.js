import test from 'node:test';
import assert from 'node:assert/strict';
import { niceMax, pctChange, labelEvery, bucketAt, short, mondayFirst } from '../src/chat/insightsMath.js';

test('axis tops are round numbers at or above the data', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(13), 20);
  assert.equal(niceMax(240), 250);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(1000), 1000);
});

test('change vs the previous range', () => {
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(50, 100), -50);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(5, 0), null);
});

test('x labels: evenly spaced, the last bucket always labelled', () => {
  assert.deepEqual(labelEvery(7, 10), [0, 1, 2, 3, 4, 5, 6]);
  const l = labelEvery(90, 6);
  assert.ok(l.length <= 6); assert.equal(l.at(-1), 89);
});

test('hover picks the bucket under the pointer', () => {
  assert.equal(bucketAt(10, 20, 100, 10), null);
  assert.equal(bucketAt(20, 20, 100, 10), 0);
  assert.equal(bucketAt(119.9, 20, 100, 10), 9);
  assert.equal(bucketAt(120, 20, 100, 10), 9);
  assert.equal(bucketAt(75, 20, 100, 10), 5);
});

test('short numbers and the Monday-first heatmap', () => {
  assert.equal(short(950), '950'); assert.equal(short(12345), '12.3k'); assert.equal(short(2500000), '2.5M');
  const h = Array.from({ length: 7 }, (_, d) => new Array(24).fill(d));
  assert.deepEqual(mondayFirst(h).map(r => r.hours[0]), [1, 2, 3, 4, 5, 6, 0]);
});
