// Big-screen page: room code + QR, live progress, then a question-by-question reveal and the leaderboard.
import { PACK } from './questions.js';
import { computeResults, firstOpenQuestion, BONUS_POINTS } from './game.js';
import { getBackend, explainError } from './backend.js';
import { $, $$, esc, qrSvg, bandsHTML, fmtSeconds } from './ui.js';
import { play, soundButtonHTML, bindSoundButton } from './sound.js';

const N = PACK.questions.length;
const LAST_STEP = N + 1;           // 0 = intro, 1..N = questions, N+1 = leaderboard
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, so codes never spell words
const app = $('#app');
const params = new URLSearchParams(location.search);

const H = {
  be: null, code: '', room: null, unwatch: null,
  view: '', step: 0, autoEnded: false, joinUrl: '', clock: 0, revealKey: '',
  seenPlayers: null, seenAnswers: null, soundTimers: [],
};
const players = () => Object.entries(H.room?.players || {})
  .filter(([, p]) => p && p.name)
  .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
const allDone = () => { const ps = players(); return ps.length > 0 && ps.every(([, p]) => p.done); };

function frame(inner, foot = '', right = '') {
  const demo = H.be?.mode === 'demo'
    ? '<span class="banner">Demo mode: phones can’t connect until the Firebase config is added. Test with extra tabs.</span>' : '';
  return `<div class="host">
    <div class="top">
      <div class="brand"><span class="logo">It <em>Depends</em></span><span class="sub">Moderation &amp; mediation</span></div>
      <div class="top-right">${demo}${right}${soundButtonHTML()}</div>
    </div>
    ${inner}
    <div class="foot">${foot}</div>
  </div>`;
}

function setView(name, html) {
  H.view = name;
  app.innerHTML = html;
  bindSoundButton();
  if (name !== 'play') clearInterval(H.clock);
  H.soundTimers.forEach(clearTimeout);
  H.soundTimers = [];
}

// Pops when someone joins; a bubble (pitched by tier) when someone locks in an answer.
function roomSounds(state) {
  const ps = players();
  const answers = new Map();
  for (const [u, p] of ps) for (const [k, a] of Object.entries(p.answers || {})) answers.set(`${u}/${k}`, a);
  if (H.seenPlayers && state === 'lobby' && ps.some(([u]) => !H.seenPlayers.has(u))) play('pop');
  if (H.seenAnswers && state === 'playing') {
    let deepest = -1, any = false;
    for (const [key, a] of answers) {
      if (H.seenAnswers.has(key)) continue;
      any = true;
      const qi = Number(key.split('/q')[1]);
      const ans = PACK.questions[qi]?.answers[a.idx];
      if (ans) deepest = Math.max(deepest, PACK.categories.findIndex(c => c.id === ans.category));
    }
    if (any) play('bubble', Math.max(0, deepest));
  }
  H.seenPlayers = new Set(ps.map(([u]) => u));
  H.seenAnswers = new Set(answers.keys());
}

// ---------- boot ----------
async function boot() {
  try {
    H.be = await getBackend();
    const code = (params.get('room') || '').toUpperCase();
    if (/^[A-Z]{4}$/.test(code)) {
      const room = await H.be.getRoom(code);
      if (room?.meta?.host === H.be.uid) return openRoom(code);
    }
    await newRoom();
  } catch (e) {
    fatal(explainError(e));
  }
}

async function newRoom() {
  let code = '';
  for (let i = 0; i < 25; i++) {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
    if (!(await H.be.getRoom(code))) break;
  }
  await H.be.createRoom(code, {
    host: H.be.uid, state: 'lobby', createdAt: Date.now(), startedAt: 0, endedAt: 0,
    seconds: PACK.seconds, bonus: true,
  });
  H.autoEnded = false;
  H.step = 0;
  H.view = '';
  openRoom(code);
}

function openRoom(code) {
  H.code = code;
  params.set('room', code);
  history.replaceState(null, '', '?' + params.toString());
  const u = new URL('./', location.href);
  u.search = '';
  u.searchParams.set('room', code);
  if (H.be.mode === 'demo') u.searchParams.set('demo', '1');
  H.joinUrl = u.href;
  H.unwatch?.();
  H.unwatch = H.be.watchRoom(code, onRoom, e => fatal(explainError(e)));
}

