// Phone page: join, answer every question at your own pace, then see all answers and the ranking.
import { PACK } from './questions.js';
import { prepareQuestion, judge, computeResults, tierOf, firstOpenQuestion } from './game.js';
import { getBackend, explainError } from './backend.js';
import { $, $$, esc, bandsHTML, tierPill } from './ui.js';
import { play, soundButtonHTML, bindSoundButton } from './sound.js';

const N = PACK.questions.length;
const READ_MS = 3000; // like Deep-Dive: read the prompt first, then the clock starts (typing is allowed meanwhile)
const PREP = PACK.questions.map(prepareQuestion);
const app = $('#app');
const params = new URLSearchParams(location.search);
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const S = {
  be: null, code: '', room: null, unwatch: null, seenMe: false,
  view: '', qi: 0, qStart: 0, timer: 0, misses: [], locking: false, pausedAt: 0, lastTick: -1, pinged: false, cheered: false,
  local: {},            // answers this tab has locked in (shown immediately, synced in the background)
  syncTimer: 0,
  openCards: new Set(), resultsKey: '',
};

// ---------- helpers ----------
const me = () => S.room?.players?.[S.be.uid] || null;
const myAnswers = () => ({ ...(me()?.answers || {}), ...S.local });
const myNextQ = () => firstOpenQuestion(PACK, { answers: myAnswers() });
const seconds = () => Number(S.room?.meta?.seconds) || PACK.seconds;
const playerList = () => Object.entries(S.room?.players || {})
  .filter(([, p]) => p && p.name)
  .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

function scoreSoFar() {
  const a = myAnswers();
  let s = 0;
  for (let i = 0; i < N; i++) {
    const t = a['q' + i] && a['q' + i].idx >= 0 ? tierOf(PACK, i, a['q' + i].idx) : null;
    if (t) s += t.points;
  }
  return s;
}

function roomWithLocal() {
  const room = structuredClone(S.room || {});
  room.players = room.players || {};
  const p = room.players[S.be.uid];
  if (p) {
    p.answers = { ...(p.answers || {}), ...S.local };
    if (myNextQ() >= N) p.done = true;
  }
  return room;
}

function everyoneDone() {
  const ps = playerList();
  return ps.length > 0 && ps.every(([u, p]) => p.done || (u === S.be.uid && myNextQ() >= N));
}

function top(right = '') {
  const demo = S.be?.mode === 'demo'
    ? '<p class="banner">Demo mode: works only between tabs in this browser. Add the Firebase config to play on phones.</p>' : '';
  return `<div class="top"><div class="brand"><span class="logo">It <em>Depends</em></span></div><div class="top-right">${right}${soundButtonHTML()}</div></div>${demo}`;
}

function setView(name, html) {
  stopTimer();
  S.view = name;
  app.innerHTML = html;
  bindSoundButton();
  window.scrollTo(0, 0);
}

function hud(qi) {
  const a = myAnswers();
  const blocks = PACK.questions.map((_, i) => {
    const x = a['q' + i];
    if (x) { const t = x.idx >= 0 ? tierOf(PACK, i, x.idx) : null; return `<i class="${t ? 'hit t' + t.tier : 'none'}"></i>`; }
    return `<i class="${i === qi ? 'now' : ''}"></i>`;
  }).join('');
  return `<div class="hud">
      <div class="hud-box"><span class="hud-label">Score</span><b>${scoreSoFar()}</b></div>
      <div class="rounds"><div class="round-blocks" aria-hidden="true">${blocks}</div><span>Question ${Math.min(qi + 1, N)} of ${N}</span></div>
      <div class="hud-box"><span class="hud-label">Time</span><b class="clock" id="tl">${seconds()}</b></div>
    </div>`;
}

function shake(node) {
  node.classList.remove('shake');
  void node.offsetWidth;
  node.classList.add('shake');
}

// ---------- boot ----------
async function boot() {
  try {
    S.be = await getBackend();
  } catch (e) {
    return showFatal(explainError(e));
  }
  const fromUrl = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const code = fromUrl || (ss.get('itd-room') || '');
  if (code.length !== 4) return showJoin('', '');
  try {
    const room = await S.be.getRoom(code);
    if (room?.players?.[S.be.uid]) return enterRoom(code, room);
    showJoin(code, room || !fromUrl ? '' : `No game found with code ${code}. Check the code on the big screen.`);
  } catch (e) {
    showJoin(code, explainError(e));
  }
}

