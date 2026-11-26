import test from 'node:test';
import assert from 'node:assert/strict';
import { isGrouped, fromGrouped, groupFlat, readDirectory, sortGroups, mergeGroups, filterGroups, loadDirectory } from '../src/chat/directory.js';

const c = (slug, domain, members, extra = {}) => ({ sid: `s-${slug}`, slug, address: `${slug}@${domain}`, name: slug.toUpperCase(), icon_url: '', description: `about ${slug}`, member_count: members, join_policy: 'open', invite_url: `https://${domain}/i/${slug}/x`, tags: ['games'], ...extra });
const GROUPED = [
  { homeserver: { domain: 'small.example', name: 'Small', url: 'https://small.example' }, communities: [c('tiny', 'small.example', 3)] },
  { homeserver: { domain: 'big.example', name: 'Big', url: 'https://hs.big.example' }, communities: [c('one', 'big.example', 50), c('two', 'big.example', 900)] },
  { homeserver: { domain: 'nookara.cc', name: 'Nookara', url: 'https://nookara.cc' }, communities: [c('lounge', 'nookara.cc', 10)] },
  { homeserver: { domain: 'empty.example', name: 'Empty', url: 'https://empty.example' }, communities: [] },
];
const FLAT = { page: 1, has_more: true, results: [
  { id: 1, url: 'https://chat.small.example', name: 'Tiny', description: 'a tiny one', member_count: 3, tags: ['art'] },
  { id: 2, url: 'https://e-big.nookara.cc', name: 'Big one', member_count: 400, trusted: true },
  { id: 3, url: 'https://nookara.cc', name: 'Lounge', member_count: 5 },
  { id: 4, url: 'https://nookara.cc', name: 'Second', member_count: 9 },
  { id: 5, url: 'javascript:alert(1)', name: 'Bad' },
] };

test('directory: the grouped answer is recognised, the old one is not', () => {
  assert.equal(isGrouped(GROUPED), true);
  assert.equal(isGrouped({ groups: GROUPED }), true);
  assert.equal(isGrouped(FLAT), false);
  assert.equal(isGrouped([{ id: 1, url: 'https://x.example' }]), false);
  assert.equal(isGrouped(null), false);
});
test('directory: nookara.cc first, then by size, empty homeservers left out', () => {
  const d = readDirectory(GROUPED);
  assert.equal(d.grouped, true);
  assert.deepEqual(d.groups.map(g => g.domain), ['nookara.cc', 'big.example', 'small.example']);
  const big = d.groups[1];
  assert.equal(big.name, 'Big');
  assert.equal(big.url, 'https://hs.big.example');
  assert.deepEqual(big.communities.map(x => x.slug), ['two', 'one']); // the biggest server first
  assert.equal(big.communities[0].address, 'two@big.example');
  assert.equal(big.communities[0].sid, 's-two');
  assert.equal(big.communities[0].url, 'https://hs.big.example');
  assert.deepEqual(big.communities[0].tags, ['games']);
});
test('directory: ties go to the homeserver with more servers, then by name', () => {
  const g = (domain, counts) => ({ domain, name: domain, url: `https://${domain}`, communities: counts.map((n, i) => ({ key: `${domain}/${i}`, name: `n${i}`, member_count: n })) });
  assert.deepEqual(sortGroups([g('b.example', [10]), g('a.example', [10]), g('c.example', [5, 5]), g('nookara.cc', [1])]).map(x => x.domain), ['nookara.cc', 'c.example', 'a.example', 'b.example']);
});
test('directory: an address is made from slug + domain when the listing leaves it out', () => {
  const [g] = fromGrouped([{ homeserver: { domain: 'Big.Example', url: 'https://big.example' }, communities: [{ sid: 7, slug: 'one', name: 'One', member_count: '12' }] }]);
  assert.equal(g.domain, 'big.example');
  assert.equal(g.name, 'big.example');
  assert.equal(g.communities[0].address, 'one@big.example');
  assert.equal(g.communities[0].member_count, 12);
  assert.equal(g.communities[0].sid, '7');
});
test('directory fallback: the old listing is grouped by host', () => {
  const d = readDirectory(FLAT);
  assert.equal(d.grouped, false);
  assert.equal(d.has_more, true);
  assert.deepEqual(d.groups.map(g => g.domain), ['nookara.cc', 'e-big.nookara.cc', 'chat.small.example']);
  assert.deepEqual(d.groups[0].communities.map(x => x.name), ['Second', 'Lounge']);
  assert.equal(d.groups[0].communities[0].address, ''); // nothing to show until the directory sends one
  assert.equal(d.groups[0].communities[0].url, 'https://nookara.cc');
  assert.equal(d.groups[1].communities[0].trusted, true);
  assert.equal(groupFlat(null).length, 0);
  assert.deepEqual(readDirectory(undefined).groups, []);
});
test('directory: a second page joins the sections already shown', () => {
  const a = readDirectory(FLAT).groups;
  const b = readDirectory({ results: [{ id: 9, url: 'https://nookara.cc', name: 'Third', member_count: 100 }, { id: 4, url: 'https://nookara.cc', name: 'Second', member_count: 9 }, { id: 10, url: 'https://new.example', name: 'New', member_count: 1 }] }).groups;
  const m = mergeGroups(a, b);
  assert.deepEqual(m[0].communities.map(x => x.name), ['Third', 'Second', 'Lounge']);
  assert.equal(m.some(g => g.domain === 'new.example'), true);
});
test('directory: the search filters across every homeserver', () => {
  const groups = readDirectory(GROUPED).groups;
  assert.deepEqual(filterGroups(groups, 'two').map(g => [g.domain, g.communities.map(x => x.slug)]), [['big.example', ['two']]]);
  assert.deepEqual(filterGroups(groups, 'lounge@nookara').map(g => g.domain), ['nookara.cc']); // by address
  assert.deepEqual(filterGroups(groups, 'small').map(g => g.domain), ['small.example']); // by homeserver
  assert.equal(filterGroups(groups, 'games').length, 3); // by tag
  assert.equal(filterGroups(groups, 'about one').length, 1);
  assert.equal(filterGroups(groups, 'nothing-like-this').length, 0);
  assert.equal(filterGroups(groups, '  ').length, 3);
});
test('directory: asks for the grouped listing, falls back to the old call', async () => {
  const asked = [];
  const grouped = await loadDirectory(async u => { asked.push(u); return GROUPED; }, '/bonfire', { q: 'a b', page: 2 });
  assert.deepEqual(asked, ['/bonfire/directory?group=homeserver&q=a%20b&page=2']);
  assert.equal(grouped.grouped, true);
  // a 404 on the grouped call
  asked.length = 0;
  const old = await loadDirectory(async u => { asked.push(u); if (u.includes('group=')) throw Object.assign(new Error('not_found'), { status: 404 }); return FLAT; }, '/bonfire');
  assert.deepEqual(asked, ['/bonfire/directory?group=homeserver&q=&page=1', '/bonfire/directory?q=&page=1']);
  assert.equal(old.grouped, false);
  assert.equal(old.groups.length, 3);
  // an older Nookara that ignores `group` and answers the old way: used as it is, no second call
  asked.length = 0;
  const ignored = await loadDirectory(async u => { asked.push(u); return FLAT; }, '/bonfire');
  assert.equal(asked.length, 1);
  assert.equal(ignored.grouped, false);
  // nothing works: the error reaches the page
  await assert.rejects(loadDirectory(async () => { throw new Error('down'); }, '/bonfire'));
});
