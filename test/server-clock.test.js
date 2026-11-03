import test from 'node:test';
import assert from 'node:assert/strict';
import { noteServerClock, serverNow } from '../src/chat/server-clock.js';

const REAL = Date.UTC(2026, 10, 3, 20, 21, 0);
const HOUR = 60 * 60 * 1000;
const header = t => new Date(t).toUTCString();

test('a pc an hour ahead signs with the real time, inside the 5 minutes instances allow', () => {
  noteServerClock(header(REAL), null, REAL + HOUR);
  assert.equal(serverNow(REAL + HOUR), REAL);
});
test('a pc an hour behind too', () => {
  noteServerClock(header(REAL), null, REAL - HOUR);
  assert.equal(serverNow(REAL - HOUR), REAL);
});
test('a clock that is about right is left alone', () => {
  noteServerClock(header(REAL), null, REAL + 2000);
  assert.equal(serverNow(REAL + 2000), REAL + 2000);
});
test('a pc whose clock gets fixed goes back to its own time', () => {
  noteServerClock(header(REAL), null, REAL + HOUR);
  noteServerClock(header(REAL), null, REAL);
  assert.equal(serverNow(REAL), REAL);
});
test('a cached answer or a missing or broken Date teaches nothing', () => {
  noteServerClock(header(REAL), null, REAL);
  noteServerClock(header(REAL - HOUR), '3600', REAL);
  noteServerClock(null, null, REAL);
  noteServerClock('not a date', null, REAL);
  assert.equal(serverNow(REAL), REAL);
});