// ---------- join ----------
function showJoin(code, error) {
  const saved = ls.get('itd-name') || '';
  setView('join', top() + `
    <div class="stack">
      <h1 class="hero-title">It <em>Depends</em></h1>
      <p class="muted">Moderation &amp; mediation, the deep end. The rarer your answer is in the readings, the deeper you dive.</p>
    </div>
    <form id="join" class="card stack" autocomplete="off" novalidate>
      <label class="field">Game code
        <input class="input code-input" name="code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(code)}" aria-describedby="join-err">
      </label>
      <label class="field">Your name <span>Shown on the big screen</span>
        <input class="input" name="player" maxlength="20" autocomplete="nickname" value="${esc(saved)}">
      </label>
      <p class="err" id="join-err" ${error ? '' : 'hidden'}>${esc(error)}</p>
      <button class="btn primary big" id="join-btn">Join game</button>
    </form>`);
  const form = $('#join');
  const codeEl = form.elements.namedItem('code');
  const nameEl = form.elements.namedItem('player');
  codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  (code.length === 4 ? nameEl : codeEl).focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const c = codeEl.value.toUpperCase().replace(/[^A-Z]/g, '');
    const name = nameEl.value.trim().replace(/\s+/g, ' ').slice(0, 20);
    const errEl = $('#join-err');
    const fail = msg => { errEl.hidden = false; errEl.textContent = msg; btn.disabled = false; btn.textContent = 'Join game'; };
    const btn = $('#join-btn');
    if (c.length !== 4) return fail('The game code is 4 letters. It is on the big screen.');
    if (!name) return fail('Add a name so we can put you on the leaderboard.');
    btn.disabled = true; btn.textContent = 'Joining…';
    try {
      const room = await S.be.getRoom(c);
      if (!room) return fail(`No game found with code ${c}.`);
      if (room.meta?.state === 'results' && !room.players?.[S.be.uid]) return fail('That game has already finished.');
      await S.be.joinRoom(c, name);
      play('join');
      ls.set('itd-name', name);
      enterRoom(c, null);
    } catch (err) {
      fail(explainError(err));
    }
  });
}

function enterRoom(code, room) {
  S.code = code;
  ss.set('itd-room', code);
  if (params.get('room') !== code) {
    params.set('room', code);
    history.replaceState(null, '', '?' + params.toString());
  }
  S.unwatch?.();
  S.seenMe = false;
  S.unwatch = S.be.watchRoom(code, onRoom, err => showFatal(explainError(err)));
  if (room) onRoom(room);
}

function onRoom(data) {
  S.room = data;
  if (!data) return showFatal('This game was closed. Ask the host for the new code.', true);
  if (!me()) {
    if (S.seenMe) {
      S.seenMe = false;
      S.unwatch?.();
      ss.del('itd-room');
      return showJoin(S.code, 'You were removed from this game. You can join again.');
    }
    return; // our own join has not arrived yet
  }
  S.seenMe = true;
  route();
}

// Decide which screen to show. Never interrupts the "you got it" card; the player taps on from there.
function route() {
  const state = S.room?.meta?.state || 'lobby';
  if (S.view === 'feedback') return;
  if (state === 'results' || (state === 'playing' && myNextQ() >= N && everyoneDone())) return showResults();
  if (state === 'lobby') return S.view === 'lobby' ? updateLobby() : showLobby();
  if (S.view === 'question') return;
  if (myNextQ() >= N) return S.view === 'waiting' ? updateWaiting() : showWaiting();
  showQuestion(myNextQ());
}

// ---------- lobby ----------
function showLobby() {
  setView('lobby', top() + `
    <div class="card stack center">
      <div class="waiting-orb" aria-hidden="true"></div>
      <h2>You're in, ${esc(me().name)}!</h2>
      <p class="muted">Eyes on the big screen. Your first question appears here when the host starts.</p>
      <p class="muted small">${N} questions · ${seconds()} seconds each · answer in 1–3 words</p>
    </div>
    <div class="card stack">
      <p class="muted small" id="lobby-count"></p>
      <ul class="tried" id="lobby-names" style="text-decoration:none"></ul>
    </div>`);
  updateLobby();
}

function updateLobby() {
  const ps = playerList();
  const c = $('#lobby-count');
  if (c) c.textContent = `${ps.length} ${ps.length === 1 ? 'diver' : 'divers'} in the game`;
  const ul = $('#lobby-names');
  if (ul) ul.innerHTML = ps.map(([u, p]) => `<li style="text-decoration:none;color:${u === S.be.uid ? 'var(--accent)' : 'var(--muted)'}">${esc(p.name)}</li>`).join('');
}

