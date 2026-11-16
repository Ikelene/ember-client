import test from 'node:test';
import assert from 'node:assert/strict';
import { pillsFor, pillText } from '../src/chat/unreadPills.js';

const view = { top: 100, bottom: 400 };
const row = (top, mention = false) => ({ top, bottom: top + 40, mention });

test('no pills while every unread row is in view', () => {
  assert.deepEqual(pillsFor([row(120), row(300, true)], view), { up: null, down: null });
});

test('a pill on each side that has hidden unread rows, pointing at the nearest', () => {
  const p = pillsFor([row(-200), row(20), row(200), row(500), row(900)], view);
  assert.deepEqual(p.up, { kind: 'unread', index: 1 });
  assert.deepEqual(p.down, { kind: 'unread', index: 3 });
});

test('mentions win over plain unreads on the same side, and point at the nearest mention', () => {
  const p = pillsFor([row(-400, true), row(-300, true), row(20), row(500), row(800, true), row(1200, true)], view);
  assert.deepEqual(p.up, { kind: 'mention', index: 1 });
  assert.deepEqual(p.down, { kind: 'mention', index: 4 });
});

test('half-visible rows count as in view; undrawn rows are ignored', () => {
  assert.deepEqual(pillsFor([row(85), row(375), { top: 0, bottom: 0, mention: true }], view), { up: null, down: null });
  assert.equal(pillsFor([row(50)], view).up.kind, 'unread'); // (mid 70 < 100)
});

test('text in en / de / pt, English otherwise', () => {
  assert.equal(pillText('mention', 'en-CA'), 'New Mentions');
  assert.equal(pillText('unread', 'en'), 'New Unreads');
  assert.equal(pillText('mention', 'de-DE'), 'Neue Erwähnungen');
  assert.equal(pillText('unread', 'pt-BR'), 'Novas mensagens');
  assert.equal(pillText('unread', 'fr'), 'New Unreads');
});
