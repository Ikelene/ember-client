import test from 'node:test';
import assert from 'node:assert/strict';
import { viaProxy } from '../src/chat/mediaProxy.js';

test('pictures from these hosts load through Nookara', () => {
  for (const u of ['https://static.klipy.com/a.gif', 'https://mc-heads.net/avatar/x/32', 'https://i.scdn.co/image/abc', 'https://image-cdn-ak.spotifycdn.com/image/abc']) {
    assert.equal(viaProxy(u), `https://nookara.cc/media-proxy?u=${encodeURIComponent(u)}`);
  }
});
test('everything else is left alone', () => {
  for (const u of ['https://cdn.nookara.cc/a.png', 'https://klipy.com.evil.com/a.gif', 'http://static.klipy.com/a.gif', 'https://nookara.cc/media-proxy?u=x']) assert.equal(viaProxy(u), u);
  assert.equal(viaProxy(null), null);
  assert.equal(viaProxy(undefined), undefined);
});