// ---------- question ----------
function showQuestion(qi) {
  S.qi = qi;
  S.locking = false;
  const key = `itd-q-${S.code}-${qi}`;
  let saved = null;
  try { saved = JSON.parse(ss.get(key) || 'null'); } catch {}
  S.qStart = saved?.start || Date.now() + READ_MS;
  S.misses = saved?.misses || [];
  S.pausedAt = 0;
  S.lastTick = -1;
  S.pinged = Date.now() >= S.qStart;
  saveQ();
  const q = PACK.questions[qi];
  setView('question', top() + hud(qi) + `
    <div class="timer" id="timer" role="progressbar" aria-label="Time left"><i></i></div>
    <p class="readline" id="readline" aria-live="polite"></p>
    <div class="question-card card">
      <p class="eyebrow">Question ${qi + 1} of ${N}</p>
      <p class="prompt">${esc(q.prompt)}</p>
      <p class="muted small" style="margin:0">▼ rarer answers sink deeper ▼</p>
    </div>
    <form id="ans" class="stack" autocomplete="off">
      <div class="answer-row">
        <input class="input" id="guess" maxlength="80" placeholder="1–3 words" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="Your answer">
        <button class="btn primary" id="go">Dive</button>
      </div>
      <div class="fb" id="fb" role="status" aria-live="polite"></div>
      <div id="confirm" hidden></div>
      <ul class="tried" id="tried" aria-label="Already tried"></ul>
    </form>
    <div class="center"><button class="btn link" id="skip" type="button">Skip this one (0 pts)</button></div>`);
  renderTried();
  $('#ans').addEventListener('submit', onGuess);
  $('#skip').addEventListener('click', () => lock({ idx: -1, raw: '', skipped: true }));
  $('#guess').focus();
  startTimer();
}

function onGuess(e) {
  e.preventDefault();
  if (S.locking) return;
  const input = $('#guess');
  const raw = input.value.trim();
  const fb = $('#fb');
  hideConfirm();
  const r = judge(PREP[S.qi], raw);
  if (r.kind === 'empty') return input.focus();
  if (r.kind === 'hit') return lock({ idx: r.idx, raw });
  if (r.kind === 'typo') return askConfirm(r.idx, raw);
  play('wrong');
  if (r.kind === 'nope') {
    addMiss(raw);
    fb.innerHTML = `<span class="nope">✗ ${esc(r.msg)}</span>`;
  } else if (r.kind === 'multi') {
    fb.innerHTML = '<span class="nope">That names more than one answer. Pick just one.</span>';
  } else {
    addMiss(raw);
    fb.innerHTML = `<span class="miss">“${esc(raw)}” isn't on the board. Try another word.</span>`;
  }
  shake(input);
  input.value = '';
  input.focus();
}

function askConfirm(idx, raw) {
  const a = PACK.questions[S.qi].answers[idx];
  const box = $('#confirm');
  $('#fb').innerHTML = '';
  play('blip');
  if (!S.pausedAt) S.pausedAt = Date.now(); // the clock pauses while you choose, like Deep-Dive
  box.hidden = false;
  box.innerHTML = `<div class="card confirm">
      <div>Did you mean <strong>${esc(a.text)}</strong>?</div>
      <div class="muted small">The clock is paused while you choose.</div>
      <div class="row">
        <button type="button" class="btn primary" id="yes">Yes, lock it in</button>
        <button type="button" class="btn" id="no">No, keep typing</button>
      </div>
    </div>`;
  $('#yes').addEventListener('click', () => lock({ idx, raw, typo: true }));
  $('#no').addEventListener('click', () => { hideConfirm(); const i = $('#guess'); i.select(); i.focus(); });
  $('#yes').focus();
}

function hideConfirm() {
  const box = $('#confirm');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  resumeClock();
}

function resumeClock() {
  if (!S.pausedAt) return;
  const now = Date.now();
  // Only time spent after the clock had started counts as paused time.
  const paused = now - Math.max(S.pausedAt, S.qStart);
  if (paused > 0) S.qStart += paused;
  S.pausedAt = 0;
  saveQ();
}

function saveQ() {
  ss.set(`itd-q-${S.code}-${S.qi}`, JSON.stringify({ start: S.qStart, misses: S.misses }));
}

function addMiss(raw) {
  if (!raw || S.misses.some(m => m.toLowerCase() === raw.toLowerCase())) return;
  if (S.misses.length < 8) S.misses.push(raw.slice(0, 60));
  saveQ();
  renderTried();
}

function renderTried() {
  const ul = $('#tried');
  if (ul) ul.innerHTML = S.misses.map(m => `<li>${esc(m)}</li>`).join('');
}

