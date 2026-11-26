import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import * as hs from '../src/chat/homeserver.js';

// a Storage that lives in memory
function memory() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, clear: () => m.clear(), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null };
}
const local = memory(), session = memory();
const fresh = (extra = {}) => { local.clear(); session.clear(); hs.configure({ dev: true, storage: () => local, session: () => session, fetch: (...a) => fetch(...a), timeout: 3000, ...extra }); };

const listen = handler => new Promise(done => {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const send = (status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(data == null ? '' : JSON.stringify(data)); };
      handler(req, send, body);
    });
  });
  srv.listen(0, '127.0.0.1', () => done({ srv, origin: `http://127.0.0.1:${srv.address().port}`, host: `127.0.0.1:${srv.address().port}`, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) }));
});
const s256 = v => createHash('sha256').update(v).digest('base64url');

// A mock homeserver speaking the v2 login contract: discovery, /authorize (answers with the redirect a logged-in user
// would get), /token (authorization_code with PKCE, refresh_token with rotation) and one API route behind the access token.
async function mockHomeserver({ domain, rotate = true } = {}) {
  const codes = new Map(), st = { access: null, refresh: null, tokenCalls: [], apiCalls: 0, n: 0, refuseRefresh: false, alwaysDeny: false };
  const issue = () => { st.n++; st.access = `at-${st.n}-${randomBytes(4).toString('hex')}`; if (rotate || !st.refresh) st.refresh = `rt-${st.n}-${randomBytes(4).toString('hex')}`; return { access_token: st.access, refresh_token: st.refresh, expires_in: 3600 }; };
  const m = await listen((req, send, body) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/.well-known/ember') return send(200, { protocol: 2, homeserver: { domain: domain?.() || m.host, name: 'Mock Home', icon_url: '/icon.png' }, login: { authorize_url: `${m.origin}/authorize`, token_url: `${m.origin}/token`, methods: [{ id: 'password', kind: 'password', name: 'Password' }] } });
    if (u.pathname === '/authorize') {
      const q = u.searchParams;
      if (q.get('response_type') !== 'code' || q.get('client_id') !== 'ember' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state')) return send(400, { error: 'invalid_request' });
      const code = randomBytes(8).toString('hex');
      codes.set(code, { challenge: q.get('code_challenge'), redirect_uri: q.get('redirect_uri'), user: q.get('login_hint') || 'alice' });
      const back = new URL(q.get('redirect_uri')); back.searchParams.set('code', code); back.searchParams.set('state', q.get('state'));
      return send(302, null, { Location: back.href });
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      const b = JSON.parse(body || '{}');
      st.tokenCalls.push(b);
      if (b.client_id !== 'ember') return send(400, { error: 'invalid_client' });
      if (b.grant_type === 'authorization_code') {
        const c = codes.get(b.code); codes.delete(b.code);
        if (!c || c.redirect_uri !== b.redirect_uri || s256(b.code_verifier || '') !== c.challenge) return send(400, { error: 'invalid_grant', error_description: 'bad code or verifier' });
        return send(200, { ...issue(), account: { id: 7, username: c.user, domain: domain?.() || m.host, handle: `${c.user}@${domain?.() || m.host}`, display_name: 'Alice', avatar_url: null } });
      }
      if (b.grant_type === 'refresh_token') {
        if (st.refuseRefresh || !b.refresh_token || b.refresh_token !== st.refresh) return send(400, { error: 'invalid_grant' });
        return send(200, issue());
      }
      return send(400, { error: 'unsupported_grant_type' });
    }
    if (u.pathname === '/api/me') {
      st.apiCalls++;
      if (st.alwaysDeny || req.headers.authorization !== `Bearer ${st.access}`) return send(401, { error: 'invalid_token' });
      return send(200, { ok: true });
    }
    send(404, { error: 'not_found' });
  });
  m.st = st;
  // what a browser does between startLogin and the callback: follow the login page to the redirect, read code + state
  m.login = async (info, { hint } = {}) => {
    const verifier = hs.randomToken(32), state = hs.randomToken(24), redirect_uri = 'http://localhost:5173/auth/callback.html';
    const url = hs.authorizeUrl(info, { redirect_uri, state, challenge: await hs.pkceChallenge(verifier), hint });
    const r = await fetch(url, { redirect: 'manual' });
    const back = new URL(r.headers.get('location'));
    assert.equal(back.searchParams.get('state'), state);
    return { code: back.searchParams.get('code'), verifier, redirect_uri, state };
  };
  return m;
}

