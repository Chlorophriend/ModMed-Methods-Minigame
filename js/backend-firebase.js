// Live backend: Firebase Realtime Database + anonymous sign-in (both free on the Spark plan).
const V = '10.12.2';
const SDK = `https://www.gstatic.com/firebasejs/${V}`;

export async function createFirebaseBackend(config) {
  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const app = appMod.initializeApp(config);
  // Session persistence: each browser tab is its own player, and a refresh keeps the same identity.
  const auth = authMod.initializeAuth(app, { persistence: authMod.browserSessionPersistence });
  const existing = await new Promise(resolve => {
    const off = authMod.onAuthStateChanged(auth, u => { off(); resolve(u); });
  });
  const user = existing || (await authMod.signInAnonymously(auth)).user;
  const uid = user.uid;
  const db = dbMod.getDatabase(app);
  const r = p => dbMod.ref(db, p);

  return {
    mode: 'firebase',
    uid,
    async getRoom(code) {
      const s = await dbMod.get(r(`rooms/${code}`));
      return s.exists() ? s.val() : null;
    },
    createRoom(code, meta) {
      return dbMod.set(r(`rooms/${code}/meta`), meta);
    },
    watchRoom(code, onData, onError) {
      return dbMod.onValue(r(`rooms/${code}`), s => onData(s.exists() ? s.val() : null), e => onError && onError(e));
    },
    updateMeta(code, patch) {
      return dbMod.update(r(`rooms/${code}/meta`), patch);
    },
    joinRoom(code, name) {
      return dbMod.update(r(`rooms/${code}/players/${uid}`), { name, joinedAt: Date.now() });
    },
    savePlayer(code, patch) {
      return dbMod.update(r(`rooms/${code}/players/${uid}`), patch);
    },
    removePlayer(code, playerUid) {
      return dbMod.remove(r(`rooms/${code}/players/${playerUid}`));
    },
  };
}
