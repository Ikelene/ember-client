// Ember Protocol v2, the parts around a homeserver session (PROTOCOL 4b, 4c, 20): which token a server gets, how handles are
// shown, the friends / DM lists a homeserver's social API answers with, the gateway's social events, and who gets a pusher.
// Pure: no imports, nothing from the browser (the node tests run it as is).

// ── which sign-in a server gets ──
// legacy: Ember's Nookara token is there (a Nookara session). home: the home homeserver's origin (a v2 session).
// info: the server's discovery document. -> 'legacy' (instance token / its own login, as before) | 'home' (the home session's
// access token) | 'remote' (a token from home, traded there: 4b) | 'nookara' (a Nookara session on a v2 homeserver that lets
// other homeservers' accounts in: the same trade, with a token Nookara signs)
// ownLogin: I already signed in there with an account of its own (kept: nothing is traded over it)
export function remoteUrlOf(origin, info) {
  const f = info?.federation;
  if (!f || typeof f !== 'object' || typeof f.remote_url !== 'string' || f.accepts_remote === 'none') return null;
  try { const u = new URL(f.remote_url, `${origin}/`); return u.origin === origin && !u.username && !u.password ? u.href : null; } catch { return null; }
}
// a server that takes Nookara's instance token: one in Nookara-accounts mode, or a homeserver whose accounts are Nookara's
export const takesNookara = info => info?.accounts_mode === 'nookara' || info?.accounts_mode === 'velora' || info?.accounts?.nookara_identity === true;
export function tokenSource({ legacy, home, origin, info, ownLogin = false }) {
  if (legacy) return origin && !ownLogin && !takesNookara(info) && Number(info?.protocol_version) >= 2 && remoteUrlOf(origin, info) ? 'nookara' : 'legacy';
  if (!home || !origin) return 'legacy';
  if (origin === home) return 'home';
  return remoteUrlOf(origin, info) ? 'remote' : 'legacy';
}
// the tag a stored session carries, so one account's session is never used by the next one signed in on this browser
export const sessionTag = (source, account) => (source === 'legacy' || !account ? null : `hs:${source}:${account.id ?? ''}@${account.domain ?? ''}`);
// the same for a session a Nookara token was traded for (key: what stands for that Nookara sign-in)
export const nookaraTag = key => (key ? `nk:${key}` : null);
export const isTradedTag = tag => /^(hs|nk):/.test(String(tag || ''));

// ── ids and handles ──
// 'l:5@a.example' / 'alice@a.example' -> { name, domain } (domain '' when there is none)
export function splitHandle(h) {
  const s = String(h ?? '').trim().replace(/^@/, '');
  const at = s.lastIndexOf('@');
  return at > 0 ? { name: s.slice(0, at), domain: s.slice(at + 1).toLowerCase() } : { name: s, domain: '' };
}
export const isRemoteId = id => /^[A-Za-z0-9._:-]{1,64}@[a-z0-9.-]+(:\d{1,5})?$/i.test(String(id ?? ''));
// an id as the homeserver that owns `domain` knows it: 'l:7' there is 'l:7@domain' everywhere else
export const stableId = (id, domain) => { const s = String(id ?? ''); return !s || s.includes('@') || !domain ? s : `${s}@${domain}`; };
export const sameAccount = (a, b, domain) => !!a && !!b && stableId(a, domain) === stableId(b, domain);
// username@domain, without the domain for people on my own homeserver. account: { handle, id, username?, domain? }
export function shownHandle(account, myDomain) {
  if (!account) return '';
  let { name, domain } = splitHandle(account.handle || '');
  if (!name) { name = String(account.username || ''); domain = String(account.domain || splitHandle(account.id).domain || '').toLowerCase(); if (name.includes('@')) ({ name, domain } = splitHandle(name)); }
  if (!name) return '';
  return !domain || domain === String(myDomain || '').toLowerCase() ? name : `${name}@${domain}`;
}
export const accountName = (account, myDomain) => String(account?.display_name || '').trim() || shownHandle(account, myDomain) || String(account?.id || '');
// what was typed into "add a friend": 'alice', '@alice', 'alice@b.example' -> the handle to send, or '' when it can't be one
export function cleanHandle(input, myDomain) {
  const { name, domain } = splitHandle(input);
  if (!name || /[\s@/]/.test(name) || name.length > 64 || (!domain && String(input).trim().replace(/^@/, '').includes('@'))) return '';
  if (domain && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(domain)) return '';
  return !domain || domain === String(myDomain || '').toLowerCase() ? name : `${name}@${domain}`;
}