function startTimer() {
  stopTimer();
  const total = seconds() * 1000;
  const tick = () => {
    if (S.pausedAt && Date.now() >= S.qStart) return; // "Did you mean…?" is open
    const now = Date.now();
    const rl = $('#readline');
    if (now < S.qStart) {
      if (rl) rl.innerHTML = `Read the prompt · the clock starts in <b>${Math.ceil((S.qStart - now) / 1000)}</b> <span class="dim">(you can already type)</span>`;
      return;
    }
    if (!S.pinged) { S.pinged = true; play('ping'); }
    if (rl) rl.textContent = '';
    const left = Math.max(0, total - (now - S.qStart));
    const bar = $('#timer > i');
    if (bar) bar.style.transform = `scaleX(${left / total})`;
    const secs = Math.ceil(left / 1000);
    $('#timer')?.classList.toggle('low', left < 10000);
    const tl = $('#tl');
    if (tl) { tl.textContent = secs; tl.classList.toggle('urgent', secs <= 5); }
    if (secs <= 5 && secs > 0 && secs !== S.lastTick) { S.lastTick = secs; play('tick'); }
    if (left <= 0) { stopTimer(); lock({ idx: -1, raw: '', timeout: true }); }
  };
  tick();
  S.timer = setInterval(tick, 100);
}

function stopTimer() {
  if (S.timer) clearInterval(S.timer);
  S.timer = 0;
}

function lock(res) {
  if (S.locking || S.view !== 'question') return;
  S.locking = true;
  stopTimer();
  resumeClock();
  const qi = S.qi;
  const t = res.idx >= 0 ? tierOf(PACK, qi, res.idx) : null;
  play(t ? 'lock' : 'none', t?.tier);
  const ans = {
    raw: String(res.raw || '').slice(0, 120),
    idx: res.idx,
    ms: Math.max(0, Math.min(Date.now() - S.qStart, seconds() * 1000)),
    typo: !!res.typo,
    timeout: !!res.timeout,
    misses: S.misses.slice(0, 8),
  };
  S.local['q' + qi] = ans;
  showFeedback(qi, ans);
  sync();
}

// Push every locally locked answer; retry quietly until it lands.
async function sync() {
  clearTimeout(S.syncTimer);
  const patch = {};
  for (const [k, v] of Object.entries(S.local)) patch[`answers/${k}`] = v;
  patch.done = myNextQ() >= N;
  patch.progress = Math.min(myNextQ(), N);
  const msg = $('#savemsg');
  try {
    await S.be.savePlayer(S.code, patch);
    if (msg) msg.innerHTML = '';
  } catch (e) {
    if (msg) msg.innerHTML = `<p class="err small">Not saved yet (${esc(explainError(e))}). Retrying…</p>`;
    S.syncTimer = setTimeout(sync, 3000);
  }
}

// ---------- "you got it" card ----------
function showFeedback(qi, ans) {
  const t = ans.idx >= 0 ? tierOf(PACK, qi, ans.idx) : null;
  const last = qi === N - 1;
  const body = t ? `
    <div class="card stack reward t${t.tier}">
      <div class="tier-name">${esc(t.name)}</div>
      <p class="got-answer">“${esc(PACK.questions[qi].answers[ans.idx].text)}”</p>
      <div class="got-pts">+${t.points} pts</div>
      <div class="gauge" aria-hidden="true">${PACK.categories.map((c, i) => `<div class="lvl t${i}" data-i="${i}"><span>${esc(c.name)}</span><span>${c.points}</span></div>`).join('')}</div>
      <p class="muted small" style="margin:0">${ans.typo ? 'Typo fixed. Answer locked.' : 'Answer locked. Down you go.'}</p>
    </div>` : `
    <div class="card stack reward center">
      <div class="tier-name" style="color:var(--muted)">Drifting</div>
      <p class="got-answer">${ans.timeout ? "Time's up" : 'Skipped'}</p>
      <p class="muted" style="margin:0">No points this round. Every possible answer is revealed at the end.</p>
    </div>`;
  setView('feedback', top() + hud(qi) + `
    ${body}
    <div id="savemsg"></div>
    <button class="btn primary big" id="next">${last ? '▲ Surface &amp; see results' : 'Next question ▼'}</button>`);
  const clock = $('#tl');
  if (clock) clock.textContent = '–';
  if (t) {
    $$('.gauge .lvl').forEach((el, i) => {
      if (i > t.tier) return;
      setTimeout(() => el.classList.add(i === t.tier ? 'here' : 'passed'), 220 * i + 120);
    });
  }
  $('#next').addEventListener('click', () => { S.view = ''; route(); });
  $('#next').focus();
}

