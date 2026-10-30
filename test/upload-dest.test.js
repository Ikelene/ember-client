import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberedDest, TEMP_LINK, tempId } from '../src/chat/upload-dest.js';
import { nameInLink, isSpoiler } from '../src/chat/spoiler.js';
import { cleanUrl } from '../src/chat/cleanLinks.js';

const T = 'https://velora.ikelene.net/t/Ab3dEfGhIjKlMnOpQrStUv';

test('upload destination: the account setting wins once loaded, the device copy before that', () => {
  assert.equal(rememberedDest({ fromServer: true, setting: 'temp', local: 'account' }), 'temp');
  assert.equal(rememberedDest({ fromServer: true, setting: 'ask', local: 'account' }), null, '"Ask every time" on the account beats an old device copy');
  assert.equal(rememberedDest({ fromServer: false, setting: 'ask', local: 'account' }), 'account');
  assert.equal(rememberedDest({ fromServer: false, setting: 'ask', local: null }), null);
  assert.equal(rememberedDest({ fromServer: true, setting: 'catbox', local: null }), null);
});

test('temporary-storage links', () => {
  assert.equal(tempId(`${T}/cat.png`), 'Ab3dEfGhIjKlMnOpQrStUv');
  assert.equal(tempId('https://velora.ikelene.net/t/short/cat.png'), null);
  assert.equal(tempId('https://evil.example/t/Ab3dEfGhIjKlMnOpQrStUv/x'), null);
  assert.ok(TEMP_LINK.test(`${T}/a%20b.zip`));
});

test('names in DM links: temp path, #n= on account storage and old catbox links', () => {
  assert.equal(nameInLink(`${T}/SPOILER_my%20cat.png`), 'SPOILER_my cat.png');
  assert.ok(isSpoiler({ name: nameInLink(`${T}/SPOILER_x.png`) }));
  assert.equal(nameInLink('https://velora.ikelene.net/uploads/images/1_ab.png#n=SPOILER_dog.png'), 'SPOILER_dog.png');
  assert.equal(nameInLink('https://files.catbox.moe/abc123.png#n=old.png'), 'old.png');
  assert.equal(nameInLink('https://example.com/x.png'), '');
});

test('tracking cleanup leaves temporary links alone', () => {
  assert.equal(cleanUrl(`${T}/cat.png`), `${T}/cat.png`);
  assert.equal(cleanUrl(`${T}/cat.png?dl=1`), `${T}/cat.png?dl=1`);
});