function onRoom(data) {
  H.room = data;
  if (!data) return fatal('This room no longer exists. Reload to start a new one.');
  const state = data.meta?.state || 'lobby';
  roomSounds(state);
  if (state === 'lobby') return H.view === 'lobby' ? updateLobby() : showLobby();
  if (state === 'playing') {
    // Firebase can deliver the "results" update synchronously inside endGame(), which already
    // switches to the reveal, so don't redraw the progress board afterwards.
    if (allDone() && !H.autoEnded) { H.autoEnded = true; endGame(); return; }
    return H.view === 'play' ? updatePlay() : showPlay();
  }
  if (state === 'results') {
    if (H.view !== 'reveal') { H.step = 0; return showStep(true); }
    showStep(false);
  }
}

// ---------- lobby ----------
function displayUrl() {
  const u = new URL(H.joinUrl);
  return (u.host + u.pathname).replace(/\/$/, '');
}

function showLobby() {
  const qr = qrSvg(H.joinUrl);
  setView('lobby', frame(`
    <div class="lobby-grid">
      <div class="card join-panel">
        <h2>Join on your phone</h2>
        ${qr ? `<div class="qr">${qr}</div>` : '<p class="muted">(QR code could not load. Use the link below.)</p>'}
        <a class="join-url" href="${esc(H.joinUrl)}" target="_blank" rel="noopener" style="color:inherit">${esc(displayUrl())}</a>
        <div class="muted">Game code</div>
        <div class="room-code" aria-label="Game code ${H.code.split('').join(' ')}">${esc(H.code)}</div>
      </div>
      <div class="players-panel">
        <div class="count" id="pcount"></div>
        <ul class="name-cloud" id="pnames"></ul>
        <div class="card stack">
          <strong>How it works</strong>
          <span class="muted">${N} questions on the readings, answered on your phone. Type 1–3 words. Common answers sit in the shallows; the rarer your answer in the readings, the deeper it sinks and the more it scores.</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${PACK.categories.map((c, i) => `<span class="pill t${i}">${esc(c.name)} · ${c.points}</span>`).join('')}</div>
        </div>
      </div>
    </div>`, `
    <div class="settings">
      <span>Seconds per question</span>
      <div class="seg" id="secs">${[30, 45, 60].map(s => `<button type="button" data-s="${s}">${s}</button>`).join('')}</div>
      <label class="toggle"><input type="checkbox" id="bonus"> Lone-diver bonus: +${BONUS_POINTS} for an answer nobody else found</label>
    </div>
    <button class="btn primary big" id="start" disabled>Start game</button>`));
  $('#secs').addEventListener('click', e => {
    const s = Number(e.target.closest('button')?.dataset.s);
    if (s) H.be.updateMeta(H.code, { seconds: s }).catch(err => fatal(explainError(err)));
  });
  $('#bonus').addEventListener('change', e => H.be.updateMeta(H.code, { bonus: e.target.checked }).catch(err => fatal(explainError(err))));
  $('#start').addEventListener('click', startGame);
  $('#pnames').addEventListener('click', e => {
    const b = e.target.closest('button[data-uid]');
    if (b && confirm(`Remove ${b.dataset.name} from the game?`)) H.be.removePlayer(H.code, b.dataset.uid).catch(err => fatal(explainError(err)));
  });
  updateLobby();
}

function updateLobby() {
  const ps = players();
  const meta = H.room.meta;
  $('#pcount').textContent = ps.length ? `${ps.length} ${ps.length === 1 ? 'diver' : 'divers'} ready` : 'Waiting for the first diver…';
  $('#pnames').innerHTML = ps.map(([u, p]) => `<li>${esc(p.name)}<button class="x" type="button" data-uid="${esc(u)}" data-name="${esc(p.name)}" aria-label="Remove ${esc(p.name)}" title="Remove">×</button></li>`).join('');
  $$('#secs button').forEach(b => b.classList.toggle('on', Number(b.dataset.s) === Number(meta.seconds)));
  $('#bonus').checked = meta.bonus !== false;
  $('#start').disabled = ps.length === 0;
}

async function startGame() {
  $('#start').disabled = true;
  play('start');
  try {
    await H.be.updateMeta(H.code, { state: 'playing', startedAt: Date.now() });
  } catch (e) {
    fatal(explainError(e));
  }
}

