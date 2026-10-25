// A tiny key-value store on IndexedDB, for saves too big for localStorage
// (a whole league: every player, contract and depth chart, about a
// megabyte). Falls back to localStorage, then to memory, and never throws:
// a failed write resolves false.

const NAME = 'mikeball';
const STORE = 'kv';
const LS = 'mikeball:db:';
const memory = new Map();
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : true);
      t.onerror = () => resolve(mode === 'readonly' ? undefined : false);
      t.onabort = () => resolve(mode === 'readonly' ? undefined : false);
    } catch {
      resolve(mode === 'readonly' ? undefined : false);
    }
  });
}

export async function dbGet(key) {
  const db = await open();
  if (db) {
    const v = await tx(db, 'readonly', (s) => s.get(key));
    if (v !== undefined) return v;
  }
  try {
    const raw = localStorage.getItem(LS + key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* storage off */ }
  return memory.has(key) ? memory.get(key) : null;
}

export async function dbSet(key, value) {
  memory.set(key, value);
  const db = await open();
  if (db) {
    const ok = await tx(db, 'readwrite', (s) => s.put(value, key));
    if (ok) return true;
  }
  try {
    localStorage.setItem(LS + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function dbDelete(key) {
  memory.delete(key);
  const db = await open();
  if (db) await tx(db, 'readwrite', (s) => s.delete(key));
  try { localStorage.removeItem(LS + key); } catch { /* storage off */ }
  return true;
}
