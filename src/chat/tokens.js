// Discord-style tokens in message text: <@userId> pings a person, <#channelId> names a channel, <:name:eid> is a
// custom emoji, <@&rid> a role. A plain "@word" / "#word" is just text (so a pasted "@yell at me" pings nobody).
// User ids: Nookara's are numbers ("42"), an Ember server's are its principals ("v:42", "l:3", "b:7").
// Channel ids are the bare cid ("c" + 10 hex) on both, so a token means the same thing wherever it's read.
import { getState } from './store.js';
import { connections } from './instances.js';
import { VELORA, K, bare, instOf } from './ids.js';
import { EMBER_HOST } from './hosts.js';
import { personName, displayNameOf } from './displayNames.js';

export const nameOf = u => personName(u, displayNameOf(u.username)) || u.username;

export const USER_TOKEN = /<@!?((?:[vlb]:)?\d{1,20})>/;
export const CHANNEL_TOKEN = /<#(c[0-9a-f]{10})>/;
export const userToken = id => `<@${id}>`;
export const channelToken = cid => `<#${bare(cid)}>`;

// messages from before tokens existed still show their plain @name / #name as mentions (nothing pings for them now)
export const TOKENS_SINCE = Date.parse('2026-11-17T00:00:00Z');
// join / leave lines are written "@name hopped in" by the server (its template puts the account there), so their @name is always a
// mention, before tokens or after
const isPersonLine = m => !!m?.system && (m.sys_kind === 'join' || m.sys_kind === 'leave');
export const isLegacyMessage = m => isPersonLine(m) || (!!m?.created_at && new Date(m.created_at).getTime() < TOKENS_SINCE);

// id -> person, from everything Ember has seen: me, server member lists, people, and message authors.
// Rebuilt only when one of those lists changes (by reference), so rendering a lot of mentions stays cheap.
let built = null;
function index() {
  const st = getState();
  if (built && built.members === st.members && built.msgs === st.msgs && built.people === st.people && built.me === st.me && built.conns === connections.size) return built.map;
  const map = new Map();
  const add = (inst, u) => { if (u?.id != null && u.username && !map.has(`${inst}|${u.id}`)) map.set(`${inst}|${u.id}`, u); };
  add(VELORA, st.me);
  for (const [origin, c] of connections) add(origin, c.user);
  for (const [sid, list] of Object.entries(st.members || {})) { const inst = instOf(sid); for (const u of list || []) add(inst, u); }
  for (const u of Object.values(st.people || {})) add(VELORA, u);
  for (const [key, box] of Object.entries(st.msgs || {})) {
    for (const m of box?.list || []) {
      const inst = instOf(m.channel || key.replace(/^c:/, ''));
      add(inst, m.author);
      add(inst, m.reply?.author);
    }
  }
  built = { members: st.members, msgs: st.msgs, people: st.people, me: st.me, conns: connections.size, map };
  return map;
}
// the person a <@id> means on this server (inst = VELORA or an instance origin); sid narrows it to that server's members first
export function userById(id, inst = VELORA, sid = null) {
  id = String(id);
  const st = getState();
  if (sid) { const u = (st.members[sid] || []).find(x => String(x.id) === id); if (u) return u; }
  return index().get(`${inst || VELORA}|${id}`) || null;
}
// my own id where a message lives (for "does this ping me")
export function myIdOn(inst) {
  return inst && inst !== VELORA ? connections.get(inst)?.user?.id ?? null : getState().me?.id ?? null;
}
// a <#cid> -> the channel (any server I'm in on that instance), with its server
export function channelById(cid, inst = VELORA) {
  const st = getState();
  const want = String(cid);
  for (const [sid, d] of Object.entries(st.detail || {})) {
    if (instOf(sid) !== (inst || VELORA)) continue;
    const c = d?.channels?.find(x => bare(x.cid) === want);
    if (c) return { channel: c, server: d.server, sid };
  }
  return null;
}

// message text -> plain text for one-line previews (notifications, inbox rows, the overlay)
export function plainText(body, inst = VELORA, sid = null) {
  return String(body || '')
    .replace(/<@!?((?:[vlb]:)?\d{1,20})>/g, (_, id) => { const u = userById(id, inst, sid); return `@${u ? nameOf(u) : 'unknown-user'}`; })
    .replace(/<#(c[0-9a-f]{10})>/g, (_, cid) => `#${channelById(cid, inst)?.channel.name || 'unknown'}`);
}

// a link to a place in Ember (a channel, or a message in it): { inst, sid, cid, mid } or null.
// Ember's own address (ember.nookara.cc/#/s/...), this page's address, or the old Nookara /chat#/s/... form.
export function parseEmberLink(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  const host = u.host.toLowerCase();
  const ours = host === EMBER_HOST || (typeof location !== 'undefined' && host === location.host) || /(^|\.)nookara\.cc$|^velora\.ikelene\.net$/.test(host);
  if (!ours) return null;
  if (!(u.pathname === '/' || u.pathname === '/chat' || u.pathname === '/chat/')) return null;
  const parts = u.hash.split('/');
  let inst = VELORA, rest = parts.slice(1);
  if (rest[0] === 'i') {
    try { inst = decodeURIComponent(rest[1] || ''); } catch { return null; }
    if (!/^https?:\/\/[^/|]+$/.test(inst)) return null;
    rest = rest.slice(2);
  }
  const [a, sid, cid, mid] = rest;
  if (a !== 's' || !/^s[0-9a-f]{10}$/.test(sid || '') || !/^c[0-9a-f]{10}$/.test(cid || '')) return null;
  if (mid && !/^\d{1,20}$/.test(mid)) return null;
  return { inst, sid: K(inst, sid), cid: K(inst, cid), mid: mid || null, hash: u.hash };
}
