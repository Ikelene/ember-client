// account profiles on servers with their own accounts (src/chat/accountProfileCore.js): what a Nookara profile becomes there,
// and the stamp that says which copy the server holds
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFields, stampOf, stampParts, joinStamp, changedParts, follows, pictureSources, hasAccountProfile, accountTarget, targetOrigin, LIMITS } from '../src/chat/accountProfileCore.js';

const nat = { id: 12, username: 'nat', display_name: 'Nat  the  Great', bio: 'hi\r\nthere', pronouns: 'she/her', color: '#AABBCC', pfp_url: '/uploads/pfp/a.png', banner_url: 'https://cdn.nookara.cc/uploads/banner/b.png' };

test('a Nookara profile is cut to what the server takes', () => {
  assert.deepEqual(copyFields(nat), { display_name: 'Nat the Great', bio: 'hi\nthere', pronouns: 'she/her', color: '#aabbcc' });
  // nothing set, a display name that is just the username, a colour that isn't a hex colour: all empty
  assert.deepEqual(copyFields({ username: 'nat', display_name: 'nat', color: 'gradient(red, blue)' }), { display_name: null, bio: null, pronouns: null, color: null });
  const long = copyFields({ username: 'nat', display_name: 'x'.repeat(40), bio: 'y'.repeat(500), pronouns: 'z'.repeat(60) });
  assert.equal(long.display_name.length, LIMITS.name);
  assert.equal(long.bio.length, LIMITS.bio);
  assert.equal(long.pronouns.length, LIMITS.pronouns);
  // an emoji at the limit is dropped whole, never cut in half
  const bio = copyFields({ username: 'nat', bio: 'a'.repeat(299) + String.fromCodePoint(0x1f525) }).bio;
  assert.equal(bio, 'a'.repeat(299));
});

test('the stamp changes only for the part that changed', async () => {
  const a = await stampOf(nat);
  assert.match(a, /^t:[0-9a-f]{16}\.p:[0-9a-f]{16}\.b:[0-9a-f]{16}$/);
  assert.ok(a.length <= 128);
  assert.equal(await stampOf({ ...nat }), a);
  assert.deepEqual(changedParts(a, a), { text: false, pfp: false, banner: false });
  assert.deepEqual(changedParts('', a), { text: true, pfp: true, banner: true });
  assert.deepEqual(changedParts(a, await stampOf({ ...nat, bio: 'new' })), { text: true, pfp: false, banner: false });
  assert.deepEqual(changedParts(a, await stampOf({ ...nat, pfp_url: '/uploads/pfp/c.png' })), { text: false, pfp: true, banner: false });
  assert.deepEqual(changedParts(a, await stampOf({ ...nat, banner_url: null })), { text: false, pfp: false, banner: true });
  // a field the server doesn't take (website) is not a change
  assert.equal(await stampOf({ ...nat, website: 'https://example.com' }), a);
});

test('a picture that could not be read keeps its old stamp, so the next sync tries again', async () => {
  const before = await stampOf(nat), now = await stampOf({ ...nat, pfp_url: '/uploads/pfp/new.png' });
  const held = stampParts(before), next = stampParts(now);
  next.p = held.p;
  assert.deepEqual(changedParts(joinStamp(next), now), { text: false, pfp: true, banner: false });
  // the first copy ever: nothing held, the picture part stays empty and still counts as different
  const first = { ...stampParts(now), p: '' };
  assert.equal(changedParts(joinStamp(first), now).pfp, true);
  assert.deepEqual(stampParts('garbage'), { t: '', p: '', b: '' });
});

test('a profile follows only the Nookara account it was set up with', () => {
  assert.equal(follows({ velora_id: '12', stamp: 'x' }, 12), true);
  assert.equal(follows({ velora_id: '12', stamp: 'x' }, '13'), false);
  assert.equal(follows(null, 12), false);
  assert.equal(follows({ velora_id: '12' }, undefined), false);
});

test('pictures are read from nookara.cc', () => {
  assert.deepEqual(pictureSources('/uploads/pfp/a.png'), ['https://nookara.cc/uploads/pfp/a.png']);
  assert.deepEqual(pictureSources('https://cdn.nookara.cc/uploads/banner/b.png'), ['https://nookara.cc/uploads/banner/b.png', 'https://cdn.nookara.cc/uploads/banner/b.png']);
  assert.deepEqual(pictureSources('https://nookara.cc/uploads/pfp/a.png'), ['https://nookara.cc/uploads/pfp/a.png']);
  assert.deepEqual(pictureSources('//evil.example/x.png'), []);
  assert.deepEqual(pictureSources('javascript:alert(1)'), []);
  assert.deepEqual(pictureSources(null), []);
});

test('only an account of the server itself, on a server that keeps profiles', () => {
  const inst = { mode: 'local', features: { account_profiles: true }, user: { id: 'l:1', kind: 'local' } };
  assert.equal(hasAccountProfile(inst), true);
  assert.equal(hasAccountProfile({ ...inst, features: {} }), false); // an older server
  assert.equal(hasAccountProfile({ ...inst, mode: 'velora', user: { id: 'v:1', kind: 'velora' } }), false);
  assert.equal(hasAccountProfile({ ...inst, user: null }), false); // not signed in there
  assert.equal(targetOrigin(accountTarget('https://chat.example')), 'https://chat.example');
  assert.equal(targetOrigin('global'), null);
});
