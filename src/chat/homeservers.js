// Every server on the rail lives on a homeserver (a domain such as nookara.cc). Here: the plain facts the server menu and
// Settings > Homeservers need about those homeservers, worked out from the v2 sign-ins (homeserver.js sessions()) and the
// connections (instances.js instView). Pure, no imports (the node tests load it).

const hostOf = o => { try { return new URL(o).host; } catch { return String(o || '').replace(/^https?:\/\//, ''); } };
// the homeserver a server is on: what the homeserver calls itself, else the server's address, else the host
export function homeDomainOf(inst, srv) {
  return inst?.homeserver?.domain || String(srv?.address || '').split('@')[1] || inst?.host || hostOf(inst?.origin);
}

// what a server's menu says about its homeserver: null while it is connected (or on its way), else what to offer
// -> null | { action: 'reconnect' | 'signin', hint }
export function homeLine(inst) {
  if (!inst) return null;
  if (inst.sleep) return { action: 'reconnect', hint: inst.sleep === 'manual' ? 'You disconnected it' : 'Asleep (sleep mode)' };
  if (inst.status === 'open' || inst.status === 'connecting') return null;
  if (inst.status === 'login') return { action: 'signin', hint: 'Signed out' };
  if (inst.status === 'asleep') return { action: 'reconnect', hint: 'Asleep (sleep mode)' };
  if (inst.status === 'restricted') return { action: 'reconnect', hint: 'Ember is off for your account' };
  if (inst.status === 'banned') return null; // (nothing to retry)
  return { action: 'reconnect', hint: inst.status === 'error' ? "Can't connect" : 'Not connected' };
}

// a row's status: [tone, words]
export function statusOf(inst, session) {
  if (!inst) return session ? ['ok', 'Signed in'] : ['', 'Not connected'];
  if (inst.sleep === 'manual') return ['warn', 'Disconnected'];
  if (inst.sleep || inst.status === 'asleep') return ['', 'Asleep'];
  switch (inst.status) {
    case 'open': return ['ok', 'Connected'];
    case 'connecting': return ['', 'Connecting...'];
    case 'login': return ['warn', 'Signed out'];
    case 'restricted': return ['warn', 'Ember is off for your account'];
    case 'banned': return ['warn', 'Banned'];
    case 'error': return ['warn', "Can't connect"];
    default: return ['warn', 'Not connected'];
  }
}

// Settings > Homeservers: one row per homeserver this device is signed in to or connected to.
// sessions: [{ origin, domain, name, icon_url, account: { handle } }], instances: instView[], servers: [{ inst, name }],
// opts.homeHandle: my account's handle where a homeserver signs me in from elsewhere (my home, or Nookara)
// -> [{ origin, domain, name, icon_url, handle, session, inst, status: [tone, words], servers: [names], legacy }]
export function homeserverRows(sessions, instances, servers, { homeHandle = null, norm = o => o } = {}) {
  const rows = new Map();
  for (const s of sessions || []) {
    const origin = norm(s.origin);
    if (!origin) continue;
    rows.set(origin, { origin, domain: s.domain, name: s.name || s.domain, icon_url: s.icon_url || null, handle: s.account?.handle || null, session: true, inst: null });
  }
  for (const i of instances || []) {
    if (i.quiet && i.source !== 'home') continue; // (only there for a DM)
    const had = rows.get(i.origin);
    const domain = had?.domain || i.homeserver?.domain || i.host || hostOf(i.origin);
    const own = i.user?.username && !i.viaNookara && i.source !== 'remote' ? `${i.user.username}@${domain}` : null;
    rows.set(i.origin, {
      origin: i.origin, domain,
      name: had?.name || i.homeserver?.name || (i.v2 ? domain : i.community?.name || i.name) || domain,
      icon_url: had?.icon_url || i.homeserver?.icon_url || i.icon || null,
      handle: had?.handle || own || (i.user || i.viaNookara || i.source ? homeHandle : null),
      session: !!had, inst: i,
    });
  }
  return [...rows.values()].map(r => ({
    ...r,
    status: statusOf(r.inst, r.session),
    servers: (servers || []).filter(x => x.inst === r.origin).map(x => x.name),
    legacy: !!r.inst && !r.inst.v2,
  }));
}

// the words of the Forget confirmation: what leaves the rail with it
export function forgetText(row) {
  const n = row.servers.length;
  const list = n ? (n <= 3 ? row.servers.join(', ') : `${row.servers.slice(0, 3).join(', ')} and ${n - 3} more`) : '';
  return `${n ? `${n === 1 ? 'Your server' : `Your ${n} servers`} on it (${list}) ${n === 1 ? 'leaves' : 'leave'} your server list. ` : ''}${row.session ? `Ember signs out of ${row.domain} on this device. ` : ''}Your account and your servers there stay as they are - you can add ${row.domain} again any time.`;
}

// Settings > Homeservers is there for everyone whose device uses a homeserver (not only its admins)
export const showHomeservers = ({ connections = 0, home = false, admin = false, signedIn = false } = {}) => connections > 0 || !!home || !!admin || !!signedIn;