// ---------- live progress ----------
function showPlay() {
  setView('play', frame(`
    <div class="progress-wrap">
      <div class="progress-head">
        <div><div class="big-stat" id="fin"></div><div class="muted" id="elapsed"></div></div>
        <div class="legend">${PACK.categories.map((c, i) => `<span class="pill t${i}">${esc(c.name)}</span>`).join('')}</div>
      </div>
      <div class="ptable" id="ptable"></div>
    </div>`, `
    <span class="muted">Late? Join at <strong>${esc(displayUrl())}</strong> with code <strong>${esc(H.code)}</strong></span>
    <button class="btn primary big" id="end">End game &amp; reveal</button>`));
  $('#end').addEventListener('click', () => {
    const left = players().filter(([, p]) => !p.done).length;
    if (!left || confirm(`${left} ${left === 1 ? 'diver is' : 'divers are'} still playing. End the game now?`)) endGame();
  });
  clearInterval(H.clock);
  const tick = () => {
    const el = $('#elapsed');
    if (el && H.room?.meta?.startedAt) el.textContent = `${fmtSeconds(Date.now() - H.room.meta.startedAt)} elapsed · ${H.room.meta.seconds}s per question`;
  };
  tick();
  H.clock = setInterval(tick, 1000);
  updatePlay();
}

function updatePlay() {
  const ps = players();
  const R = computeResults(PACK, H.room);
  const done = ps.filter(([, p]) => p.done).length;
  $('#fin').textContent = `${done} of ${ps.length} finished`;
  $('#ptable').innerHTML = ps.map(([u, p]) => {
    const row = R.byUid[u];
    const next = firstOpenQuestion(PACK, p);
    const cells = row.perQ.map((q, i) => {
      if (q.state === 'hit') return `<span class="cell hit t${q.tier}" title="Q${i + 1}"></span>`;
      if (q.state === 'none') return `<span class="cell none" title="Q${i + 1}: no answer"></span>`;
      return `<span class="cell ${i === next ? 'now' : ''}" title="Q${i + 1}"></span>`;
    }).join('');
    return `<div class="prow ${p.done ? 'done' : ''}"><span class="pn">${esc(p.name)}${p.done ? ' ✓' : ''}</span><span class="cells">${cells}</span></div>`;
  }).join('') || '<p class="muted">Nobody has joined yet.</p>';
}

async function endGame() {
  try {
    await H.be.updateMeta(H.code, { state: 'results', endedAt: Date.now() });
  } catch (e) {
    fatal(explainError(e));
  }
}

// ---------- reveal ----------
function nav(prevLabel, nextLabel) {
  return `
    <button class="btn" id="prev" ${H.step === 0 ? 'disabled' : ''}>← ${prevLabel}</button>
    <span class="muted small">Arrow keys or a presentation clicker work too</span>
    ${nextLabel ? `<button class="btn primary big" id="next">${nextLabel} →</button>` : '<button class="btn" id="again">New game</button>'}`;
}

