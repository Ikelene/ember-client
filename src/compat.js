// Old names that still cross a boundary. Nookara used to be Velora and Ember used to be Bonfire; the servers, the apps
// (desktop / Android) and the website have not all moved over yet, so everything that talks to them still speaks the old
// names. Every old name the client sends or reads lives here, so the switch can be flipped in one place later.
// Pure, no imports (the node tests load modules that use it).

// ── Nookara's HTTP API (paths on Nookara itself; instances use /api/v1/...) ──
export const EMBER_API = '/bonfire'; // /bonfire/instances, /bonfire/session, /bonfire/hosting/...
export const ADMIN_EMBER_API = '/admin/bonfire';
export const EMBER_ASSETS = '/assets/bonfire'; // logos, favicon, the rock
export const NOOKARA_CAP_JS = '/assets/js/velora-cap.js';
export const CLIPBOARD_PATH = '/__bonfire_clipboard/'; // the Android app's pasted-media URLs

// ── instance API paths that name Nookara ──
export const INST_AUTH_NOOKARA = '/api/v1/auth/velora';
export const INST_IMPORT_NOOKARA = '/api/v1/import/velora';
export const INST_REGISTER_NOOKARA = '/instance/velora/register'; // under /api/v1 when called through apiFetch's inst

// ── instance discovery ──
export const WELL_KNOWN = ['/.well-known/ember', '/.well-known/bonfire']; // new first, old as the fallback
export const isInstanceSoftware = s => s === 'ember-server' || s === 'bonfire-server';

// ── values in server JSON ──
// "a Nookara account / Nookara sign-in": accounts_mode, author.kind, payments, inst.mode. Servers still send (and expect) 'velora'.
export const NOOKARA_WIRE = 'velora';
export const isNookara = v => v === 'nookara' || v === 'velora';
export const accountsMode = v => (v == null || isNookara(v) ? NOOKARA_WIRE : v); // an instance's accounts_mode, old or new spelling (unset = Nookara)
// the key Ember uses for Nookara's own servers in ids ('velora' | 'origin|id'), stored ids and hash routes: it stays 'velora'
export const NOOKARA_INST = 'velora';
export const nookaraId = o => o?.nookara_id ?? o?.velora_id; // a person's Nookara account id
export const nookaraInfo = o => o?.nookara ?? o?.velora; // the discovery / settings block about Nookara
export const nookaraUrl = o => o?.nookara_url ?? o?.velora_url;
export const nookaraRegistration = o => o?.nookara_registration ?? o?.velora_registration; // 'auto' | 'on' | 'off'
export const NOOKARA_ID_FIELD = 'velora_id'; // the key servers take for it
export const NOOKARA_URL_FIELD = 'velora_url'; // what the instance settings PATCH takes
export const needsNookaraPayments = v => v === 'nookara_required' || v === 'velora_required';
export const isEmberSource = v => v === 'ember' || v === 'bonfire'; // a game console line typed in Ember
export const TEMP_HOST = 'velora-temp'; // an attachment's host for a temporary file
export const SIGN_PREFIX = 'bonfire-msg-v1'; // signed-message bytes (PROTOCOL.md §8): changing it breaks every signature
export const OLD_EMBER_UPDATE = 'bonfire_update'; // gateway event (now ember_update): a new web build / desktop update
export const GAME_CLI = 'bonfire server'; // the Minecraft plugin's command
export const SERVER_ENV = { discord: 'BONFIRE_DISCORD_TOKEN', fluxer: 'BONFIRE_FLUXER_TOKEN', matrix_token: 'BONFIRE_MATRIX_TOKEN', matrix_homeserver: 'BONFIRE_MATRIX_HOMESERVER', accounts_mode: 'BONFIRE_ACCOUNTS_MODE' };

export const legacyToNew = c => (typeof c === 'string' ? c.replace(/velora/g, 'nookara').replace(/bonfire/g, 'ember') : c); // an error code / plan key / event name under its new name, whatever the server sent

// ── hosts ──
export const OLD_HOST = 'velora.ikelene.net'; // Nookara's first address, still served
export const OLD_ORIGIN = `https://${OLD_HOST}`;
export const OLD_HOST_SRC = String.raw`velora\.ikelene\.net`;

// ── what the apps and the website put on window ──
const w = () => (typeof window === 'undefined' ? {} : window);
export const desktopBridge = () => w().emberDesktop || w().bonfireDesktop; // the desktop app's preload
export const mobileBridge = () => w().emberMobile || w().bonfireMobile; // the Android app
export const notifBridge = () => w().EmberNotifications || w().BonfireNotifications;
export const downloadsBridge = () => w().EmberDownloads || w().BonfireDownloads;
export const nookaraCap = () => w().NookaraCap || w().VeloraCap; // the website's scripts
export const nookaraCaptchaPass = () => w().NookaraCaptchaPass || w().VeloraCaptchaPass;
export const nookaraProfileBadges = () => w().NookaraProfileBadges || w().VeloraProfileBadges;
export const ANDROID_UA = /\b(?:Ember|Bonfire)Android\//;
export const MEDIA_PASTE_EVENTS = ['ember-media-paste', 'bonfire-media-paste']; // from the Android app
export const NOTIFICATION_ACTION_EVENT = 'bonfire:notification-action'; // for the desktop / Android shells
export const NOTIF_DISMISSED_COOKIE = 'ember_notifications_dismissed';
export const notifDismissed = () => { try { return /(?:^|; )(?:ember|bonfire)_notifications_dismissed=1(?:;|$)/.test(document.cookie); } catch { return false; } };

// ── storage ──
// The website (nookara.cc) shares these with Ember and still uses the old names, so they stay as they are.
export const SITE_TOKEN = 'velora_token';
export const SITE_SAVED = 'velora_saved';
export const SITE_ME_CACHE = 'velora_me_cache';
export const SITE_ME_CACHE_V2 = 'velora_me_cache_v2';
export const SITE_ACCENT = 'velora_accent';
export const SITE_ACCENT_AT = 'velora_accent_at';
export const SITE_PUSH_PROMPT = 'velora_push_prompt';
const SITE_KEYS = new Set([SITE_TOKEN, SITE_SAVED, SITE_ME_CACHE, SITE_ME_CACHE_V2, SITE_ACCENT, SITE_ACCENT_AT, SITE_PUSH_PROMPT]);
// Ember's own keys moved: bonfire_* -> ember_*, bonfire.* -> ember.*, velora_chat_* -> nookara_chat_*
const OLD_PREFIXES = [['bonfire_', 'ember_'], ['bonfire.', 'ember.'], ['velora_chat_', 'nookara_chat_']];
export const newKeyOf = k => { for (const [o, n] of OLD_PREFIXES) if (k.startsWith(o)) return n + k.slice(o.length); return null; };
// move every old key to its new name (the new one wins if both exist); runs once when this module loads, before anything reads
export function migrateStorage(store) {
  try {
    if (!store) return;
    const old = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && !SITE_KEYS.has(k) && newKeyOf(k)) old.push(k); }
    for (const k of old) { const n = newKeyOf(k); if (store.getItem(n) == null) store.setItem(n, store.getItem(k)); store.removeItem(k); }
  } catch { /* private mode */ }
}
try { if (typeof localStorage !== 'undefined') migrateStorage(localStorage); } catch { /* blocked */ }
try { if (typeof sessionStorage !== 'undefined') migrateStorage(sessionStorage); } catch { /* blocked */ }
