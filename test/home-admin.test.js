import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetMethod, presetOf, uniqueId, validId, isMasked, hasSecret, secretToSend, withSecretCleared, methodToSend, methodsToSend, methodIssues, sameMethods,
  callbackUrl, hostList, nameList, adminErrorText, loginErrorText, parseLinkReturn, stripLinkReturn, checkLinkMessage } from '../src/chat/homeAdmin.js';

test('presets: every one the settings offer, with what it fixes', () => {
  assert.deepEqual(PRESETS.map(p => p.key), ['password', 'nookara', 'google', 'microsoft', 'github', 'discord', 'oidc', 'oauth2']);
  assert.deepEqual(presetMethod('password'), { id: 'password', kind: 'password', name: 'Password', enabled: true });
  const n = presetMethod('nookara');
  assert.equal(n.kind, 'nookara'); assert.equal(n.issuer, 'https://nookara.cc'); assert.equal(n.client_id, ''); assert.equal(n.client_secret, '');
  assert.deepEqual([presetMethod('google').kind, presetMethod('google').issuer], ['oidc', 'https://accounts.google.com']);
  assert.deepEqual([presetMethod('microsoft').kind, presetMethod('microsoft').issuer], ['oidc', 'https://login.microsoftonline.com/common/v2.0']);
  const gh = presetMethod('github');
  assert.deepEqual([gh.kind, gh.authorize_url, gh.token_url, gh.userinfo_url, gh.id_field, gh.username_field],
    ['oauth2', 'https://github.com/login/oauth/authorize', 'https://github.com/login/oauth/access_token', 'https://api.github.com/user', 'id', 'login']);
  const dc = presetMethod('discord');
  assert.deepEqual([dc.kind, dc.authorize_url, dc.token_url, dc.userinfo_url, dc.id_field, dc.username_field],
    ['oauth2', 'https://discord.com/oauth2/authorize', 'https://discord.com/api/oauth2/token', 'https://discord.com/api/users/@me', 'id', 'username']);
  assert.deepEqual([presetMethod('oidc').kind, presetMethod('oidc').issuer], ['oidc', '']);
  assert.deepEqual([presetMethod('oauth2').kind, presetMethod('oauth2').authorize_url], ['oauth2', '']);
  assert.equal(presetMethod('nope'), null);
  for (const p of PRESETS) { const m = presetMethod(p.key); assert.equal(validId(m.id), true, p.key); assert.equal(m.enabled, true); }
});
test('presets: one password method at most, and ids never collide', () => {
  const have = [{ id: 'password', kind: 'password' }, { id: 'google', kind: 'oidc' }, { id: 'google-2', kind: 'oidc' }];
  assert.equal(presetMethod('password', have), null);
  assert.equal(presetMethod('google', have).id, 'google-3');
  assert.equal(presetMethod('github', have).id, 'github');
  assert.equal(uniqueId('My SSO!', []), 'my-sso-');
  assert.equal(validId(uniqueId('--', [])), true);
  assert.equal(validId(uniqueId('x'.repeat(60), [{ id: 'x'.repeat(28) }])), true);
  for (const bad of ['', '-a', 'A', 'a b', 'x'.repeat(33), 'a.b']) assert.equal(validId(bad), false, bad);
});
test('presets: a stored method is recognised by what its preset fixes', () => {
  assert.equal(presetOf({ kind: 'password' }), 'password');
  assert.equal(presetOf({ kind: 'nookara' }), 'nookara');
  assert.equal(presetOf({ kind: 'oidc', issuer: 'https://accounts.google.com/' }), 'google');
  assert.equal(presetOf({ kind: 'oidc', issuer: 'https://id.example' }), 'oidc');
  assert.equal(presetOf({ kind: 'oauth2', authorize_url: 'https://discord.com/oauth2/authorize' }), 'discord');
  assert.equal(presetOf({ kind: 'oauth2', authorize_url: 'https://hub.example/auth' }), 'oauth2');
  assert.equal(presetOf(null), null);
});