function showStep(animate) {
  const R = computeResults(PACK, H.room);
  const key = H.step + '|' + JSON.stringify(R.rows.map(r => [r.uid, r.score, r.perQ.map(p => p.idx ?? p.state)]));
  if (!animate && H.view === 'reveal' && key === H.revealKey) return;
  H.revealKey = key;
  const nameOf = u => H.room.players?.[u]?.name || '?';

  let inner, foot;
  if (H.step === 0) {
    const found = R.rows.reduce((n, r) => n + r.hits, 0);
    inner = `<div class="center-stage">
      <p class="huge">${R.rows.every(r => r.done) ? 'Everyone’s surfaced.' : 'Time to surface.'}</p>
      <p class="muted" style="font-size:clamp(1.1rem,1.8vw,1.8rem)">${R.rows.length} ${R.rows.length === 1 ? 'diver' : 'divers'} · ${found} ${found === 1 ? 'answer' : 'answers'} found · let’s see how deep you went</p>
    </div>`;
    foot = nav('Back', 'Reveal question 1');
  } else if (H.step <= N) {
    const qi = H.step - 1;
    const q = PACK.questions[qi];
    const misses = new Map();
    for (const m of R.misses[qi]) {
      const k = m.text.toLowerCase();
      const cur = misses.get(k) || { text: m.text, n: 0 };
      cur.n++;
      misses.set(k, cur);
    }
    const missTags = [...misses.values()].sort((a, b) => b.n - a.n).slice(0, 14)
      .map(m => `<span class="tag">${esc(m.text)}${m.n > 1 ? ` ×${m.n}` : ''}</span>`).join('');
    const nobody = R.rows.filter(r => r.perQ[qi].state !== 'hit').map(r => esc(r.name));
    inner = `<div class="stack" style="display:grid;gap:clamp(10px,1.2vw,18px);align-content:start">
      <div class="reveal-head">
        <span class="kicker">Question ${qi + 1} of ${N}</span>
        <h2>${esc(q.short)}</h2>
        <p class="rprompt">${esc(q.prompt)}</p>
      </div>
      <div class="bands ${animate ? 'reveal' : ''}" id="bands">${bandsHTML(PACK, qi, { pickers: R.pickers, nameOf, showNames: true, bonusOn: R.bonusOn })}</div>
      ${missTags ? `<div class="offboard"><span>Tried, not on the board:</span>${missTags}</div>` : ''}
      ${nobody.length ? `<div class="offboard"><span>No answer:</span> ${nobody.join(', ')}</div>` : ''}
      <div class="source-line" id="src">${q.reject ? `Not accepted: ${esc(q.reject)}` : 'Click an answer to see its source.'}</div>
    </div>`;
    foot = nav(qi === 0 ? 'Intro' : `Question ${qi}`, qi === N - 1 ? 'Leaderboard' : `Question ${qi + 2}`);
  } else {
    const topScore = Math.max(1, ...R.rows.map(r => r.score));
    const rows = R.rows.map((r, i) => {
      const segs = r.perQ.filter(p => p.state === 'hit')
        .map(p => `<i class="t${p.tier}" style="width:${(p.points / topScore) * 100}%"></i>`).join('')
        + (r.bonus ? `<i style="width:${(r.bonus / topScore) * 100}%;background:#fff"></i>` : '');
      const delay = animate ? (R.rows.length - 1 - i) * 0.3 : 0;
      return `<li class="${i === 0 ? 'top1' : ''}" style="animation-delay:${delay}s">
        <span class="r">${r.rank}</span><span class="n">${esc(r.name)}</span>
        <span class="bar">${segs}</span><span class="s">${r.score}</span></li>`;
    }).join('');
    inner = `<div style="display:grid;gap:18px;align-content:start">
      <h2>Leaderboard</h2>
      <ol class="leader">${rows}</ol>
      <p class="muted small">Bar colours show the tier of each answer${R.bonusOn ? '; white is the lone-diver bonus' : ''}. Ties go to whoever answered faster.</p>
    </div>`;
    foot = nav(`Question ${N}`, '');
  }
  setView('reveal', frame(inner, foot, `<span class="muted">Code ${esc(H.code)}</span>`));
  if (animate) {
    const later = (ms, fn) => H.soundTimers.push(setTimeout(fn, ms));
    if (H.step === 0) play('surface');
    else if (H.step <= N) $$('#bands .band').forEach(b => { const i = Number(b.style.getPropertyValue('--i')); later(i * 550 + 80, () => play('whoosh', i)); });
    else later(Math.max(0, R.rows.length - 1) * 300 + 250, () => play('fanfare'));
  }
  $('#prev')?.addEventListener('click', () => go(-1));
  $('#next')?.addEventListener('click', () => go(1));
  $('#again')?.addEventListener('click', () => {
    if (confirm('Start a brand-new game? Everyone will need to join again with the new code.')) newRoom().catch(e => fatal(explainError(e)));
  });
  $('#bands')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const a = PACK.questions[H.step - 1].answers[Number(chip.dataset.ai)];
    $('#src').innerHTML = `<strong>${esc(a.text)}</strong>: ${esc(a.src)}`;
  });
}

function go(d) {
  if (H.view !== 'reveal') return;
  const next = Math.min(LAST_STEP, Math.max(0, H.step + d));
  if (next === H.step) return;
  H.step = next;
  showStep(true);
}

document.addEventListener('keydown', e => {
  if (H.view !== 'reveal' || (e.target instanceof Element && e.target.closest('input, textarea, select'))) return;
  if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); go(1); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
});

function fatal(msg) {
  clearInterval(H.clock);
  H.view = 'error';
  app.innerHTML = frame(`<div class="card stack" style="max-width:720px"><p class="err">${esc(msg)}</p><div><button class="btn primary" id="reload">Reload</button></div></div>`);
  $('#reload').addEventListener('click', () => location.reload());
}

boot();
