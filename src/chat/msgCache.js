// A small page of recent messages for the server channels you've opened, kept in this browser (IndexedDB), so a server that's still
// connecting shows its last messages greyed out behind the loader instead of nothing. Server channels only: DMs are end-to-end
// encrypted and group chats are treated the same, so neither is ever written to disk here. Per account; the oldest channels go first.
const DB = 'ember-cache', STORE = 'channels', KEEP = 30, MAX_CHANNELS = 25;
let dbp = null;
function openDb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no_idb')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }).catch(() => null); // (private mode / blocked: there's just no cache)
  }
  return dbp;
}
const tx = async (mode, fn) => {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      const req = fn(st);
      t.oncomplete = () => resolve(req?.result ?? null);
      t.onerror = t.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
};

// the messages kept for a channel (key = `${account}|c:<cid>`), oldest first, or null
export async function readChannel(key) {
  const row = await tx('readonly', st => st.get(key));
  return Array.isArray(row?.list) ? row.list : null;
}

// what's worth keeping of a message: everything it shows, nothing that was still on its way
const keepable = m => m && !m.pending && !m.failed && !m.queued && !m.ephemeral;
const INDEX = account => `ember_msgcache_index:${account}`;
function readIndex(account) { try { const v = JSON.parse(localStorage.getItem(INDEX(account)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }

export async function writeChannel(account, key, list) {
  const keep = (list || []).filter(keepable).slice(-KEEP);
  if (!keep.length) return;
  let rows;
  try { rows = JSON.parse(JSON.stringify(keep)); } catch { return; } // (plain data only)
  const idx = readIndex(account);
  idx[key] = Date.now();
  const old = Object.keys(idx).sort((a, b) => idx[b] - idx[a]).slice(MAX_CHANNELS);
  for (const k of old) delete idx[k];
  try { localStorage.setItem(INDEX(account), JSON.stringify(idx)); } catch { /* fine */ }
  await tx('readwrite', st => { for (const k of old) st.delete(k); return st.put({ at: Date.now(), list: rows }, key); });
}

// a server you left / that was deleted: its channels' kept messages go
export async function dropChannels(account, keys) {
  const idx = readIndex(account);
  for (const k of keys) delete idx[k];
  try { localStorage.setItem(INDEX(account), JSON.stringify(idx)); } catch { /* fine */ }
  await tx('readwrite', st => { for (const k of keys) st.delete(k); return null; });
}
// signing out: this account's kept messages go
export async function forgetAccount(account) {
  const idx = readIndex(account);
  try { localStorage.removeItem(INDEX(account)); } catch { /* fine */ }
  await tx('readwrite', st => { for (const k of Object.keys(idx)) st.delete(k); return null; });
}
