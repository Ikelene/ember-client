import test from 'node:test';
import assert from 'node:assert/strict';
import { attLink, encName, wireText, findPending, dropSettled, settle } from '../src/chat/pending.js';
import { linkBase, inLinks } from '../src/chat/uploadLinks.js';

const ME = 'ikelene';
const isMine = m => m.author?.username === ME;
const UP = 'https://cdn.nookara.cc/uploads/images/abc123.png';
const att = name => ({ url: UP, name, type: 'image' });
const pendingFor = (n, text, attachments) => ({ id: n, nonce: n, pending: true, body: text, wire: wireText(text, attachments), attachments, author: { username: ME }, created_at: 1000 });
const real = (id, body, extra = {}) => ({ id: `im${id}`, imId: id, body, attachments: [], author: { username: ME }, created_at: 1500, ...extra });

// the same two steps as store.js: addMessage (im_sent) puts the real message where the pending one is, settle (im_ack) drops what is left
const addMessage = (list, msg) => {
  if (msg.id && list.some(x => x.id === msg.id)) return list;
  const p = isMine(msg) ? findPending(list, msg) : -1;
  return p >= 0 ? list.map((x, i) => (i === p ? msg : x)) : [...list, msg];
};

test('wireText is the text then one link per file', () => {
  assert.equal(wireText('hi', []), 'hi');
  assert.equal(wireText('', [att('abc123.png')]), UP);
  assert.equal(wireText('hi', [att('a.png'), att('b.png')]), `hi\n${UP}#n=a.png\n${UP}#n=b.png`);
});

test('im_sent before im_ack with a picture: one message, not two', () => {
  const atts = [att('Copy (2).png')];
  const body = wireText('look', atts);
  let list = [pendingFor('n1', 'look', atts)];
  list = addMessage(list, real(7, body));
  assert.equal(list.length, 1, 'the real message replaced the pending one');
  assert.ok(!list[0].pending);
  list = settle(list, 'n1', real(7, body));
  assert.equal(list.length, 1);
});

test('the same, with the picture alone (no text)', () => {
  const atts = [att('x.png')];
  let list = [pendingFor('n1', '', atts)];
  list = addMessage(list, real(8, wireText('', atts)));
  list = settle(list, 'n1', real(8, wireText('', atts)));
  assert.equal(list.length, 1);
});

test('im_ack before im_sent also leaves one', () => {
  const atts = [att('x.png')];
  const r = real(9, wireText('', atts));
  let list = [pendingFor('n1', '', atts)];
  list = settle(list, 'n1', r);
  list = addMessage(list, r);
  assert.equal(list.length, 1);
});

test('the server echoing a nonce settles the pending copy even if the text differs', () => {
  let list = [pendingFor('n1', 'a', [att('x.png')])];
  list = addMessage(list, real(10, 'something else entirely', { nonce: 'n1' }));
  assert.equal(list.length, 1);
  assert.ok(!list[0].pending);
});

test('two pictures sent back to back each settle their own pending copy', () => {
  const a = [att('x.png')];
  let list = [pendingFor('n1', '', a), pendingFor('n2', '', a)];
  list = addMessage(list, real(11, wireText('', a)));
  list = addMessage(list, real(12, wireText('', a)));
  assert.deepEqual(list.map(x => x.id), ['im11', 'im12']);
});

test('a message someone else sent never replaces my pending copy', () => {
  const a = [att('x.png')];
  const list = addMessage([pendingFor('n1', '', a)], real(13, wireText('', a), { author: { username: 'mahiro' } }));
  assert.equal(list.length, 2);
});

test('a lost ack: a refetch drops the pending copy its real message came back as', () => {
  const a = [att('x.png')];
  const fetched = [real(14, wireText('', a), { created_at: 1200 })];
  const live = dropSettled([pendingFor('n1', '', a)], fetched, isMine);
  assert.equal(live.length, 0);
});

test('a refetch keeps a pending copy with no real message yet, uploads, failures and old identical messages', () => {
  const a = [att('x.png')];
  const p = pendingFor('n1', '', a);
  assert.equal(dropSettled([p], [], isMine).length, 1);
  assert.equal(dropSettled([{ ...p, uploads: [{}] }], [real(1, p.wire)], isMine).length, 1);
  assert.equal(dropSettled([{ ...p, failed: 'offline' }], [real(1, p.wire)], isMine).length, 1);
  const old = real(2, p.wire, { created_at: 1000 - 10 * 60 * 1000 });
  assert.equal(dropSettled([p], [old], isMine).length, 1, 'an identical message from long before is not this one');
  assert.equal(dropSettled([p], [real(3, p.wire, { author: { username: 'mahiro' } })], isMine).length, 1);
});

test('one fetched message settles only one of two identical pending copies', () => {
  const a = [att('x.png')];
  const live = dropSettled([pendingFor('n1', '', a), pendingFor('n2', '', a)], [real(15, wireText('', a), { created_at: 1200 })], isMine);
  assert.equal(live.length, 1);
  assert.equal(live[0].nonce, 'n2');
});

test('names with ( ) \' ! * survive attLink and stay inside one URL_RE match', () => {
  const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"'.,;:!?)\]]/g;
  for (const name of ['Copy (2).png', "it's.png", 'wow!.png', 'a*b.png', 'x [1].png', 'a#b.png', 'ünï cödé (1).png', '(((.png']) {
    const link = attLink(att(name));
    assert.ok(!/[()'!*\s]/.test(link.split('#n=')[1]), `${name} -> ${link}`);
    assert.deepEqual(link.match(URL_RE), [link], name);
    assert.equal(decodeURIComponent(link.split('#n=')[1]), name);
  }
  assert.equal(encName('Copy (2).png'), 'Copy%20%282%29.png');
});

test('attLink only adds a name when it differs from the file name, and tolerates a bad escape in the url', () => {
  assert.equal(attLink(att('abc123.png')), UP);
  assert.equal(attLink({ url: 'https://nookara.cc/t/Ab3dEfGhIjKlMnOpQrStUv/a%20b.png', name: 'a b.png' }), 'https://nookara.cc/t/Ab3dEfGhIjKlMnOpQrStUv/a%20b.png');
  assert.equal(attLink({ url: `${UP.replace('abc123', '100%')}`, name: 'z.png' }), `${UP.replace('abc123', '100%')}#n=z.png`);
});

test('a picture taken whole from its own line is never counted again by the link scan', () => {
  // text.jsx: images holds "<url>#n=<name>", the scan finds the same link cut at ) or '
  const whole = `${UP}#n=Copy%20(2).png`;
  const cut = `${UP}#n=Copy%20(2`;
  const cutQuote = `${UP}#n=it`;
  assert.ok(inLinks([whole], cut));
  assert.ok(inLinks([`${UP}#n=it's.png`], cutQuote));
  assert.ok(inLinks([whole], UP));
  assert.ok(!inLinks([whole], 'https://cdn.nookara.cc/uploads/images/other.png#n=Copy%20(2'));
  assert.equal(linkBase(whole), UP);
  assert.equal(linkBase(undefined), '');
});
