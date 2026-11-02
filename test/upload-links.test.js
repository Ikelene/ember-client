import test from 'node:test';
import assert from 'node:assert/strict';
import { VID, AUD, VUP, NAMED_LINK, SAVEABLE, NOOKARA_FILE, uploadKey } from '../src/chat/uploadLinks.js';
import { cleanUrl } from '../src/chat/cleanLinks.js';
import { prepareInstanceAttachments } from '../src/chat/attachment-preparation.js';

const HOSTS = ['https://nookara.cc', 'https://ember.nookara.cc', 'https://velora.ikelene.net', 'https://cdn.nookara.cc'];
const BAD = ['https://cdn.nookara.cc.evil.example', 'https://evilcdn.nookara.cc', 'https://cdn-nookara.cc', 'https://cdn.nookara.cc@evil.example', 'https://x.cdn.nookara.cc', 'http://cdn.nookara.cc', 'https://cdn.nookara.cc:444.evil.example', 'https://nookara.cc.evil.example'];

test('every upload host is recognised, look-alikes are not', () => {
  for (const h of HOSTS) {
    assert.ok(VID.test(`${h}/uploads/videos/a.mp4`), h);
    assert.ok(AUD.test(`${h}/uploads/audio/a.ogg`), h);
    assert.ok(VUP.test(`${h}/uploads/files/a.zip#n=my%20file.zip`), h);
    assert.ok(NAMED_LINK.test(`${h}/uploads/images/a.png`), h);
    assert.ok(SAVEABLE.test(`${h}/uploads/images/a.png`), h);
    assert.ok(NOOKARA_FILE.test(`${h}/uploads/images/a.png`), h);
  }
  for (const h of BAD) {
    for (const re of [VID, AUD, VUP, NAMED_LINK, SAVEABLE, NOOKARA_FILE]) assert.ok(!re.test(`${h}/uploads/videos/a.mp4`) && !re.test(`${h}/uploads/audio/a.ogg`) && !re.test(`${h}/uploads/images/a.png`), `${h} ${re}`);
  }
});

test('the CDN serves /uploads/ only: no /t/ temp links, other paths, or unknown upload kinds', () => {
  assert.ok(!NOOKARA_FILE.test('https://cdn.nookara.cc/t/Ab3dEfGhIjKlMnOpQrStUv/a.png'));
  assert.ok(!SAVEABLE.test('https://cdn.nookara.cc/t/Ab3dEfGhIjKlMnOpQrStUv/a.png'));
  assert.ok(SAVEABLE.test('https://nookara.cc/t/Ab3dEfGhIjKlMnOpQrStUv/a.png')); // unchanged
  assert.ok(!VID.test('https://cdn.nookara.cc/files/a.mp4'));
  assert.ok(!VUP.test('https://cdn.nookara.cc/uploads/secrets/a.png'));
});

test('uploadKey: the same file on any host compares equal', () => {
  assert.equal(uploadKey('https://cdn.nookara.cc/uploads/videos/x.mp4?a=1#f'), '/uploads/videos/x.mp4');
  assert.equal(uploadKey('https://nookara.cc/uploads/videos/x.mp4'), '/uploads/videos/x.mp4');
  assert.equal(uploadKey('https://evil.example/uploads/videos/x.mp4'), 'https://evil.example/uploads/videos/x.mp4');
  assert.equal(uploadKey('https://cdn.nookara.cc.evil.example/uploads/videos/x.mp4'), 'https://cdn.nookara.cc.evil.example/uploads/videos/x.mp4');
});

test('cleanLinks: the CDN counts as our own host (only utm_* goes)', () => {
  assert.equal(cleanUrl('https://cdn.nookara.cc/uploads/images/a.png?v=2&utm_source=x'), 'https://cdn.nookara.cc/uploads/images/a.png?v=2');
});

test('a CDN link is still imported by an instance (it is not the instance origin), same as nookara.cc links', async () => {
  const calls = [];
  const a = { url: 'https://cdn.nookara.cc/uploads/images/a.png' };
  const out = await prepareInstanceAttachments([a], 'https://e-x.nookara.cc', 'https://nookara.cc', async x => { calls.push(x.url); return x; });
  assert.deepEqual(calls, [a.url]); assert.equal(out.length, 1);
});
