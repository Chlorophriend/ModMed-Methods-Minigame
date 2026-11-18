// Demo backend: keeps the room in this browser's localStorage, so tabs on ONE computer can play together.
// Good for rehearsing; it cannot connect phones. Same API as backend-firebase.js.
const PREFIX = 'itdepends-demo:';
const kMeta = code => `${PREFIX}${code}:meta`;
const kPlayer = (code, uid) => `${PREFIX}${code}:p:${uid}`;

function readJSON(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeJSON(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// Apply an update patch whose keys may be paths ("answers/q0") onto a plain object.
function applyPatch(obj, patch) {
  const out = structuredClone(obj || {});
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split('/');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete cur[last]; else cur[last] = structuredClone(value);
  }
  return out;
}

export function createDemoBackend() {
  let uid = null;
  try { uid = sessionStorage.getItem('itdepends-demo-uid'); } catch {}
  if (!uid) {
    uid = 'demo-' + Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('itdepends-demo-uid', uid); } catch {}
  }

  const readRoom = code => {
    const meta = readJSON(kMeta(code));
    if (!meta) return null;
    const players = {};
    const pre = `${PREFIX}${code}:p:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pre)) players[k.slice(pre.length)] = readJSON(k);
    }
    return { meta, players };
  };

  const listeners = new Set();
  const notify = () => queueMicrotask(() => { for (const l of listeners) l.onData(readRoom(l.code)); });
  window.addEventListener('storage', e => { if (!e.key || e.key.startsWith(PREFIX)) notify(); });

  return {
    mode: 'demo',
    uid,
    async getRoom(code) { return readRoom(code); },
    async createRoom(code, meta) { writeJSON(kMeta(code), meta); notify(); },
    watchRoom(code, onData) {
      const l = { code, onData };
      listeners.add(l);
      queueMicrotask(() => onData(readRoom(code)));
      return () => listeners.delete(l);
    },
    async updateMeta(code, patch) { writeJSON(kMeta(code), applyPatch(readJSON(kMeta(code)), patch)); notify(); },
    async joinRoom(code, name) {
      writeJSON(kPlayer(code, uid), applyPatch(readJSON(kPlayer(code, uid)), { name, joinedAt: Date.now() }));
      notify();
    },
    async savePlayer(code, patch) { writeJSON(kPlayer(code, uid), applyPatch(readJSON(kPlayer(code, uid)), patch)); notify(); },
    async removePlayer(code, playerUid) { localStorage.removeItem(kPlayer(code, playerUid)); notify(); },
  };
}