// ── friends ──
const people = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.id != null).map(x => ({ ...x, id: String(x.id) })) : []);
// GET /social/friends -> the four lists, each sorted by name
export function friendLists(d, myDomain) {
  const by = (a, b) => accountName(a, myDomain).localeCompare(accountName(b, myDomain), undefined, { sensitivity: 'base' });
  return { friends: people(d?.friends).sort(by), incoming: people(d?.incoming).sort(by), outgoing: people(d?.outgoing).sort(by), blocked: people(d?.blocked).sort(by) };
}

// ── DMs ──
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
// one DM as the lists keep it. from = the origin of the homeserver that answered, home = my homeserver's origin, me = my stable id
export function cleanDm(dm, { from = null, home = null, me = null, domain = '' } = {}) {
  if (!dm || typeof dm !== 'object' || typeof dm.id !== 'string' || !dm.id) return null;
  const host = String(dm.host || splitHandle(dm.id).domain || '').toLowerCase();
  let host_origin = null;
  try { host_origin = dm.host_origin ? new URL(dm.host_origin).origin : null; } catch { host_origin = null; }
  if (!host_origin && dm.hosted_here && from) host_origin = from;
  const members = people(dm.members);
  const others = members.filter(m => !sameAccount(m.id, me, domain));
  return {
    id: dm.id, host, host_origin, hosted_here: !!host_origin && host_origin === home,
    group: !!dm.group, name: typeof dm.name === 'string' && dm.name.trim() ? dm.name.trim() : null, owner: dm.owner != null ? String(dm.owner) : null,
    sid: dm.sid != null ? String(dm.sid) : null, channel: dm.channel != null ? String(dm.channel) : null,
    members, others,
    created_at: num(dm.created_at), updated_at: num(dm.updated_at) || num(dm.created_at),
    last_message_id: dm.last_message_id != null ? String(dm.last_message_id) : null,
    unread: Math.max(0, Math.floor(num(dm.unread))), mention: !!dm.mention,
    ...(typeof dm.preview === 'string' ? { preview: dm.preview } : {}),
  };
}
export const dmTitle = (dm, myDomain) => dm?.name || (dm?.others?.length ? dm.others.map(m => accountName(m, myDomain)).join(', ') : dm?.group ? 'Group chat' : 'Just you');
const newest = (a, b) => (b.updated_at - a.updated_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const sortDms = list => [...list].sort(newest);
// Lists from one or more homeservers -> one list, newest activity first. sources: [{ origin, dms }], home's own list first or
// not: what home says about unread / mention wins (it is what the pointer counts), a host fills in what a pointer lacks
export function mergeDms(sources, ctx = {}) {
  const out = new Map();
  for (const src of sources || []) {
    const mine = src?.origin === ctx.home;
    for (const raw of Array.isArray(src?.dms) ? src.dms : []) {
      const dm = cleanDm(raw, { ...ctx, from: src.origin });
      if (!dm) continue;
      const old = out.get(dm.id);
      if (!old) { out.set(dm.id, { ...dm, _home: mine }); continue; }
      const base = mine ? dm : old, extra = mine ? old : dm;
      out.set(dm.id, {
        ...base,
        host_origin: base.host_origin || extra.host_origin, hosted_here: base.hosted_here || extra.hosted_here,
        sid: base.sid || extra.sid, channel: base.channel || extra.channel,
        members: base.members.length ? base.members : extra.members, others: base.others.length ? base.others : extra.others,
        name: base.name || extra.name, updated_at: Math.max(base.updated_at, extra.updated_at),
        last_message_id: base.last_message_id || extra.last_message_id,
        ...(old._home || mine ? {} : { unread: Math.max(base.unread, extra.unread), mention: base.mention || extra.mention }),
        _home: old._home || mine,
      });
    }
  }
  return sortDms([...out.values()].map(({ _home, ...dm }) => dm));
}
// ── a Nookara session (the Nookara sign-in, not a homeserver's) ──
// Nookara's own friends, DMs and groups stay where they are (its own API and UI, end-to-end encrypted). Its /api/v2/social
// answers with those too, next to what is on other homeservers; the client takes only the second kind from it.
// a Nookara account's id: v:<n>@<my domain> (or v:<n>)
export const isNookaraAccount = (id, myDomain) => { const { name, domain } = splitHandle(id); return /^v:[1-9]\d{0,18}$/.test(name) && (!domain || domain === String(myDomain || '').toLowerCase()); };
// GET /social/friends -> the four lists with only the people who are not Nookara accounts
export function remoteFriendLists(d, myDomain) {
  const l = friendLists(d, myDomain), far = x => !isNookaraAccount(x.id, myDomain);
  return { friends: l.friends.filter(far), incoming: l.incoming.filter(far), outgoing: l.outgoing.filter(far), blocked: l.blocked.filter(far) };
}
// where a DM the social API answered with opens: Nookara's own DM or group view ({ nookara: { kind, username | room } }), or
// the homeserver it is on (a pointer)
export function nookaraDmView(dm) {
  const n = dm?.nookara;
  if (n && typeof n === 'object') return n.kind === 'im' && typeof n.username === 'string' && n.username ? { kind: 'dm', username: n.username } : n.kind === 'group' && typeof n.room === 'string' && n.room ? { kind: 'group', room: n.room } : null;
  return dm && dm.hosted_here !== true && typeof dm.id === 'string' && dm.id ? { kind: 'sdm', id: dm.id } : null;
}
// GET /social/dms -> { pointers: the DMs on other homeservers (as sent), hosted: [{ id, view }] Nookara's own }
export function splitNookaraDms(d) {
  const pointers = [], hosted = [];
  for (const dm of Array.isArray(d?.dms) ? d.dms : []) {
    const view = nookaraDmView(dm);
    if (view?.kind === 'sdm') pointers.push(dm); else if (view) hosted.push({ id: dm.id, view });
  }
  return { pointers, hosted };
}
const ms = v => { const n = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(n) && n > 0 ? (n < 1e11 ? n * 1000 : n) : 0; };
// the DM list: Nookara's conversations (convs: newest first, as GET /im/conversations gives them; their order is kept) with the
// pointers slotted in by when they were last active. -> [{ kind: 'dm', c, at } | { kind: 'sdm', dm, at }]
export function nookaraDmRows(convs, pointers) {
  const a = (convs || []).map(c => ({ kind: 'dm', c, at: ms(c?.last_message?.sent_at) }));
  const b = sortDms(pointers || []).map(dm => ({ kind: 'sdm', dm, at: ms(dm.updated_at) }));
  const out = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) out.push(j >= b.length || (i < a.length && a[i].at >= b[j].at) ? a[i++] : b[j++]);
  return out;
}
export const dmUnread = dms => (dms || []).reduce((n, d) => n + (d.unread || 0), 0);
export const dmMentions = dms => (dms || []).filter(d => d.mention).length;

