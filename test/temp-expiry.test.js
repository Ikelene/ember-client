import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryLabel, expiryAt } from '../src/chat/temp-expiry.js';

// local times, so the day boundaries the label talks about are the machine's own
const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const at = (m, d, h = 12, min = 0) => new Date(2026, m, d, h, min).getTime();
const L = { now: NOW, locale: 'en-US' };

test('one file: the date', () => {
  assert.equal(expiryLabel([at(10, 29)], L), 'Expires Nov 29, 2026');
});
test('one file less than a day away: today / tomorrow with the time', () => {
  assert.equal(expiryLabel([at(9, 30, 15, 40)], L), 'Expires today at 3:40 PM');
  assert.equal(expiryLabel([at(9, 31, 9, 5)], L), 'Expires tomorrow at 9:05 AM');
});
test('several files: soonest and latest date', () => {
  assert.equal(expiryLabel([at(10, 29), at(10, 3), at(10, 12)], L), 'Expires between Nov 3, 2026 and Nov 29, 2026');
});
test('several files on the same day: just the date; the same file twice counts once', () => {
  assert.equal(expiryLabel([at(10, 5, 8), at(10, 5, 20)], L), 'Expires Nov 5, 2026');
  assert.equal(expiryLabel([at(10, 5), at(10, 5)], L), 'Expires Nov 5, 2026');
});
test('expired and unknown files are left out; all of them gone = no footer', () => {
  assert.equal(expiryLabel(['gone', at(10, 29), null], L), 'Expires Nov 29, 2026');
  assert.equal(expiryLabel([at(9, 30, 11)], L), null, 'a time already past counts as expired');
  assert.equal(expiryLabel(['gone', 'gone'], L), null);
  assert.equal(expiryLabel([null], L), null);
  assert.equal(expiryLabel([], L), null);
});
test('expiryAt: seconds left as of the fetch, or expires_at when Velora sends it', () => {
  assert.equal(expiryAt({ expires_in: 3600, at: 1000 }), 1000 + 3600000);
  assert.equal(expiryAt({ expires_in: 5, expires_at: '2026-11-29T00:00:00.000Z', at: 1000 }), Date.parse('2026-11-29T00:00:00.000Z'));
  assert.equal(expiryAt('gone'), 'gone');
  assert.equal(expiryAt(null), null);
});
