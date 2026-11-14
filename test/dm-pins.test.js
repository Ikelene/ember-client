import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPins, moveItem, moveCat, addCat, editCat, removeCat, pinnedSet, catOf, dmKey } from '../src/chat/dmPinsCore.js';

const base = () => [
  { id: 'a', name: 'Friends', color: '#e8547a', items: ['d:nat', 'd:sam'] },
  { id: 'b', name: 'Work', color: '#5b8def', items: ['g:bfc_01'] },
];

test('cleanPins drops junk and duplicates', () => {
  assert.deepEqual(cleanPins(null), []);
  const c = cleanPins([{ id: 'a', name: 'x', color: 'red', items: ['d:nat', 'd:nat', 'bad', 5] }, { id: 'b', name: 'y', color: '#000000', items: ['d:nat'] }, null]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].items, ['d:nat']);
  assert.equal(c[0].color, '#e8547a');
  assert.deepEqual(c[1].items, []);
});
test('moveItem pins, moves between, reorders and unpins', () => {
  let c = moveItem(base(), 'd:new', 'b', 0);
  assert.deepEqual(c[1].items, ['d:new', 'g:bfc_01']);
  c = moveItem(c, 'd:nat', 'b'); // to the end of another category
  assert.deepEqual(c[0].items, ['d:sam']);
  assert.deepEqual(c[1].items, ['d:new', 'g:bfc_01', 'd:nat']);
  c = moveItem(c, 'd:nat', 'b', 0); // reorder inside
  assert.deepEqual(c[1].items, ['d:nat', 'd:new', 'g:bfc_01']);
  c = moveItem(c, 'd:nat', null); // unpin
  assert.equal(catOf(c, 'd:nat'), null);
  assert.equal(pinnedSet(c).size, 3);
  assert.deepEqual(moveItem(base(), 'd:x', 'nope'), base());
});
test('categories: add (with a DM), rename, recolour, move, delete', () => {
  let c = addCat(base(), { id: 'n', name: '  Besties ', color: '#5bb37a' }, dmKey('Sam'));
  assert.equal(c[2].name, 'Besties');
  assert.deepEqual(c[2].items, ['d:sam']);
  assert.deepEqual(c[0].items, ['d:nat']);
  c = editCat(c, 'n', { name: 'BFFs', color: '#000000' });
  assert.equal(c[2].name, 'BFFs');
  assert.equal(c[2].color, '#000000');
  c = moveCat(c, 'n', 0);
  assert.deepEqual(c.map(x => x.id), ['n', 'a', 'b']);
  c = moveCat(c, 'n', 9);
  assert.deepEqual(c.map(x => x.id), ['a', 'b', 'n']);
  c = removeCat(c, 'a');
  assert.deepEqual(c.map(x => x.id), ['b', 'n']);
});

import { chanKey, parseItem, viewKeyOf, cleanShortcuts, toggleShortcut, moveShortcut } from '../src/chat/dmPinsCore.js';
test('channel keys', () => {
  const k = chanKey('https://e-x.nookara.cc|s1', 'https://e-x.nookara.cc|c2');
  assert.deepEqual(parseItem(k), { kind: 'channel', sid: 'https://e-x.nookara.cc|s1', cid: 'https://e-x.nookara.cc|c2' });
  assert.equal(viewKeyOf(k), 'c:https://e-x.nookara.cc|c2');
  assert.equal(viewKeyOf('d:nat'), 'd:nat');
  assert.equal(parseItem('c:only'), null);
  assert.deepEqual(cleanPins([{ id: 'a', name: 'x', color: '#000000', items: [k, 'd:nat'] }])[0].items, [k, 'd:nat']);
});
test('home shortcuts', () => {
  assert.deepEqual(cleanShortcuts(['d:nat', 'd:nat', 'bad', 'g:bfc_1']), ['d:nat', 'g:bfc_1']);
  let l = toggleShortcut([], 'd:nat');
  l = toggleShortcut(l, 'c:s1 c2');
  assert.deepEqual(l, ['d:nat', 'c:s1 c2']);
  assert.deepEqual(moveShortcut(l, 'c:s1 c2', -1), ['c:s1 c2', 'd:nat']);
  assert.deepEqual(moveShortcut(l, 'd:nat', -1), l);
  assert.deepEqual(toggleShortcut(l, 'd:nat'), ['c:s1 c2']);
});
