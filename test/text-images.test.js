// The real renderBody (src/chat/text.jsx) with the store / emoji modules stubbed out, bundled with the esbuild that ships with vite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /\/(store|emoji|EmojiPicker|instances|api)\.jsx?$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const ask=()=>{},customEmoji=()=>null,loadEmojis=()=>{},useChat=()=>({}),UNI_EMOJI=/\\u0000\\u0000/g,Twemoji=()=>null,nameOfChar=()=>"",emojiDataSync=()=>null,getState=()=>({members:{},msgs:{},people:{},detail:{},servers:[]}),connections=new Map(),apiFetch=async()=>({});', loader: 'js' }));
  },
};
const dir = mkdtempSync(join(tmpdir(), 'ember-text-'));
const out = join(dir, 'text.mjs');
writeFileSync(join(dir, 'entry.js'), `export * from ${JSON.stringify(join(root, 'src/chat/text.jsx'))}; export { parseEmberLink } from ${JSON.stringify(join(root, 'src/chat/tokens.js'))};`);
await build({ entryPoints: [join(dir, 'entry.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [stub], jsx: 'automatic', logLevel: 'silent', absWorkingDir: root });
const { renderBody, parseEmberLink } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const UP = 'https://cdn.nookara.cc/uploads/images/abc123.png';

test('a picture alone on a line shows once, whatever its name holds', () => {
  for (const frag of ['Copy%20(2).png', "it's.png", 'x%20[1].png', 'a%20(1)(2).png', 'it%27s%20%282%29.png', 'plain.png']) {
    const r = renderBody(`${UP}#n=${frag}`, {});
    assert.equal(r.images.length, 1, `${frag}: ${JSON.stringify(r.images)}`);
    assert.deepEqual(r.media, [], frag);
  }
});

test('text then a picture with ( ) in its name: still one picture', () => {
  const r = renderBody(`look\n${UP}#n=Copy%20(2).png`, {});
  assert.equal(r.images.length, 1);
  assert.deepEqual(r.media, []);
});

test('a file with ( ) in its name stays one file card', () => {
  const r = renderBody('https://cdn.nookara.cc/uploads/files/z9.zip#n=a%20(1).zip', {});
  assert.equal(r.media.length, 1);
  assert.equal(r.media[0].name, 'a (1).zip');
  assert.deepEqual(r.images, []);
});

test('a temporary video with ( ) in its name is one video, with no extra file card', () => {
  const url = 'https://cdn.nookara.cc/temp/UyHKx6NMJoFTERslhD8Xhh/Download%20(2).mp4';
  for (const body of [url, `look ${url} here`, `(${url})`]) {
    const r = renderBody(body, {});
    assert.equal(r.media.length, 1, body);
    assert.equal(r.media[0].type, 'video', body);
    assert.equal(r.media[0].url, url, body);
  }
});

test('two different pictures are still two pictures', () => {
  const r = renderBody(`${UP}#n=a%20(1).png\nhttps://cdn.nookara.cc/uploads/images/other.png#n=a%20(1).png`, {});
  assert.equal(r.images.length, 2);
});

// ---- Discord-style tokens: <@id> / <#cid> are mentions, a plain @name / #name is just text ----
const texts = nodes => nodes.filter(n => typeof n === 'string').join('');
const kinds = nodes => nodes.filter(n => n && typeof n === 'object').map(n => n.type?.name || n.type);

test('a pasted "@yell at me" stays plain text (no mention button)', () => {
  const r = renderBody('@yell at me for your projects', {});
  assert.equal(texts(r.nodes), '@yell at me for your projects');
  assert.deepEqual(kinds(r.nodes), []);
});
test('an old message (legacy) still shows its @name as a mention', () => {
  const r = renderBody('hi @yell', { legacy: true });
  assert.equal(kinds(r.nodes).length, 1);
});
test('<@id> and <#cid> tokens become mention components', () => {
  const r = renderBody('hey <@42> and <@v:7> see <#c0123456789>', {});
  assert.deepEqual(kinds(r.nodes).filter(k => k === 'UserMention').length, 2);
  assert.equal(texts(r.nodes).includes('<@'), false);
  assert.equal(texts(r.nodes).includes('<#'), false);
});
test('Ember channel / message links: a pill, not a link preview', () => {
  const link = 'https://ember.nookara.cc/#/s/s0123456789/c0123456789/12345';
  const r = renderBody(`look ${link}`, {});
  assert.deepEqual(r.links, []);
  assert.deepEqual(kinds(r.nodes), ['EmberLinkPill']);
});
test('parseEmberLink: Nookara, instance and message forms; others are not', () => {
  assert.deepEqual(parseEmberLink('https://ember.nookara.cc/#/s/s0123456789/c0123456789/42'), { inst: 'velora', sid: 's0123456789', cid: 'c0123456789', mid: '42', hash: '#/s/s0123456789/c0123456789/42' });
  const i = parseEmberLink(`https://ember.nookara.cc/#/i/${encodeURIComponent('https://chat.example.com')}/s/s0123456789/c0123456789`);
  assert.deepEqual([i.inst, i.sid, i.cid, i.mid], ['https://chat.example.com', 'https://chat.example.com|s0123456789', 'https://chat.example.com|c0123456789', null]);
  assert.equal(parseEmberLink('https://nookara.cc/chat#/s/s0123456789/c0123456789')?.sid, 's0123456789');
  assert.equal(parseEmberLink('https://example.com/#/s/s0123456789/c0123456789'), null);
  assert.equal(parseEmberLink('https://ember.nookara.cc/#/dm/someone'), null);
  assert.equal(parseEmberLink('https://ember.nookara.cc/#/s/s0123456789/c0123456789/notanid'), null);
});