// ── the gateway's social events (7, 4c) ──
export const SOCIAL_EVENTS = new Set(['social_friends_update', 'social_presence', 'social_dm_update', 'social_dm_remove', 'social_dm_activity']);
export const emptySocial = () => ({ loaded: false, friends: [], incoming: [], outgoing: [], blocked: [], dms: [], presence: {} });
// s = { friends, incoming, outgoing, blocked, dms, presence }, ev = the frame, ctx = { from (the origin it came from), home, me,
// domain, open (the DM on screen: its messages are being read), now } -> the next s (the same object when nothing changed)
export function socialReduce(s, ev, ctx = {}) {
  if (!s || !ev || typeof ev !== 'object') return s;
  if (ev.type === 'social_presence') {
    const id = stableId(ev.id, ctx.domain), status = ['online', 'idle', 'dnd', 'offline'].includes(ev.status) ? ev.status : 'offline';
    if (!id || s.presence[id] === status) return s;
    return { ...s, presence: { ...s.presence, [id]: status } };
  }
  if (ev.type === 'social_dm_update') {
    const dm = cleanDm(ev.dm, ctx);
    if (!dm) return s;
    const old = s.dms.find(d => d.id === dm.id);
    // a host's copy of a DM my homeserver points at: its unread is not mine to take (the pointer counts)
    const keep = old && ctx.from && ctx.from !== ctx.home ? { unread: old.unread, mention: old.mention, hosted_here: old.hosted_here } : {};
    const next = { ...(old || {}), ...dm, ...keep, host_origin: dm.host_origin || old?.host_origin || null, sid: dm.sid || old?.sid || null, channel: dm.channel || old?.channel || null, updated_at: Math.max(dm.updated_at, old?.updated_at || 0) };
    if (ctx.open === dm.id) { next.unread = 0; next.mention = false; }
    return { ...s, dms: sortDms([...s.dms.filter(d => d.id !== dm.id), next]) };
  }
  if (ev.type === 'social_dm_remove') {
    const id = typeof ev.id === 'string' ? ev.id : ev.dm?.id;
    return s.dms.some(d => d.id === id) ? { ...s, dms: s.dms.filter(d => d.id !== id) } : s;
  }
  if (ev.type === 'social_dm_activity') {
    const id = typeof ev.dm === 'string' ? ev.dm : ev.dm?.id;
    const full = ev.dm && typeof ev.dm === 'object' ? cleanDm(ev.dm, ctx) : null;
    const old = s.dms.find(d => d.id === id);
    if (!old && !full) return s;
    const seen = ctx.open === id;
    const count = Math.max(1, Math.floor(num(ev.count)) || 1);
    const next = {
      ...(old || {}), ...(full || {}),
      // the frame carries the DM as the pointer is now (already counted) when it is an object; a bare id is one more
      unread: seen ? 0 : full ? full.unread : (old?.unread || 0) + count,
      mention: seen ? false : !!(full?.mention || old?.mention || ev.mention),
      updated_at: Math.max(full?.updated_at || 0, old?.updated_at || 0, num(ctx.now)),
      last_message_id: ev.last_message_id != null ? String(ev.last_message_id) : full?.last_message_id || old?.last_message_id || null,
      ...(typeof ev.preview === 'string' ? { preview: ev.preview } : {}),
      ...(ev.sender && typeof ev.sender === 'object' ? { sender: { id: String(ev.sender.id ?? ''), display_name: String(ev.sender.display_name ?? '') } } : {}),
    };
    return { ...s, dms: sortDms([...s.dms.filter(d => d.id !== id), next]) };
  }
  return s;
}
// what a frame means the client has to ask for again
export const socialRefetch = ev => (ev?.type === 'social_friends_update' ? 'friends' : null);

// ── push (20) ──
// instances: [{ origin, info, signedIn, relayPush }] (relayPush: Nookara's relay may push for it to this account).
// -> { register: [{ origin, url }], relayOff: [origin] }: a pusher goes to every homeserver I'm signed in on that takes them,
// and the old relay push is switched off for exactly those (or each notification would come twice)
export function pushersUrlOf(origin, info) {
  const u = info?.push?.pushers_url;
  if (typeof u !== 'string' || !u) return null;
  try { const url = new URL(u, `${origin}/`); return url.origin === origin && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function pushPlan({ v2, pushkey, instances, registered = [] }) {
  if (!v2 || !pushkey) return { register: [], relayOff: [] };
  const can = (instances || []).filter(i => i && i.signedIn && pushersUrlOf(i.origin, i.info));
  return {
    register: can.map(i => ({ origin: i.origin, url: pushersUrlOf(i.origin, i.info) })),
    // only once the pusher is really there: a failed registration must not leave the server with no way to reach me
    relayOff: can.filter(i => i.relayPush && registered.includes(i.origin)).map(i => i.origin),
  };
}
