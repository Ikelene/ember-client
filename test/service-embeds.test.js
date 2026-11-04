import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveRef, forumRef, embedLabel, isHiddenInviteLine } from '../src/chat/inviteLink.js';

const T = 'a'.repeat(32), I = 'b'.repeat(20);
const SHARE = `https://drive.nookara.cc/#/s/${T}`;

test('real Drive links are recognised, and only share links hide behind a card', () => {
  assert.deepEqual(driveRef(SHARE), { service: 'drive', sure: true });
  assert.deepEqual(driveRef(`${SHARE}/${I}`), { service: 'drive', sure: true });
  assert.deepEqual(driveRef(`https://drive.nookara.cc/#/drive/${I}`), { service: 'drive', sure: false });
  assert.equal(isHiddenInviteLine(SHARE), true);
  assert.equal(isHiddenInviteLine(`https://drive.nookara.cc/#/drive/${I}`), false);
  assert.equal(embedLabel(SHARE), 'Nookara Drive');
  for (const u of ['https://drive.nookara.cc/', 'https://drive.nookara.cc/#/recent', `https://drive.nookara.cc/#/s/${T.toUpperCase()}`, `https://drive.nookara.cc/#/s/${T}x`, `https://drive.nookara.cc/x#/s/${T}`, `https://drive.nookara.cc/?a=1#/s/${T}`]) assert.equal(driveRef(u), null, u);
});

test('real Forums links are recognised', () => {
  for (const u of ['https://forums.nookara.cc/t/12', 'https://forums.nookara.cc/t/12/', 'https://forums.nookara.cc/t/12?page=2#p55', 'https://forums.nookara.cc/c/games', 'https://forums.nookara.cc/u/ikelene', 'https://FORUMS.nookara.cc/t/12']) assert.deepEqual(forumRef(u), { service: 'forum', sure: true }, u);
  assert.equal(embedLabel('https://forums.nookara.cc/t/12'), 'Nookara Forums');
  for (const u of ['https://forums.nookara.cc/', 'https://forums.nookara.cc/communities', 'https://forums.nookara.cc/t/abc', 'https://forums.nookara.cc/t/0', 'https://forums.nookara.cc/c/games/manage', 'https://forums.nookara.cc/forums/api/t/1']) assert.equal(forumRef(u), null, u);
});

test('a lookalike never counts as ours', () => {
  for (const host of ['drive.nookara.cc.evil.com', 'evil-drive.nookara.cc', 'xn--drve-7za.nookara.cc', 'drive.nookara.co', 'drive.nookara.cc.', 'a.drive.nookara.cc', 'nookara.cc']) {
    assert.equal(driveRef(`https://${host}/#/s/${T}`), null, host);
    assert.equal(isHiddenInviteLine(`https://${host}/#/s/${T}`), false, host);
  }
  for (const u of [`http://drive.nookara.cc/#/s/${T}`, `https://drive.nookara.cc:8443/#/s/${T}`, `https://drive.nookara.cc@evil.com/#/s/${T}`, `https://user:pw@drive.nookara.cc/#/s/${T}`, `https://evil.com/?https://drive.nookara.cc/#/s/${T}`, `https://evil.com/#https://drive.nookara.cc/#/s/${T}`]) assert.equal(driveRef(u), null, u);
  for (const u of ['http://forums.nookara.cc/t/1', 'https://forums.nookara.cc:444/t/1', 'https://forums.nookara.cc@evil.com/t/1', 'https://forums.nookara.cc.evil.com/t/1', 'https://f0rums.nookara.cc/t/1', 'https://forums.nookara.cc./t/1', 'not a url']) assert.equal(forumRef(u), null, u);
});
