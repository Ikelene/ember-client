import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberedDest, TEMP_LINK, tempId } from '../src/chat/upload-dest.js';
import { nameInLink, isSpoiler } from '../src/chat/spoiler.js';
import { cleanUrl } from '../src/chat/cleanLinks.js';

const T = 'https://nookara.cc/t/Ab3dEfGhIjKlMnOpQrStUv';

test('upload destination: the account setting wins once loaded, the device copy before that', () => {
  assert.equal(rememberedDest({ fromServer: true, setting: 'temp', local: 'account' }), 'temp');
  assert.equal(rememberedDest({ fromServer: true, setting: 'ask', local: 'account' }), null, '"Ask every time" on the account beats an old device copy');
  assert.equal(rememberedDest({ fromServer: false, setting: 'ask', local: 'account' }), 'account');
  assert.equal(rememberedDest({ fromServer: false, setting: 'ask', local: null }), null);
  assert.equal(rememberedDest({ fromServer: true, setting: 'catbox', local: null }), null);
});

test('temporary-storage links', () => {
  assert.equal(tempId(`${T}/cat.png`), 'Ab3dEfGhIjKlMnOpQrStUv');
  assert.equal(tempId('https://nookara.cc/t/short/cat.png'), null);
  assert.equal(tempId('https://evil.example/t/Ab3dEfGhIjKlMnOpQrStUv/x'), null);
  assert.ok(TEMP_LINK.test(`${T}/a%20b.zip`));
});

test('names in DM links: temp path, #n= on account storage and old catbox links', () => {
  assert.equal(nameInLink(`${T}/SPOILER_my%20cat.png`), 'SPOILER_my cat.png');
  assert.ok(isSpoiler({ name: nameInLink(`${T}/SPOILER_x.png`) }));
  assert.equal(nameInLink('https://nookara.cc/uploads/images/1_ab.png#n=SPOILER_dog.png'), 'SPOILER_dog.png');
  assert.equal(nameInLink('https://files.catbox.moe/abc123.png#n=old.png'), 'old.png');
  assert.equal(nameInLink('https://example.com/x.png'), '');
});

test('tracking cleanup leaves temporary links alone', () => {
  assert.equal(cleanUrl(`${T}/cat.png`), `${T}/cat.png`);
  assert.equal(cleanUrl(`${T}/cat.png?dl=1`), `${T}/cat.png?dl=1`);
});

// ── temporary files in the CDN bucket: https://cdn.nookara.cc/temp/<id>/<name> ──
const ID = 'Ab3dEfGhIjKlMnOpQrStUv';
const CDN_T = `https://cdn.nookara.cc/temp/${ID}`;
const TEMP_BAD = ['https://cdn.nookara.cc.evil.example', 'https://evilcdn.nookara.cc', 'https://cdn-nookara.cc', 'https://cdn.nookara.cc@evil.example', 'https://x.cdn.nookara.cc', 'http://cdn.nookara.cc', 'https://cdn.nookara.cc:444.evil.example', 'https://nookara.cc.evil.example', 'https://evil.example'];

test('a CDN temp link is a temporary-storage link (same id, same /t/info lookup); /t/ links still are', async () => {
  const { TEMP_LINK, tempId, isCdnTemp } = await import('../src/chat/upload-dest.js');
  assert.equal(tempId(`${CDN_T}/cat.png`), ID);
  assert.ok(TEMP_LINK.test(`${CDN_T}/a%20b.zip`));
  assert.equal(tempId(`${T}/cat.png`), ID, '/t/ unchanged');
  assert.equal(tempId(`https://velora.ikelene.net/t/${ID}/x`), ID);
  assert.ok(isCdnTemp(`${CDN_T}/cat.png`) && !isCdnTemp(`${T}/cat.png`));
  assert.ok(!isCdnTemp(`https://cdn.nookara.cc/uploads/images/${ID}/cat.png`));
  assert.equal(tempId(`https://cdn.nookara.cc/temp/short/cat.png`), null);
  assert.equal(tempId(`https://cdn.nookara.cc/t/${ID}/cat.png`), null, 'the CDN has no /t/');
  assert.equal(tempId(`https://nookara.cc/temp/${ID}/cat.png`), null, '/temp/ is the CDN host only');
  for (const h of TEMP_BAD) { assert.equal(tempId(`${h}/temp/${ID}/cat.png`), null, h); assert.ok(!isCdnTemp(`${h}/temp/${ID}/cat.png`), h); }
});

test('upload links: a CDN temp file can be saved and is never unfurled; look-alikes and other CDN paths are not', async () => {
  const { SAVEABLE, NOOKARA_FILE, TEMP_FILE, VID, VUP } = await import('../src/chat/uploadLinks.js');
  for (const re of [SAVEABLE, NOOKARA_FILE, TEMP_FILE]) {
    assert.ok(re.test(`${CDN_T}/cat.png`), String(re));
    assert.ok(re.test(`${T}/cat.png`), `${re} (/t/ unchanged)`);
    for (const h of TEMP_BAD) assert.ok(!re.test(`${h}/temp/${ID}/cat.png`), `${h} ${re}`);
    assert.ok(!re.test(`https://cdn.nookara.cc/t/${ID}/cat.png`));
  }
  assert.ok(!TEMP_FILE.test(`${CDN_T}/cat.png?dl=1`) && !TEMP_FILE.test(`${CDN_T}`), 'a message link is <id>/<name> with no query');
  assert.ok(!TEMP_FILE.test(`${CDN_T}/`), 'the name is required');
  assert.ok(!VID.test(`${CDN_T}/a.mp4`) && !VUP.test(`${CDN_T}/a.mp4`), 'not an /uploads/ link: the upload patterns are unchanged');
  assert.ok(!SAVEABLE.test('https://cdn.nookara.cc/other/a.png'));
});

test('names and tracking cleanup for CDN temp links', () => {
  assert.equal(nameInLink(`${CDN_T}/SPOILER_my%20cat.png`), 'SPOILER_my cat.png');
  assert.ok(isSpoiler({ name: nameInLink(`${CDN_T}/SPOILER_x.png`) }));
  assert.equal(nameInLink(`https://evil.example/temp/${ID}/x.png`), '');
  assert.equal(nameInLink(`https://cdn.nookara.cc.evil.example/temp/${ID}/x.png`), '');
  assert.equal(cleanUrl(`${CDN_T}/cat.png`), `${CDN_T}/cat.png`);
  assert.equal(cleanUrl(`${CDN_T}/cat.png?utm_source=x`), `${CDN_T}/cat.png`);
});