test('what can be typed: a domain, a URL, a handle', () => {
  fresh({ dev: false });
  assert.deepEqual(hs.parseHomeserver('example.org'), { domain: 'example.org', hint: '', origin: 'https://example.org' });
  assert.deepEqual(hs.parseHomeserver('  HTTPS://Example.org/some/path?x=1 '), { domain: 'example.org', hint: '', origin: 'https://example.org' });
  assert.deepEqual(hs.parseHomeserver('alice@example.org'), { domain: 'example.org', hint: 'alice', origin: 'https://example.org' });
  assert.deepEqual(hs.parseHomeserver('@Alice.B@chat.example.org'), { domain: 'chat.example.org', hint: 'Alice.B', origin: 'https://chat.example.org' });
  assert.deepEqual(hs.parseHomeserver('example.org:8443'), { domain: 'example.org:8443', hint: '', origin: 'https://example.org:8443' });
  assert.equal(hs.handleOf('alice', 'example.org'), 'alice@example.org');
  for (const bad of ['', '   ', 'example', 'http://example.org', 'ftp://example.org', 'https://user:pw@example.org', 'a b.org', 'alice@', '@example', 'a@b@', '-bad.org', 'exa_mple.org', 'javascript:alert(1)', 'localhost', 'localhost:3000', 'http://127.0.0.1:3000', 'alice@localhost']) assert.equal(hs.parseHomeserver(bad), null, bad);
});

test('localhost only counts in dev builds', () => {
  fresh({ dev: true });
  assert.deepEqual(hs.parseHomeserver('localhost:3000'), { domain: 'localhost:3000', hint: '', origin: 'http://localhost:3000' });
  assert.deepEqual(hs.parseHomeserver('bob@127.0.0.1:8080'), { domain: '127.0.0.1:8080', hint: 'bob', origin: 'http://127.0.0.1:8080' });
  assert.equal(hs.parseHomeserver('http://example.org'), null);
  assert.equal(hs.safeUrl('http://localhost:1/x').href, 'http://localhost:1/x');
  assert.equal(hs.safeUrl('http://example.org/x'), null);
  fresh({ dev: false });
  assert.equal(hs.safeUrl('http://localhost:1/x'), null);
  assert.equal(hs.safeUrl('http://127.0.0.1/x'), null);
  assert.equal(hs.safeUrl('https://example.org/x').origin, 'https://example.org');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//', '', null, 'https://u:p@example.org/', 'ws://example.org']) assert.equal(hs.safeUrl(bad), null, String(bad));
});

