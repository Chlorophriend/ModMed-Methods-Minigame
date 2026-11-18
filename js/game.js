// It Depends: shared game logic (answer matching + scoring). No DOM, no network.

export const BONUS_POINTS = 25;      // "Lone diver" bonus for an answer nobody else in the room gave
export const BONUS_MIN_PLAYERS = 3;  // bonus only applies once at least this many people have answered

export function norm(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .trim().replace(/\s+/g, ' ');
}

const STOP = new Set(['the']);

// Loose word list: punctuation and "the" dropped, simple plurals folded ("mediators" -> "mediator").
export function tokens(s) {
  return norm(s).replace(/'/g, '')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .split(' ')
    .filter(w => w && !STOP.has(w))
    .map(w => (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) ? w.slice(0, -1) : w);
}

export const compact = s => tokens(s).join('');

// Optimal-string-alignment distance (typos + swapped neighbours), with early exit above `max`.
export function osa(a, b, max = 2) {
  a = Array.from(a); b = Array.from(b);
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d.push(new Array(b.length + 1).fill(0)); d[i][0] = i; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// How many typos we forgive, by length of the accepted answer (letters only).
export const typoAllowance = len => (len <= 3 ? 0 : len <= 7 ? 1 : 2);

function containsSeq(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function prepareQuestion(q) {
  const exact = new Map(), loose = new Map(), fuzzy = [], phrases = [], nopes = [];
  q.answers.forEach((a, idx) => {
    for (const s of [a.text, ...(a.aliases || [])]) {
      const n = norm(s);
      if (n && !exact.has(n)) exact.set(n, idx);
      const t = tokens(s), c = t.join('');
      if (!c) continue;
      if (!loose.has(c)) loose.set(c, idx);
      fuzzy.push([c, idx]);
      if (c.length >= 4) phrases.push([t, idx]);
    }
  });
  for (const rule of q.nope || []) {
    for (const s of rule.words) {
      const t = tokens(s);
      if (t.length) nopes.push([t, t.join(''), rule.msg]);
    }
  }
  return { exact, loose, fuzzy, phrases, nopes };
}

/**
 * Judge one typed guess.
 *  hit   -> accepted outright (exact or loose match)          {kind, idx}
 *  typo  -> close to an answer; ask "Did you mean ...?"       {kind, idx, via: 'typo'|'phrase'}
 *  nope  -> a known wrong answer with a teaching message      {kind, msg}
 *  multi -> mentions two different answers; pick one          {kind}
 *  miss / empty
 */
export function judge(prep, input) {
  const n = norm(input);
  if (!n) return { kind: 'empty' };
  if (prep.exact.has(n)) return { kind: 'hit', idx: prep.exact.get(n) };
  const t = tokens(input), c = t.join('');
  if (!c) return { kind: 'miss' };
  if (prep.loose.has(c)) return { kind: 'hit', idx: prep.loose.get(c) };
  for (const [, nc, msg] of prep.nopes) if (nc === c) return { kind: 'nope', msg };

  if (c.length >= 3) {
    let best = null;
    for (const [k, idx] of prep.fuzzy) {
      const lim = typoAllowance(k.length);
      if (!lim) continue;
      const dist = osa(c, k, lim);
      if (dist <= lim && (!best || dist < best.dist)) best = { dist, idx };
    }
    if (best) return { kind: 'typo', idx: best.idx, via: 'typo' };
  }

  if (t.length <= 6) {
    const found = new Set();
    for (const [pt, idx] of prep.phrases) if (pt.length < t.length && containsSeq(t, pt)) found.add(idx);
    if (found.size === 1) return { kind: 'typo', idx: [...found][0], via: 'phrase' };
    if (found.size > 1) return { kind: 'multi' };
    for (const [nt, , msg] of prep.nopes) if (containsSeq(t, nt)) return { kind: 'nope', msg };
  }
  return { kind: 'miss' };
}

export function tierOf(pack, qi, idx) {
  const a = pack.questions[qi]?.answers[idx];
  if (!a) return null;
  const tier = pack.categories.findIndex(c => c.id === a.category);
  return { ...pack.categories[tier], tier };
}

const list = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

/** Everything the reveal screens need, computed the same way on every device. */
export function computeResults(pack, room) {
  const meta = room?.meta || {};
  const players = room?.players || {};
  const uids = Object.keys(players).filter(u => players[u] && players[u].name);
  const answered = uids.filter(u => Object.keys(players[u].answers || {}).length > 0);
  const bonusOn = meta.bonus !== false && answered.length >= BONUS_MIN_PLAYERS;
  const pickers = pack.questions.map(q => q.answers.map(() => []));
  const misses = pack.questions.map(() => []);

  for (const u of uids) {
    const ans = players[u].answers || {};
    pack.questions.forEach((q, qi) => {
      const a = ans['q' + qi];
      if (!a) return;
      if (a.idx >= 0 && a.idx < q.answers.length) pickers[qi][a.idx].push(u);
      for (const m of list(a.misses)) if (typeof m === 'string' && m.trim()) misses[qi].push({ uid: u, text: m.trim() });
    });
  }

  const rows = uids.map(u => {
    const p = players[u], ans = p.answers || {};
    let base = 0, bonus = 0, ms = 0, hits = 0;
    const perQ = pack.questions.map((q, qi) => {
      const a = ans['q' + qi];
      if (!a) return { state: 'pending' };
      ms += Math.max(0, Number(a.ms) || 0);
      if (!(a.idx >= 0 && a.idx < q.answers.length)) return { state: 'none', timeout: !!a.timeout };
      const t = tierOf(pack, qi, a.idx);
      const b = bonusOn && pickers[qi][a.idx].length === 1 ? BONUS_POINTS : 0;
      base += t.points; bonus += b; hits++;
      return { state: 'hit', idx: a.idx, tier: t.tier, points: t.points, bonus: b, text: q.answers[a.idx].text };
    });
    return { uid: u, name: p.name, base, bonus, score: base + bonus, ms, hits, done: !!p.done, perQ };
  });
  rows.sort((a, b) => b.score - a.score || a.ms - b.ms || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows, pickers, misses, bonusOn, byUid: Object.fromEntries(rows.map(r => [r.uid, r])) };
}

export function firstOpenQuestion(pack, player) {
  const ans = player?.answers || {};
  for (let i = 0; i < pack.questions.length; i++) if (!ans['q' + i]) return i;
  return pack.questions.length;
}
