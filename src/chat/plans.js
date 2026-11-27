import { legacyToNew } from '../compat.js';
import { useContext, useState, createContext } from 'react';

// feature key -> [Name at the start of a sentence, plural noun for "used N of M ___"]
export const NAMES = {
  bots: ['Bots', 'bots'], bridges: ['Bridges to Discord and Fluxer', 'bridges'], emojis: ['Custom emojis', 'emojis'], sounds: ['The soundboard', 'sounds'],
  custom_voice_keys: ['Your own voice keys', 'voice keys'], member_cap: ['More members', 'members'], max_upload_mb: ['Larger uploads', 'MB per file'],
  backups: ['Backups', 'backups'], game: ['Game servers (Ember Link)', 'game servers'], webhooks: ['Webhooks', 'webhooks'],
};

const ALIAS = {
  bot: 'bots', bridge: 'bridges', emoji: 'emojis', sound: 'sounds', soundboard: 'sounds', members: 'member_cap', member: 'member_cap', cap: 'member_cap',
  upload: 'max_upload_mb', uploads: 'max_upload_mb', upload_mb: 'max_upload_mb', upload_size: 'max_upload_mb', voice_keys: 'custom_voice_keys', voice: 'custom_voice_keys',
  backup: 'backups', game_servers: 'game', game_server: 'game', ember_link: 'game', link: 'game', minecraft: 'game', webhook: 'webhooks',
};

export const canon = what => { const k = legacyToNew(String(what || '').toLowerCase().replace(/[\s-]+/g, '_')); return ALIAS[k] || k; };

export const featureName = what => NAMES[canon(what)]?.[0] || (String(what || '') ? `${String(what).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}` : 'This');

const planLabel = p => { const n = typeof p === 'string' ? p : p?.name || p?.id; return n ? String(n).replace(/^./, c => c.toUpperCase()) : ''; };

// What a failed request says about plans: null (not a plan error) or { kind: 'feature' | 'limit', what, limit, used, plan }.
// (The error code is e.error: a `message` field in the answer replaces e.message, see api.js.)
export function planOf(e) {
  const code = e?.error || e?.message;
  if (code !== 'plan_limit' && code !== 'plan_feature') return null;
  const what = canon(e.what);
  let limit = e.limit === false ? 0 : typeof e.limit === 'number' ? e.limit : e.limit == null ? null : Number(e.limit);
  if (Number.isNaN(limit)) limit = null;
  const used = typeof e.used === 'number' ? e.used : null;
  const feature = code === 'plan_feature' || limit === 0 || limit === null;
  return { kind: feature ? 'feature' : 'limit', what, limit: feature ? 0 : limit, used: used ?? (feature ? null : limit), plan: planLabel(e.plan), message: typeof e.detail === 'string' ? e.detail : '' };
}

export const isPlanError = e => !!planOf(e);

// ServerSettings provides: { name, limits: { what: { limit, used } }, features: { what: bool }, managed, canUpgrade, goTo }
export const PlanCtx = createContext(null);

export function buildPlanCtx(inst, goTo) {
  const m = inst?.managed, p = inst?.serverInfo?.plan; // m: public { plan, limits }; p: the admin-only block of /instance/info
  const limits = {}, features = {};
  for (const [k, v] of Object.entries(m?.limits || {})) limits[canon(k)] = { limit: v };
  for (const [k, v] of Object.entries(p?.limits || {})) limits[canon(k)] = v && typeof v === 'object' ? { limit: v.limit, used: v.used } : { limit: v };
  for (const [k, v] of Object.entries(p?.features || {})) features[canon(k)] = !!v;
  return { name: planLabel(p?.name || m?.plan), limits, features, managed: !!m || !!p, canUpgrade: !!m && !!inst?.isOwner, goTo };
}

// the plan of this page for one feature. `used` = how many exist now (when the page knows).
// gate: the feature isn't in the plan (show <PlanGate />); full: the number is reached (show <PlanNotice />, disable "add");
// catchPlan(e): call in a catch - true when it was a plan error (and the page now shows it); limit / used for a usage line
export function usePlan(what, used) {
  const ctx = useContext(PlanCtx);
  const [hit, setHit] = useState(null);
  const key = canon(what);
  const entry = ctx?.limits?.[key];
  const limit = entry ? entry.limit : undefined;
  const have = typeof used === 'number' ? used : typeof entry?.used === 'number' ? entry.used : null;
  let pre = null;
  if (ctx && (ctx.features[key] === false || limit === false || limit === 0)) pre = { kind: 'feature', what: key, limit: 0, used: null, plan: ctx.name };
  else if (typeof limit === 'number' && limit > 0 && have !== null && have >= limit) pre = { kind: 'limit', what: key, limit, used: have, plan: ctx.name };
  const block = hit || pre;
  return {
    gate: block?.kind === 'feature' ? block : null,
    full: block?.kind === 'limit' ? block : null,
    limit: typeof limit === 'number' ? limit : null, used: have,
    catchPlan: e => { const p = planOf(e); if (!p) return false; setHit({ ...p, what: key }); return true; },
    clear: () => setHit(null),
  };
}