test('PKCE: the S256 challenge of the RFC 7636 verifier, and verifiers of the right shape', async () => {
  assert.equal(await hs.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const v = hs.randomToken(32);
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(v, hs.randomToken(32));
});

test('the authorize link carries the whole request', () => {
  fresh();
  const u = new URL(hs.authorizeUrl({ authorize_url: 'https://chat.example.org/authorize?theme=dark' }, { redirect_uri: 'https://ember.example/auth/callback.html', state: 'st', challenge: 'ch', hint: 'alice' }));
  assert.equal(u.origin + u.pathname, 'https://chat.example.org/authorize');
  assert.deepEqual(Object.fromEntries(u.searchParams), { theme: 'dark', response_type: 'code', client_id: 'ember', redirect_uri: 'https://ember.example/auth/callback.html', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256', login_hint: 'alice' });
  assert.equal(new URL(hs.authorizeUrl({ authorize_url: 'https://chat.example.org/authorize' }, { redirect_uri: 'r', state: 's', challenge: 'c' })).searchParams.has('login_hint'), false);
  assert.throws(() => hs.authorizeUrl({ authorize_url: 'http://chat.example.org/authorize' }, { redirect_uri: 'r', state: 's', challenge: 'c' }), { code: 'bad_url' });
});

test('resolve: a domain that is its own homeserver', async () => {
  fresh();
  const m = await mockHomeserver();
  try {
    const r = await hs.resolve(m.host);
    assert.deepEqual(r, { domain: m.host, origin: m.origin, name: 'Mock Home', icon_url: `${m.origin}/icon.png`, authorize_url: `${m.origin}/authorize`, token_url: `${m.origin}/token`, methods: [{ id: 'password', kind: 'password', name: 'Password' }], protocol: 2 });
    assert.equal((await hs.resolve(`alice@${m.host}`)).origin, m.origin);
  } finally { await m.close(); }
});

test('resolve: ember-server keeps protocol 1 for old clients and says protocol_version 2', async () => {
  fresh();
  const m = await listen((req, send) => (req.url === '/.well-known/ember' ? send(200, { protocol: 1, protocol_version: 2, homeserver: { name: 'Real Shape' }, login: { authorize_url: '/login', token_url: '/api/v2/auth/token', methods: [{ id: 'password', kind: 'password', name: 'Password' }] } }) : send(404, {})));
  try {
    const r = await hs.resolve(m.host);
    assert.equal(r.protocol, 2);
    assert.equal(r.authorize_url, `${m.origin}/login`);
    assert.equal(r.token_url, `${m.origin}/api/v2/auth/token`);
  } finally { await m.close(); }
});

test('resolve: a domain that points at its homeserver, and the homeserver typed directly', async () => {
  fresh();
  let domainHost = '';
  const m = await mockHomeserver({ domain: () => domainHost });
  const d = await listen((req, send) => (req.url === '/.well-known/ember' ? send(200, { protocol: 2, homeserver: m.origin }) : send(404, {})));
  domainHost = d.host;
  try {
    const r = await hs.resolve(d.host);
    assert.equal(r.domain, d.host);
    assert.equal(r.origin, m.origin);
    assert.equal(r.token_url, `${m.origin}/token`);
    const direct = await hs.resolve(m.host); // the homeserver's own address: its accounts still carry the domain, which points back
    assert.equal(direct.domain, d.host);
    assert.equal(direct.origin, m.origin);
  } finally { await m.close(); await d.close(); }
});

test('resolve: a homeserver cannot claim a domain that does not point at it', async () => {
  fresh();
  const other = await listen((req, send) => (req.url === '/.well-known/ember' ? send(200, { protocol: 2, homeserver: 'http://127.0.0.1:9' }) : send(404, {})));
  const m = await mockHomeserver({ domain: () => other.host });
  try { await assert.rejects(hs.resolve(m.host), { code: 'domain_mismatch' }); } finally { await m.close(); await other.close(); }
});

test('resolve: legacy servers, missing ones and unreachable ones', async () => {
  fresh();
  const v1 = await listen((req, send) => (req.url === '/.well-known/ember' ? send(200, { software: 'ember-server', name: 'Old' }) : send(404, {})));
  const bonfire = await listen((req, send) => (req.url === '/.well-known/bonfire' ? send(200, { software: 'bonfire-server' }) : send(404, {})));
  const nothing = await listen((req, send) => send(404, { error: 'not_found' }));
  const plain = await listen((req, send) => (req.url === '/.well-known/ember' ? send(200, { protocol: 2, software: 'ember-server' }) : send(404, {}))); // a v2 server that hosts no accounts
  const toOld = await listen((req, send) => (req.url === '/.well-known/ember' ? send(200, { protocol: 2, homeserver: v1.origin }) : send(404, {})));
  const dead = await listen((req, send) => send(404, {}));
  await dead.close();
  try {
    await assert.rejects(hs.resolve(v1.host), { code: 'legacy' });
    await assert.rejects(hs.resolve(bonfire.host), { code: 'legacy' });
    await assert.rejects(hs.resolve(nothing.host), { code: 'not_found' });
    await assert.rejects(hs.resolve(plain.host), { code: 'not_homeserver' });
    await assert.rejects(hs.resolve(toOld.host), { code: 'legacy' });
    await assert.rejects(hs.resolve(dead.host), { code: 'unreachable' });
    await assert.rejects(hs.resolve('not a domain'), { code: 'invalid' });
  } finally { for (const s of [v1, bonfire, nothing, plain, toOld]) await s.close(); }
});

test('resolve: discovery URLs that are not https or not the homeserver\'s own are refused', async () => {
  fresh();
  let doc = {};
  const m = await listen((req, send) => (req.url === '/.well-known/ember' ? send(200, doc) : send(404, {})));
  const login = (authorize_url, token_url) => ({ protocol: 2, homeserver: { name: 'X' }, login: { authorize_url, token_url, methods: [] } });
  try {
    doc = login(`${m.origin}/authorize`, `${m.origin}/token`);
    assert.equal((await hs.resolve(m.host)).authorize_url, `${m.origin}/authorize`);
    doc = login('/authorize', '/token'); // relative: on the homeserver
    assert.equal((await hs.resolve(m.host)).token_url, `${m.origin}/token`);
    for (const [a, t] of [
      ['https://evil.example/authorize', `${m.origin}/token`], // another origin
      [`${m.origin}/authorize`, 'https://evil.example/token'],
      [`${m.origin}/authorize`, 'http://127.0.0.1:1/token'], // another port is another origin
      ['javascript:alert(1)', `${m.origin}/token`],
      ['http://example.org/authorize', `${m.origin}/token`], // plain http that isn't local
      [`${m.origin}/authorize`, undefined],
    ]) { doc = login(a, t); await assert.rejects(hs.resolve(m.host), { code: 'bad_url' }, `${a} ${t}`); }
    doc = { protocol: 2, homeserver: 'http://example.org' }; // delegation over plain http
    await assert.rejects(hs.resolve(m.host), { code: 'bad_url' });
    doc = { ...login(`${m.origin}/authorize`, `${m.origin}/token`), homeserver: { name: 'X', icon_url: 'javascript:alert(1)' } };
    assert.equal((await hs.resolve(m.host)).icon_url, null);
    // outside dev builds a local http homeserver is not even asked
    hs.configure({ dev: false });
    doc = login(`${m.origin}/authorize`, `${m.origin}/token`);
    await assert.rejects(hs.resolve(m.host), { code: 'invalid' });
    await assert.rejects(hs.resolve({ domain: m.host, origin: m.origin, hint: '' }), { code: 'bad_url' });
  } finally { await m.close(); }
});

test('the callback: only Ember\'s own origin, only the state that was sent', () => {
  const pending = { state: 'abc' }, ember = 'https://ember.nookara.cc';
  const msg = (data, origin = ember) => ({ origin, data });
  assert.deepEqual(hs.checkCallback(msg({ type: 'ember-auth', code: 'c1', state: 'abc' }), pending, ember), { code: 'c1' });
  // another origin is not heard at all, even with the right state
  assert.equal(hs.checkCallback(msg({ type: 'ember-auth', code: 'c1', state: 'abc' }, 'https://evil.example'), pending, ember), null);
  assert.equal(hs.checkCallback(msg({ type: 'ember-auth', code: 'c1', state: 'abc' }, 'https://ember.nookara.cc.evil.example'), pending, ember), null);
  assert.equal(hs.checkCallback(msg({ type: 'ember-auth', code: 'c1', state: 'abc' }, 'null'), pending, ember), null);
  assert.equal(hs.checkCallback(msg({ type: 'nookara-auth', token: 't' }), pending, ember), null); // somebody else's message
  assert.equal(hs.checkCallback(msg('hello'), pending, ember), null);
  assert.throws(() => hs.checkCallback(msg({ type: 'ember-auth', code: 'c1', state: 'other' }), pending, ember), { code: 'state' });
  assert.throws(() => hs.checkCallback(msg({ type: 'ember-auth', code: 'c1' }), pending, ember), { code: 'state' });
  assert.throws(() => hs.checkCallback(msg({ type: 'ember-auth', code: 'c1', state: 'abc' }), null, ember), { code: 'state' });
  assert.throws(() => hs.checkCallback(msg({ type: 'ember-auth', state: 'abc', error: 'access_denied' }), pending, ember), { code: 'declined' });
  assert.throws(() => hs.checkCallback(msg({ type: 'ember-auth', state: 'abc', error: 'server_error' }), pending, ember), { code: 'failed' });
  assert.throws(() => hs.checkCallback(msg({ type: 'ember-auth', state: 'abc' }), pending, ember), { code: 'failed' });
});

test('token exchange against a mock homeserver: the session is stored per homeserver', async () => {
  fresh();
  const m = await mockHomeserver();
  try {
    const info = await hs.resolve(m.host);
    let seen = 0;
    const off = hs.subscribe(() => { seen++; });
    const { code, verifier, redirect_uri } = await m.login(info, { hint: 'bob' });
    const s = await hs.exchange(info, { code, verifier, redirect_uri });
    off();
    assert.ok(seen > 0);
    assert.deepEqual(m.st.tokenCalls[0], { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri, client_id: 'ember' });
    assert.deepEqual(s.account, { id: '7', username: 'bob', domain: m.host, handle: `bob@${m.host}`, display_name: 'Alice', avatar_url: null });
    assert.equal(s.access_token, m.st.access);
    assert.equal(s.refresh_token, m.st.refresh);
    assert.ok(s.expires_at > Date.now());
    assert.equal(hs.currentOrigin(), m.origin);
    assert.equal(hs.currentAccount().handle, `bob@${m.host}`);
    assert.deepEqual(Object.keys(JSON.parse(local.getItem(hs.SESSIONS_KEY))), [m.origin]);
    assert.equal(local.getItem(hs.CURRENT_KEY), m.origin);
    assert.deepEqual(hs.recentHomeservers(), [{ domain: m.host, name: 'Mock Home', icon_url: `${m.origin}/icon.png` }]);
    // a code only works once, and only with its verifier
    await assert.rejects(hs.exchange(info, { code, verifier, redirect_uri }), { code: 'invalid_grant', status: 400 });
    const again = await m.login(info);
    await assert.rejects(hs.exchange(info, { code: again.code, verifier: 'someone-elses-verifier', redirect_uri }), { code: 'invalid_grant', message: 'bad code or verifier' });
    // sign out: the tokens are gone, the homeserver stays in the recent list
    assert.equal(hs.signOut(m.origin), true);
    assert.equal(hs.currentSession(), null);
    assert.equal(local.getItem(hs.SESSIONS_KEY), null);
    assert.equal(local.getItem(hs.CURRENT_KEY), null);
    assert.equal(hs.recentHomeservers().length, 1);
    hs.forgetHomeserver(m.host);
    assert.equal(local.getItem(hs.RECENT_KEY), null);
  } finally { await m.close(); }
});

test('an account from another domain is refused', async () => {
  fresh();
  const m = await mockHomeserver();
  try {
    const info = await hs.resolve(m.host);
    const { code, verifier, redirect_uri } = await m.login(info);
    await assert.rejects(hs.exchange({ ...info, domain: 'nookara.cc' }, { code, verifier, redirect_uri }), { code: 'domain_mismatch' });
    assert.equal(hs.currentSession(), null);
    await assert.rejects(hs.exchange({ ...info, token_url: 'https://evil.example/token' }, { code: 'x', verifier: 'y', redirect_uri }), { code: 'bad_url' });
  } finally { await m.close(); }
});

test('homeFetch: a 401 refreshes once and tries again', async () => {
  fresh();
  const m = await mockHomeserver();
  try {
    const info = await hs.resolve(m.host);
    const first = await hs.exchange(info, await m.login(info));
    assert.equal((await hs.homeFetch('/api/me')).status, 200);
    assert.equal(m.st.tokenCalls.length, 1);
    m.st.access = 'expired-on-the-server'; // the access token ran out
    const [a, b] = await Promise.all([hs.homeFetch('/api/me'), hs.homeFetch('/api/me')]); // (two at once share one refresh)
    assert.equal(a.status, 200);
    assert.deepEqual(await b.json(), { ok: true });
    assert.equal(m.st.tokenCalls.length, 2);
    assert.deepEqual(m.st.tokenCalls[1], { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'ember' });
    const now = hs.currentSession();
    assert.notEqual(now.access_token, first.access_token);
    assert.equal(now.refresh_token, m.st.refresh); // (rotated)
    assert.equal(now.account.handle, first.account.handle); // (a refresh answer has no account: the old one stays)
    await assert.rejects(hs.homeFetch('https://evil.example/api/me'), { code: 'bad_url' }); // the token never goes anywhere else
  } finally { await m.close(); }
});

test('homeFetch: a refused refresh, or a second 401, signs out', async () => {
  fresh();
  const m = await mockHomeserver({ rotate: false });
  try {
    const info = await hs.resolve(m.host);
    const ended = [];
    const off = hs.onSignedOut((origin, reason) => ended.push([origin, reason]));
    await hs.exchange(info, await m.login(info));
    m.st.access = 'expired'; m.st.refuseRefresh = true;
    await assert.rejects(hs.homeFetch('/api/me'), { code: 'signed_out', status: 401 });
    assert.equal(hs.currentSession(), null);
    assert.deepEqual(ended, [[m.origin, 'ended']]);
    await assert.rejects(hs.homeFetch('/api/me'), { code: 'signed_out' }); // (signed out: nothing is sent)
    // the refresh works but the API still says no: one retry, then out
    m.st.refuseRefresh = false;
    await hs.exchange(info, await m.login(info));
    m.st.alwaysDeny = true;
    const before = m.st.apiCalls, tokens = m.st.tokenCalls.length;
    await assert.rejects(hs.homeFetch('/api/me'), { code: 'signed_out' });
    assert.equal(m.st.apiCalls - before, 2);
    assert.equal(m.st.tokenCalls.length - tokens, 1);
    assert.equal(hs.currentSession(), null);
    off();
  } finally { await m.close(); }
});

test('a homeserver that cannot be reached does not sign you out', async () => {
  fresh();
  const m = await mockHomeserver();
  const info = await hs.resolve(m.host);
  await hs.exchange(info, await m.login(info));
  await m.close();
  await assert.rejects(hs.refresh(m.origin), { code: 'unreachable' });
  assert.ok(hs.currentSession());
});

test('a full-page sign-in on its way back: state checked, code exchanged, where to return handed over', async () => {
  fresh();
  const m = await mockHomeserver();
  try {
    const info = await hs.resolve(m.host);
    assert.equal(await hs.handleCallback({ hash: '#/home', search: '' }), null);
    const pend = async () => { const l = await m.login(info); session.setItem(hs.PENDING_KEY, JSON.stringify({ hs: info, verifier: l.verifier, state: l.state, redirect_uri: l.redirect_uri, back: { hash: '#/s/1' } })); return l; };
    let l = await pend();
    assert.deepEqual(await hs.handleCallback({ hash: `#/auth/callback?code=${l.code}&state=wrong`, search: '' }), { error: 'state', back: { hash: '#/s/1' } });
    assert.equal(session.getItem(hs.PENDING_KEY), null); // one try per sign-in
    assert.equal(hs.currentSession(), null);
    assert.deepEqual(await hs.handleCallback({ hash: `#/auth/callback?code=${l.code}&state=${l.state}`, search: '' }), { error: 'state', back: {} }); // nothing pending
    l = await pend();
    assert.deepEqual(await hs.handleCallback({ hash: `#/auth/callback?error=access_denied&state=${l.state}`, search: '' }), { error: 'declined', back: { hash: '#/s/1' } });
    l = await pend();
    const r = await hs.handleCallback({ hash: `#/auth/callback?code=${l.code}&state=${l.state}`, search: '' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.back, { hash: '#/s/1' });
    assert.equal(r.session.account.handle, `alice@${m.host}`);
    hs.signOut();
    l = await pend(); // the answer put before the fragment
    assert.equal((await hs.handleCallback({ hash: '#/auth/callback', search: `?code=${l.code}&state=${l.state}` })).ok, true);
  } finally { await m.close(); }
});

test('nookara.cc: the old Nookara sign-in until it answers protocol 2, the homeserver login after', async () => {
  const asked = [];
  const json = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const net = routes => async url => { asked.push(url); if (routes === 'down') throw new TypeError('fetch failed'); return url in routes ? json(200, routes[url]) : json(404, {}); };
  assert.equal(hs.DEFAULT_HOMESERVER, 'nookara.cc');
  // today: nothing at /.well-known/ember
  fresh({ dev: false, fetch: net({}) });
  assert.equal(hs.defaultProbe(), null);
  assert.deepEqual(await hs.probeDefault(), { v2: false, error: 'not_found' });
  assert.deepEqual(hs.defaultProbe(), { v2: false, error: 'not_found' });
  assert.equal(asked[0], 'https://nookara.cc/.well-known/ember');
  const n = asked.length;
  await hs.probeDefault(); // (asked once per page load)
  assert.equal(asked.length, n);
  // only the old discovery doc, or one without protocol 2
  fresh({ dev: false, fetch: net({ 'https://nookara.cc/.well-known/bonfire': { software: 'bonfire-server' } }) });
  assert.deepEqual(await hs.probeDefault(), { v2: false, error: 'legacy' });
  fresh({ dev: false, fetch: net({ 'https://nookara.cc/.well-known/ember': { software: 'ember-server' } }) });
  assert.deepEqual(await hs.probeDefault(), { v2: false, error: 'legacy' });
  // not reachable (offline, or no CORS yet): still the old sign-in, and it is asked again next time
  fresh({ dev: false, fetch: net('down') });
  assert.deepEqual(await hs.probeDefault(), { v2: false, error: 'unreachable' });
  const k = asked.length;
  await hs.probeDefault();
  assert.ok(asked.length > k);
  // once it speaks v2: the same path as any other homeserver
  const login = { authorize_url: 'https://chat.nookara.cc/authorize', token_url: 'https://chat.nookara.cc/token', methods: [{ id: 'password', kind: 'password', name: 'Password' }] };
  fresh({ dev: false, fetch: net({ 'https://nookara.cc/.well-known/ember': { protocol: 2, homeserver: 'https://chat.nookara.cc' }, 'https://chat.nookara.cc/.well-known/ember': { protocol: 2, homeserver: { domain: 'nookara.cc', name: 'Nookara', icon_url: 'https://nookara.cc/icon.png' }, login } }) });
  const p = await hs.probeDefault();
  assert.equal(p.v2, true);
  assert.deepEqual(p.hs, { domain: 'nookara.cc', origin: 'https://chat.nookara.cc', name: 'Nookara', icon_url: 'https://nookara.cc/icon.png', authorize_url: login.authorize_url, token_url: login.token_url, methods: login.methods, protocol: 2 });
  assert.equal(hs.signInWith(p.hs), 'homeserver');
});

test('a homeserver whose accounts are Nookara accounts is signed in to with Nookara, however it was found', async () => {
  const json = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const net = routes => async url => (url in routes ? json(200, routes[url]) : json(404, {}));
  const login = { authorize_url: 'https://chat.nookara.cc/login', token_url: 'https://chat.nookara.cc/api/v2/auth/token', methods: [{ id: 'nookara', kind: 'oidc', name: 'Nookara' }] };
  const doc = (accounts, at = 'chat.nookara.cc') => ({ protocol: 1, protocol_version: 2, homeserver: { domain: at === 'chat.nookara.cc' ? 'nookara.cc' : at, name: 'Home' }, accounts, login: at === 'chat.nookara.cc' ? login : { authorize_url: `https://${at}/login`, token_url: `https://${at}/token` } });
  const world = {
    'https://nookara.cc/.well-known/ember': { protocol: 2, homeserver: 'https://chat.nookara.cc' },
    'https://chat.nookara.cc/.well-known/ember': doc({ hosts_accounts: true, registration: 'open', nookara_identity: true }),
    'https://plain.example/.well-known/ember': doc({ hosts_accounts: true, registration: 'open' }, 'plain.example'),
    'https://odd.example/.well-known/ember': doc({ hosts_accounts: true, nookara_identity: 'yes' }, 'odd.example'),
    'https://other.example/.well-known/ember': doc({ hosts_accounts: true, nookara_identity: true }, 'other.example'),
  };
  // the default homeserver: v2, and still the Nookara sign-in
  fresh({ dev: false, fetch: net(world) });
  const p = await hs.probeDefault();
  assert.equal(p.v2, true);
  assert.equal(p.hs.nookara_identity, true);
  assert.equal(hs.signInWith(p.hs), 'nookara');
  // typed under "Use another homeserver": the domain, a handle on it, the homeserver's own address
  for (const typed of ['nookara.cc', 'alice@nookara.cc', '@alice@nookara.cc', 'chat.nookara.cc', 'https://nookara.cc']) {
    const found = await hs.resolve(hs.parseHomeserver(typed));
    assert.equal(found.origin, 'https://chat.nookara.cc', typed);
    assert.equal(hs.signInWith(found), 'nookara', typed);
  }
  // the rule is what discovery says, not the name: any homeserver that says so, and only `true` counts
  assert.equal(hs.signInWith(await hs.resolve('other.example')), 'nookara');
  assert.equal(hs.signInWith(await hs.resolve('bob@plain.example')), 'homeserver');
  assert.equal(hs.signInWith(await hs.resolve('odd.example')), 'homeserver');
  assert.equal(hs.signInWith(null), 'homeserver');
});
