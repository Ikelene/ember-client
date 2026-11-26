import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// api.js reads a little from the browser; give it just enough (before it loads)
function memory() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear() };
}
const local = memory(), session = memory();
globalThis.localStorage = local;
globalThis.location = { hostname: 'localhost', pathname: '/chat', hash: '', origin: 'http://localhost:5173' };
globalThis.screen = { width: 1, height: 1, colorDepth: 24 };

const hs = await import('../src/chat/homeserver.js');
const { openSession, sourceFor, tagFor } = await import('../src/chat/homeAuth.js');
const { socialFetch, social, createDm, socialBase, resetSocialApi } = await import('../src/chat/socialApi.js');
const { registry, hooks } = await import('../src/chat/ids.js');
const { apiFetch } = await import('../src/api.js');

const listen = handler => new Promise(done => {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data ?? {})); };
      handler(req, send, body ? JSON.parse(body) : null, new URL(req.url, 'http://x'));
    });
  });
  srv.listen(0, '127.0.0.1', () => done({ srv, origin: `http://127.0.0.1:${srv.address().port}`, host: `127.0.0.1:${srv.address().port}`, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) }));
});
const bearer = req => String(req.headers.authorization || '').replace(/^Bearer /, '');

// the home homeserver: discovery, refresh, remote-token, and whatever `routes` adds
async function home(routes = () => false, doc = () => ({})) {
  const st = { access: 'home-1', refresh: 'r-1', n: 1, remoteTokens: [], refreshes: 0 };
  const m = await listen((req, send, body, u) => {
    if (u.pathname === '/.well-known/ember') return send(200, { protocol: 1, protocol_version: 2, homeserver: { domain: m.host }, login: { authorize_url: `${m.origin}/login`, token_url: `${m.origin}/api/v2/auth/token`, account_url: `${m.origin}/account` }, federation: { remote_token_url: `${m.origin}/api/v2/auth/remote-token`, remote_url: `${m.origin}/api/v2/auth/remote`, accepts_remote: 'all' }, push: { pushers_url: `${m.origin}/api/v2/pushers` }, ...doc(m) });
    if (u.pathname === '/api/v2/auth/token') {
      if (body?.grant_type !== 'refresh_token' || body.refresh_token !== st.refresh) return send(400, { error: 'invalid_grant' });
      st.n++; st.refreshes++; st.access = `home-${st.n}`; st.refresh = `r-${st.n}`;
      return send(200, { access_token: st.access, refresh_token: st.refresh, expires_in: 3600 });
    }
    if (u.pathname === '/api/v2/auth/remote-token') {
      if (bearer(req) !== st.access) return send(401, { error: 'invalid_session' });
      if (!/^https?:\/\//.test(body?.audience || '')) return send(400, { error: 'invalid_audience' });
      const token = `jwt.${st.remoteTokens.length + 1}.${body.audience}`;
      st.remoteTokens.push({ audience: body.audience, token });
      return send(200, { token, expires_in: 3600 });
    }
    if (routes(req, send, body, u, st) !== false) return undefined;
    return send(404, { error: 'not_found' });
  });
  m.st = st;
  m.signIn = (extra = {}) => {
    local.clear(); session.clear(); resetSocialApi();
    hs.configure({ dev: true, storage: () => local, session: () => session, fetch: (...a) => fetch(...a), timeout: 3000 });
    const s = { origin: m.origin, domain: m.host, name: 'Home', icon_url: null, token_url: `${m.origin}/api/v2/auth/token`, access_token: st.access, refresh_token: st.refresh, expires_at: null, account: { id: 'l:5', username: 'alice', domain: m.host, handle: `alice@${m.host}`, display_name: 'Alice', avatar_url: null }, ...extra };
    local.setItem(hs.SESSIONS_KEY, JSON.stringify({ [m.origin]: s }));
    local.setItem(hs.CURRENT_KEY, m.origin);
    return s;
  };
  return m;
}
// another homeserver: takes home's token at /api/v2/auth/remote, then its API wants the session it gave
async function other({ accepts = 'all' } = {}) {
  const st = { sessions: [], exchanges: [], meCalls: 0, refuse: null };
  const m = await listen((req, send, body, u) => {
    if (u.pathname === '/api/v2/auth/remote') {
      st.exchanges.push(body?.token);
      if (st.refuse) return send(st.refuse.status, { error: st.refuse.error });
      if (!String(body?.token || '').endsWith(m.origin)) return send(401, { error: 'invalid_audience' });
      const access = `sess-${st.exchanges.length}`;
      st.sessions = [access]; // (the one before stops working: what an expired session looks like)
      return send(200, { access_token: access, refresh_token: 'x', expires_in: 3600, token_type: 'Bearer', account: { id: 'l:5@home', username: 'alice', domain: 'home', handle: 'alice@home', display_name: 'Alice', avatar_url: null, remote: true } });
    }
    if (u.pathname === '/api/v1/me') {
      st.meCalls++;
      if (!st.sessions.includes(bearer(req))) return send(401, { error: 'invalid_session' });
      return send(200, { user: { id: 'l:5@home', username: 'alice@home' }, instance_admin: false });
    }
    return send(404, { error: 'not_found' });
  });
  m.st = st;
  m.info = { protocol_version: 2, accounts_mode: 'local', federation: { remote_url: `${m.origin}/api/v2/auth/remote`, accepts_remote: accepts } };
  return m;
}

test('discovery extras: the social API, the account page, where pushers and remote tokens go', async () => {
  const a = await home();
  try {
    a.signIn();
    const info = await hs.homeInfo();
    assert.equal(info.api_url, `${a.origin}/api/v2`); // (no social block: the usual path on the homeserver)
    assert.equal(info.account_url, `${a.origin}/account`);
    assert.equal(info.remote_token_url, `${a.origin}/api/v2/auth/remote-token`);
    assert.equal(info.pushers_url, `${a.origin}/api/v2/pushers`);
  } finally { await a.close(); }
  // addresses that point somewhere else are left out
  const b = await home(undefined, () => ({ social: { api_url: 'http://127.0.0.1:1/api/v2' }, login: { account_url: 'http://127.0.0.1:1/account' }, push: { pushers_url: 'https://evil.example/p' } }));
  try {
    b.signIn();
    const info = await hs.homeInfo();
    assert.equal(info.api_url, `${b.origin}/api/v2`);
    assert.equal(info.account_url, null);
    assert.equal(info.pushers_url, null);
  } finally { await b.close(); }
});

test('the token source per server, with a real session: home, remote, and the Nookara sign-in untouched', async () => {
  const a = await home(), b = await other(), c = await other({ accepts: 'none' });
  try {
    const s = a.signIn();
    assert.equal(sourceFor(a.origin, null, false), 'home');
    assert.equal(sourceFor(b.origin, b.info, false), 'remote');
    assert.equal(sourceFor(c.origin, c.info, false), 'legacy'); // it lets no other homeserver in: its own login, as before
    assert.equal(sourceFor(a.origin, null, true), 'legacy');
    assert.equal(sourceFor(b.origin, b.info, true), 'legacy');
    assert.equal(await openSession(b.origin, b.info, { legacy: true }), null); // (nothing is asked of anyone)
    assert.equal(a.st.remoteTokens.length, 0);
    const mine = await openSession(a.origin, null);
    assert.equal(mine.source, 'home');
    assert.equal(mine.session, s.access_token);
    assert.equal(mine.tag, `hs:home:l:5@${a.host}`);
    assert.equal(tagFor(b.origin, b.info, false), `hs:remote:l:5@${a.host}`);
    // home's token was refused: a refresh, and the new access token
    const again = await openSession(a.origin, null, { renew: true });
    assert.equal(again.session, 'home-2');
    assert.equal(a.st.refreshes, 1);
  } finally { await a.close(); await b.close(); await c.close(); }
});

test('another homeserver: a token from home for it, traded there for a session', async () => {
  const a = await home(), b = await other();
  try {
    a.signIn();
    const r = await openSession(b.origin, b.info);
    assert.equal(r.source, 'remote');
    assert.equal(r.session, 'sess-1');
    assert.equal(r.account.handle, 'alice@home');
    assert.deepEqual(a.st.remoteTokens.map(t => t.audience), [b.origin]);
    assert.deepEqual(b.st.exchanges, [a.st.remoteTokens[0].token]);
    // two at once make one trip
    const [x, y] = await Promise.all([hs.remoteSignIn(b.origin), hs.remoteSignIn(b.origin)]);
    assert.equal(x, y);
    assert.equal(a.st.remoteTokens.length, 2);
    // what the other side says comes back as the error's code
    b.st.refuse = { status: 403, error: 'homeserver_too_new' };
    await assert.rejects(hs.remoteSignIn(b.origin), e => e.code === 'homeserver_too_new' && e.status === 403);
    // never to itself, and never to an address that is not that homeserver's
    await assert.rejects(hs.remoteToken(a.origin), e => e.code === 'own_homeserver');
    await assert.rejects(hs.remoteExchange(b.origin, 'jwt', `${a.origin}/api/v2/auth/remote`), e => e.code === 'bad_url');
  } finally { await a.close(); await b.close(); }
});

test('a home access token that ran out: the remote token request refreshes it and goes again', async () => {
  const a = await home(), b = await other();
  try {
    a.signIn();
    a.st.access = 'home-expired-elsewhere'; // what we hold is no good any more
    const r = await hs.remoteSignIn(b.origin);
    assert.equal(r.access_token, 'sess-1');
    assert.equal(a.st.refreshes, 1);
    assert.equal(hs.currentSession().access_token, a.st.access);
  } finally { await a.close(); await b.close(); }
});

test('a 401 from the other homeserver: the dance once more, then the request again (and only once)', async () => {
  const a = await home(), b = await other();
  try {
    a.signIn();
    const first = await openSession(b.origin, b.info);
    registry.set(b.origin, { origin: b.origin, session: first.session });
    let renewals = 0;
    hooks.refresh = async origin => { // (what instances.js does with it)
      renewals++;
      const r = await openSession(origin, b.info, { renew: true }).catch(() => null);
      if (!r) { registry.delete(origin); return false; }
      registry.set(origin, { origin, session: r.session });
      return true;
    };
    assert.equal((await apiFetch('/api/v1/me', { inst: b.origin })).user.id, 'l:5@home');
    assert.equal(renewals, 0);
    b.st.sessions = []; // the session ended there
    assert.equal((await apiFetch('/api/v1/me', { inst: b.origin })).user.id, 'l:5@home');
    assert.equal(renewals, 1);
    assert.equal(a.st.remoteTokens.length, 2);
    assert.equal(registry.get(b.origin).session, 'sess-2');
    // still refused after a fresh session: no loop, the 401 comes back
    const calls = b.st.meCalls;
    const real = b.st.sessions; Object.defineProperty(b.st, 'sessions', { get: () => [], set: () => {}, configurable: true });
    await assert.rejects(apiFetch('/api/v1/me', { inst: b.origin }), e => e.status === 401);
    assert.equal(renewals, 2);
    assert.equal(b.st.meCalls, calls + 2);
    Object.defineProperty(b.st, 'sessions', { value: real, writable: true, configurable: true });
    // the other homeserver stopped letting us in: the renewal fails and so does the request
    b.st.refuse = { status: 403, error: 'homeserver_not_allowed' };
    b.st.sessions = [];
    await assert.rejects(apiFetch('/api/v1/me', { inst: b.origin }), e => e.status === 401);
    assert.equal(registry.has(b.origin), false);
  } finally { hooks.refresh = null; registry.clear(); await a.close(); await b.close(); }
});

test('the social API is where discovery says, with the home session', async () => {
  // nookara.cc accounts: the session is on the homeserver (a), friends and DMs are at the domain itself (n)
  const seen = [];
  const n = await listen((req, send, body, u) => {
    seen.push(`${req.method} ${u.pathname}${u.search} ${bearer(req)}`);
    if (u.pathname === '/api/v2/social/friends' && req.method === 'GET') return send(200, { friends: [{ id: 'l:6', handle: 'bob@x', display_name: 'bob', avatar_url: null }], incoming: [], outgoing: [], blocked: [] });
    if (u.pathname === '/api/v2/social/friends' && req.method === 'POST') return send(body.handle === 'nobody' ? 404 : 200, body.handle === 'nobody' ? { error: 'user_not_found' } : { status: 'pending', friend: { id: 'l:9@b.example', handle: body.handle } });
    return send(404, { error: 'not_found' });
  });
  const a = await home(undefined, () => ({ social: { api_url: `${n.origin}/api/v2`, s2s_url: `${n.origin}/_ember/s2s/v1` } }));
  try {
    a.signIn({ domain: n.host });
    assert.equal(await socialBase(), `${n.origin}/api/v2`);
    assert.equal((await social.friends()).friends[0].id, 'l:6');
    assert.equal((await social.addFriend({ handle: 'carol@b.example' }, 'hi')).status, 'pending');
    await assert.rejects(social.addFriend({ handle: 'nobody' }), e => e.message === 'user_not_found' && e.status === 404);
    assert.deepEqual(seen, ['GET /api/v2/social/friends home-1', 'POST /api/v2/social/friends home-1', 'POST /api/v2/social/friends home-1']);
  } finally { await a.close(); await n.close(); }
});

test('409 social_elsewhere: the call moves to the api_url it names, and stays there', async () => {
  const seenN = [];
  const n = await listen((req, send, body, u) => { seenN.push(`${req.method} ${u.pathname} ${bearer(req)}`); return u.pathname === '/api/v2/social/dms' ? send(200, { dms: [] }) : u.pathname === '/api/v2/social/friends' ? send(200, { friends: [], incoming: [], outgoing: [], blocked: [] }) : send(404, { error: 'not_found' }); });
  const x = await listen((req, send) => send(200, { dms: [{ id: 'stolen' }] })); // not this homeserver's: must never be asked
  let asked = 0, where = () => `${n.origin}/api/v2/`;
  const a = await home((req, send, body, u) => (u.pathname.startsWith('/api/v2/social/') ? (asked++, send(409, { error: 'social_elsewhere', api_url: where() })) : false));
  try {
    a.signIn({ domain: n.host });
    assert.equal(await socialBase(), `${a.origin}/api/v2`); // (discovery has no social block here)
    assert.deepEqual(await social.dms(), { dms: [] });
    assert.equal(asked, 1);
    assert.equal(await socialBase(), `${n.origin}/api/v2`);
    await social.friends(); // the next call goes straight there
    assert.equal(asked, 1);
    assert.deepEqual(seenN, ['GET /api/v2/social/dms home-1', 'GET /api/v2/social/friends home-1']);
    // an api_url that is neither the homeserver nor its domain: the token does not go there
    resetSocialApi();
    where = () => `${x.origin}/api/v2`;
    await assert.rejects(social.dms(), e => e.message === 'social_elsewhere' && e.status === 409);
    assert.equal(await socialBase(), `${a.origin}/api/v2`);
  } finally { await a.close(); await n.close(); await x.close(); }
});

test('409 create_on_homeserver: the same POST goes to the url it names, on the homeserver the session is on', async () => {
  const made = [];
  let target = null;
  const n = await listen((req, send, body, u) => {
    if (u.pathname === '/api/v2/social/dms' && req.method === 'POST') {
      if (body.members.some(m => m.includes('@'))) return send(409, { error: 'create_on_homeserver', url: target });
      return send(200, { dm: { id: 'n1@n', members: [] }, created: true });
    }
    return send(404, { error: 'not_found' });
  });
  const a = await home((req, send, body, u) => {
    if (u.pathname === '/api/v2/social/dms' && req.method === 'POST') { made.push({ body, token: bearer(req) }); return send(body.members.includes('blocked@b.example') ? 403 : 200, body.members.includes('blocked@b.example') ? { error: 'dm_not_allowed', member: 'blocked@b.example' } : { dm: { id: 'd1@a', members: [] }, created: true }); }
    return false;
  }, () => ({ social: { api_url: `${n.origin}/api/v2` } }));
  try {
    a.signIn({ domain: n.host });
    target = `${a.origin}/api/v2/social/dms`;
    // only people of the same domain: made where the social API is
    assert.equal((await createDm({ members: ['bob'] })).dm.id, 'n1@n');
    assert.equal(made.length, 0);
    // someone from another homeserver: made on the homeserver, same body, home session
    const body = { members: ['carol@b.example', 'bob'], name: 'Camp', group: true };
    const r = await createDm(body);
    assert.equal(r.dm.id, 'd1@a');
    assert.equal(r.created, true);
    assert.deepEqual(made, [{ body, token: 'home-1' }]);
    // what the homeserver answers there is the answer
    await assert.rejects(createDm({ members: ['blocked@b.example'] }), e => e.message === 'dm_not_allowed' && e.status === 403 && e.member === 'blocked@b.example');
    // a url that is not this homeserver's is not followed
    target = 'http://127.0.0.1:9/api/v2/social/dms';
    await assert.rejects(createDm({ members: ['carol@b.example'] }), e => e.message === 'create_on_homeserver' && e.status === 409);
    assert.equal(made.length, 2);
  } finally { await a.close(); await n.close(); }
});