// ---------- waiting ----------
function showWaiting() {
  play('surface');
  setView('waiting', top() + `
    <div class="card stack center">
      <div class="waiting-orb" aria-hidden="true"></div>
      <h2>All ${N} done!</h2>
      <p style="margin:0"><span class="got-pts" style="--tc:var(--accent)">${scoreSoFar()}</span> <span class="muted">points before bonuses</span></p>
      <p class="muted" id="wait-count"></p>
      <p class="muted small">Your rank and every possible answer appear here when everyone finishes or the host ends the game.</p>
    </div>
    <div id="savemsg"></div>`);
  updateWaiting();
}

function updateWaiting() {
  const ps = playerList();
  const done = ps.filter(([u, p]) => p.done || u === S.be.uid).length;
  const el = $('#wait-count');
  if (el) el.textContent = `${done} of ${ps.length} divers finished`;
}

// ---------- results ----------
function showResults() {
  const R = computeResults(PACK, roomWithLocal());
  const key = JSON.stringify(R.rows.map(r => [r.uid, r.name, r.score, r.perQ.map(p => p.idx ?? p.state)]));
  if (S.view === 'results') {
    if (key === S.resultsKey) return;
    S.openCards = new Set($$('details.qcard[open]').map(d => d.dataset.qi));
  }
  S.resultsKey = key;
  if (!S.cheered) { S.cheered = true; play('fanfare'); }
  const mine = R.byUid[S.be.uid];
  const rank = mine ? `
    <div class="card rank-card">
      <p class="muted" style="margin:0">You placed</p>
      <div class="rank-big">#${mine.rank} <small>of ${R.rows.length}</small></div>
      <div class="got-pts" style="--tc:var(--accent)">${mine.score} pts</div>
      <p class="muted small" style="margin:0">${mine.base} from answers${mine.bonus ? ` + ${mine.bonus} lone-diver bonus ★` : ''}</p>
    </div>` : '';
  const board = `
    <section class="card stack">
      <h2 style="margin:0">Leaderboard</h2>
      <ol class="board">${R.rows.map(r => `
        <li class="${r.uid === S.be.uid ? 'me' : ''}">
          <span class="r">${r.rank}</span>
          <span class="n">${esc(r.name)}<span class="dots" aria-hidden="true">${r.perQ.map(p => (p.state === 'hit' ? `<i class="t${p.tier}"></i>` : '<i></i>')).join('')}</span></span>
          <span class="s">${r.score}</span>
        </li>`).join('')}
      </ol>
    </section>`;
  const cards = PACK.questions.map((q, qi) => {
    const p = mine?.perQ[qi] || { state: 'pending' };
    const mineLine = p.state === 'hit' ? `You: <strong>${esc(p.text)}</strong> ${tierPill(PACK, p.tier, p.bonus ? ' ★' : '')}` : 'You: no answer';
    return `
      <details class="card qcard" data-qi="${qi}" ${S.openCards.has(String(qi)) ? 'open' : ''}>
        <summary><span class="qt">Q${qi + 1}. ${esc(q.short)}</span><span class="chev" aria-hidden="true">▾</span><span class="mine-line">${mineLine}</span></summary>
        <div class="body">
          <p class="qprompt">${esc(q.prompt)}</p>
          <div class="bands">${bandsHTML(PACK, qi, { pickers: R.pickers, mineIdx: p.idx ?? -1, bonusOn: R.bonusOn })}</div>
          ${q.reject ? `<p class="reject-note">Not accepted: ${esc(q.reject)}</p>` : ''}
        </div>
      </details>`;
  }).join('');
  const keepScroll = S.view === 'results' ? window.scrollY : 0;
  setView('results', top() + rank + board + `
    <section class="stack">
      <h2 style="margin:0">Every answer</h2>
      <p class="muted small" style="margin:0">Tap a question. Your pick is outlined in white; the number is how many people found it.${R.bonusOn ? ' ★ = only one person found it (+25).' : ''}</p>
      ${cards}
    </section>`);
  if (keepScroll) window.scrollTo(0, keepScroll);
}

// ---------- errors ----------
function showFatal(msg, offerRejoin = false) {
  S.unwatch?.();
  setView('error', top() + `
    <div class="card stack">
      <p class="err">${esc(msg)}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="retry">Try again</button>
        ${offerRejoin ? '<button class="btn" id="rejoin">Join another game</button>' : ''}
      </div>
    </div>`);
  $('#retry').addEventListener('click', () => location.reload());
  $('#rejoin')?.addEventListener('click', () => { ss.del('itd-room'); params.delete('room'); history.replaceState(null, '', params.toString() ? '?' + params : location.pathname); showJoin('', ''); });
}

boot();