test('secrets: the masked one and an empty box keep, a new value replaces', () => {
  assert.equal(isMasked('********WXYZ'), true);
  assert.equal(isMasked('********'), true);
  assert.equal(isMasked('*******WXYZ'), false);
  assert.equal(isMasked('********WXYZ1'), false);
  assert.equal(isMasked(null), false);
  assert.equal(hasSecret({ client_secret: '********ab12' }), true);
  assert.equal(hasSecret({ client_secret: null }), false);
  assert.equal(hasSecret({ client_secret: '' }), false);
  assert.equal(secretToSend(''), '');
  assert.equal(secretToSend('   '), '');
  assert.equal(secretToSend(null), '');
  assert.equal(secretToSend(undefined), '');
  assert.equal(secretToSend('********WXYZ'), '');
  assert.equal(secretToSend('  new-secret  '), 'new-secret');
  assert.equal(methodToSend({ id: 'corp', kind: 'oidc', name: 'Corp', issuer: 'https://id.example', client_id: 'c', client_secret: '********WXYZ' }).client_secret, '');
  assert.equal(methodToSend({ id: 'corp', kind: 'oidc', name: 'Corp', issuer: 'https://id.example', client_id: 'c', client_secret: 's3cret' }).client_secret, 's3cret');
});
test('secrets: clearing means the method under a new id (the server matches by id + kind)', () => {
  const all = [{ id: 'corp', kind: 'oidc', client_secret: '********WXYZ' }, { id: 'hub', kind: 'oauth2', client_secret: null }];
  assert.deepEqual(withSecretCleared(all[0], all), { id: 'corp-2', kind: 'oidc', client_secret: '' });
  assert.deepEqual(withSecretCleared(all[1], all), { id: 'hub', kind: 'oauth2', client_secret: '' });
});

test('what is sent: only what the server takes from a request', () => {
  assert.deepEqual(methodToSend({ id: 'password', kind: 'password', name: ' Password ', enabled: false, callback_url: 'x' }), { id: 'password', kind: 'password', name: 'Password', enabled: false });
  assert.deepEqual(methodToSend({ id: 'Corp', kind: 'oidc', name: 'Corp', enabled: true, issuer: 'https://id.example/', client_id: ' abc ', client_secret: null, scopes: 'openid   profile', authorize_url: 'https://id.example/a', token_url: 'https://id.example/t', userinfo_url: 'https://id.example/u', jwks_url: 'https://id.example/k', callback_url: 'https://hs/login/callback/corp', username_field: 'nick', id_field: 'sub', token_auth: 'basic' }),
    { id: 'corp', kind: 'oidc', name: 'Corp', enabled: true, client_id: 'abc', client_secret: '', issuer: 'https://id.example', scopes: 'openid profile', username_field: 'nick', token_auth: 'basic' });
  assert.deepEqual(methodToSend({ id: 'hub', kind: 'oauth2', name: 'Hub', authorize_url: ' https://h/a ', token_url: 'https://h/t', userinfo_url: 'https://h/u', client_id: 'c', client_secret: 'new', scopes: '', id_field: 'data.id', username_field: 'login', email_field: '', pkce: false, token_auth: 'weird', issuer: 'https://h' }),
    { id: 'hub', kind: 'oauth2', name: 'Hub', enabled: true, client_id: 'c', client_secret: 'new', authorize_url: 'https://h/a', token_url: 'https://h/t', userinfo_url: 'https://h/u', id_field: 'data.id', username_field: 'login', pkce: false });
  assert.deepEqual(methodToSend({ id: 'nookara', kind: 'nookara', name: 'Nookara', enabled: true, issuer: 'https://nookara.cc', scopes: 'openid profile', client_id: 'c', client_secret: '' }),
    { id: 'nookara', kind: 'nookara', name: 'Nookara', enabled: true, client_id: 'c', client_secret: '' });
  assert.deepEqual(methodsToSend(null), []);
});
test('what is sent: nothing changed means nothing to save', () => {
  const stored = [{ id: 'password', kind: 'password', name: 'Password', enabled: true }, { id: 'corp', kind: 'oidc', name: 'Corp', enabled: true, issuer: 'https://id.example', client_id: 'c', client_secret: '********WXYZ', callback_url: 'x', authorize_url: 'https://id.example/a' }];
  const form = stored.map(m => ({ ...m }));
  assert.equal(sameMethods(stored, form), true);
  form[1].client_secret = '';
  assert.equal(sameMethods(stored, form), true);
  form[1].client_secret = 'typed';
  assert.equal(sameMethods(stored, form), false);
  form[1].client_secret = '********WXYZ'; form[0].enabled = false;
  assert.equal(sameMethods(stored, form), false);
});
test('methods: what has to be right before saving', () => {
  assert.deepEqual(methodIssues({ id: 'password', kind: 'password' }), {});
  assert.deepEqual(Object.keys(methodIssues({ id: 'Bad Id', kind: 'oidc', issuer: 'http://id.example', client_id: '' })), ['id', 'client_id', 'issuer']);
  assert.deepEqual(methodIssues({ id: 'corp', kind: 'oidc', issuer: 'https://id.example', client_id: '', enabled: false }), {});
  assert.deepEqual(Object.keys(methodIssues({ id: 'hub', kind: 'oauth2', client_id: 'c', authorize_url: 'https://h/a', token_url: '', userinfo_url: 'https://u:p@h/u' })), ['token_url', 'userinfo_url']);
  const a = { id: 'corp', kind: 'oidc', issuer: 'https://id.example', client_id: 'c' }, b = { id: 'corp', kind: 'oidc', issuer: 'https://id.example', client_id: 'c' };
  assert.match(methodIssues(a, [a, b]).id, /Another/);
  assert.deepEqual(methodIssues(a, [a]), {});
});

