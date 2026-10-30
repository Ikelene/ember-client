import test from 'node:test';
import assert from 'node:assert/strict';
import { aliasOf, aliasKey, aliasFace, isUnmarked, aliasMemberOf, shownName, shownPfp } from '../src/chat/aliases.js';

const bot = { id: 'b:1', username: 'sable', bot: true, pfp: 'https://x/bot.png', color: '#111111' };
const carol = { id: 'l:3', username: 'carol', kind: 'local', pfp: 'https://x/carol.png', color: '#ff0000' };
const msg = alias => ({ id: '1', author: bot, alias, body: 'hi' });

test('marked alias: own key per avatar, bot picture fallback, never unmarked', () => {
  const m = msg({ name: 'Narrator', avatar_url: null, unmarked: false });
  assert.equal(isUnmarked(aliasOf(m)), false);
  assert.equal(aliasMemberOf(aliasOf(m)), null);
  assert.equal(aliasKey(m), 'Narrator\n');
  assert.equal(aliasFace(aliasOf(m), bot).pfp, bot.pfp);
  assert.equal(shownName(m), 'Narrator');
});

test('unmarked alias with a matched member: member picture + colour, grouped by name', () => {
  const m = msg({ name: 'Carol', avatar_url: null, unmarked: true, member_id: carol.id, member: carol });
  const a = aliasOf(m);
  assert.equal(isUnmarked(a), true);
  assert.equal(aliasMemberOf(a).username, 'carol');
  const f = aliasFace(a, bot);
  assert.equal(f.username, 'Carol');
  assert.equal(f.pfp, carol.pfp);
  assert.equal(f.color, '#ff0000');
  assert.equal(shownPfp(m), carol.pfp);
  assert.equal(aliasKey(m), aliasKey(msg({ name: ' carol ', avatar_url: 'https://x/other.png', unmarked: true })));
  // avatar_url still wins over the member's picture
  assert.equal(aliasFace({ ...a, avatar_url: 'https://x/a.png' }, bot).pfp, 'https://x/a.png');
});

test('unmarked alias with no match: the bot picture, no member', () => {
  const a = aliasOf(msg({ name: 'Nobody', avatar_url: null, unmarked: true }));
  assert.equal(aliasMemberOf(a), null);
  assert.equal(aliasFace(a, bot).pfp, bot.pfp);
});

test('only bots get aliases (a person with an alias field is ignored)', () => {
  assert.equal(aliasOf({ author: carol, alias: { name: 'x', unmarked: true } }), null);
});
