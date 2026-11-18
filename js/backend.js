// Picks the live Firebase backend, or the local demo backend when no config is set (or ?demo is in the URL).
// Both expose the same small API:
//   uid, mode
//   getRoom(code) -> {meta, players} | null
//   createRoom(code, meta)
//   watchRoom(code, onData, onError) -> unsubscribe()
//   updateMeta(code, patch)
//   joinRoom(code, name)
//   savePlayer(code, patch)          // patch keys may be paths like "answers/q0"
//   removePlayer(code, uid)
import { firebaseConfig } from './firebase-config.js';

export const isDemoRequested = () => new URLSearchParams(location.search).has('demo');

export async function getBackend() {
  const configured = firebaseConfig && typeof firebaseConfig === 'object' && firebaseConfig.apiKey;
  if (!configured || isDemoRequested()) {
    const { createDemoBackend } = await import('./backend-demo.js');
    return createDemoBackend();
  }
  const { createFirebaseBackend } = await import('./backend-firebase.js');
  return createFirebaseBackend(firebaseConfig);
}

export function explainError(e) {
  const code = String(e?.code || '');
  const msg = String(e?.message || e || '');
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation')
    return 'Anonymous sign-in is turned off. In Firebase: Build → Authentication → Sign-in method → Anonymous → Enable.';
  if (code === 'auth/network-request-failed' || /network|offline/i.test(msg))
    return 'No connection to Firebase. Check the Wi-Fi and try again.';
  if (/permission[_ ]denied/i.test(code + msg))
    return 'The database refused the request. Paste the rules from database.rules.json into Realtime Database → Rules and publish them.';
  if (/database url|databaseURL/i.test(msg))
    return 'The Firebase config is missing databaseURL. Copy it from Realtime Database → Data (the URL at the top).';
  if (/api-key|invalid-api-key/i.test(code + msg))
    return 'The Firebase config looks wrong. Paste it again from Project settings → Your apps.';
  return msg || 'Something went wrong.';
}