test('callback address: the public url, /login/callback/ and the id', () => {
  assert.equal(callbackUrl('https://chat.example', 'google'), 'https://chat.example/login/callback/google');
  assert.equal(callbackUrl('https://chat.example/', 'corp_sso-2'), 'https://chat.example/login/callback/corp_sso-2');
  assert.equal(callbackUrl('https://chat.example', ''), '');
  assert.equal(callbackUrl('', 'google'), '');
});
test('lists: homeservers and names, however they are typed', () => {
  assert.deepEqual(hostList('Nookara.cc, https://chat.example/x\n*.corp.example  nookara.cc'), ['nookara.cc', 'chat.example', '*.corp.example']);
  assert.deepEqual(nameList('@Nat, l:7\nnat'), ['nat', 'l:7']);
  assert.deepEqual(hostList(''), []);
});

test('errors: every code the accounts settings answer with has its own words', () => {
  const codes = ['invalid_issuer', 'invalid_method_url', 'invalid_login_methods', 'no_login_method', 'invalid_registration', 'invalid_remote_accounts', 'invalid_ember_clients', 'local_admin_required', 'managed_setting', 'invalid_creation', 'not_allowed', 'owner_only', 'cannot_remove_owner'];
  const fallback = adminErrorText('something_else');
  const seen = new Set();
  for (const c of codes) { const t = adminErrorText(c); assert.notEqual(t, fallback, c); assert.doesNotMatch(t, /_/, c); seen.add(t); }
  assert.equal(seen.size, codes.length);
  assert.equal(adminErrorText(null), fallback);
  assert.equal(adminErrorText(new Error('whatever_code')), fallback);
});
test('errors: the method and the field are named', () => {
  const methods = [{ id: 'corp', name: 'Corp SSO' }];
  // (apiFetch errors: the server's fields are copied onto the Error, so `message` may be the server's own)
  const issuer = Object.assign(new Error('invalid_issuer'), { error: 'invalid_issuer', method: 'corp', message: 'no answer from the issuer' });
  assert.match(adminErrorText(issuer, methods), /"Corp SSO"/);
  assert.match(adminErrorText(issuer, methods), /no answer from the issuer/);
  assert.match(adminErrorText(Object.assign(new Error('invalid_method_url'), { error: 'invalid_method_url', method: 'hub', field: 'token_url' }), methods), /^"hub": the token address/);
  assert.match(adminErrorText(Object.assign(new Error('invalid_login_methods'), { field: 'id', method: 'corp' }), methods), /id is taken/);
  assert.match(adminErrorText(Object.assign(new Error('invalid_login_methods'), { field: 'scopes' })), /^The scopes/);
  assert.match(adminErrorText(new Error('no_login_method')), /at least one/);
});
test('errors: linking and unlinking your own sign-ins', () => {
  assert.match(loginErrorText('last_login_method', 'Google'), /can't remove Google.*only way/);
  assert.match(loginErrorText('cannot_remove_password'), /password/);
  assert.match(loginErrorText('not_linked', 'Google'), /Google isn't linked/);
  assert.match(loginErrorText('login_already_linked', 'Google'), /another account/);
  assert.match(loginErrorText('invalid_return_to'), /account page/);
  assert.match(loginErrorText('access_denied'), /cancelled/);
  assert.match(loginErrorText('mystery', 'Google'), /Couldn't link Google/);
  for (const c of ['last_login_method', 'cannot_remove_password', 'not_linked', 'login_already_linked', 'unknown_method', 'invalid_return_to', 'blocked']) assert.notEqual(loginErrorText(c), loginErrorText('mystery'), c);
});

test('link return: ?linked= and ?link_error=, in a query or a whole address', () => {
  assert.deepEqual(parseLinkReturn('?linked=google'), { linked: 'google' });
  assert.deepEqual(parseLinkReturn('?x=1&linked=corp_sso-2'), { linked: 'corp_sso-2' });
  assert.deepEqual(parseLinkReturn('?link_error=login_already_linked'), { error: 'login_already_linked' });
  assert.deepEqual(parseLinkReturn('?linked=google&link_error=access_denied'), { error: 'access_denied' });
  assert.deepEqual(parseLinkReturn('https://ember.nookara.cc/auth/callback.html?linked=github'), { linked: 'github' });
  assert.deepEqual(parseLinkReturn('https://ember.nookara.cc/?link_error=failed#/home'), { error: 'failed' });
  assert.equal(parseLinkReturn('?linked=Not%20An%20Id'), null);
  assert.equal(parseLinkReturn('?code=abc&state=def'), null);
  assert.equal(parseLinkReturn(''), null);
  assert.equal(parseLinkReturn(null), null);
  assert.equal(parseLinkReturn('?link_error=' + 'x'.repeat(200)).error.length, 64);
});
test('link return: the address bar gets its address back', () => {
  assert.equal(stripLinkReturn('https://ember.nookara.cc/?linked=google#/home'), 'https://ember.nookara.cc/#/home');
  assert.equal(stripLinkReturn('https://nookara.cc/chat?a=1&link_error=x&b=2'), 'https://nookara.cc/chat?a=1&b=2');
});
test('link return: a message only counts from Ember\'s own callback page', () => {
  const o = 'https://ember.nookara.cc';
  assert.deepEqual(checkLinkMessage({ origin: o, data: { type: 'ember-link', linked: 'google' } }, o), { linked: 'google' });
  assert.deepEqual(checkLinkMessage({ origin: o, data: { type: 'ember-link', link_error: 'login_already_linked' } }, o), { error: 'login_already_linked' });
  assert.deepEqual(checkLinkMessage({ origin: o, data: { type: 'ember-link' } }, o), { error: 'failed' });
  assert.equal(checkLinkMessage({ origin: 'https://evil.example', data: { type: 'ember-link', linked: 'google' } }, o), null);
  assert.equal(checkLinkMessage({ origin: o, data: { type: 'ember-auth', code: 'x', state: 'y' } }, o), null);
  assert.equal(checkLinkMessage({ origin: o, data: 'hi' }, o), null);
  assert.equal(checkLinkMessage(null, o), null);
});
