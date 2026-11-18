// Small DOM helpers shared by the phone and big-screen pages.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), m = 2, size = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code to join the game"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#06101f"/></svg>`;
}

export function tierPill(pack, tier, extra = '') {
  const c = pack.categories[tier];
  return `<span class="pill t${tier}">${esc(c.name)} · ${c.points}${extra}</span>`;
}

/**
 * All answers for one question, grouped into tier bands (shallowest first).
 * opts: pickers (results.pickers), nameOf(uid), mineIdx, showNames, bonusOn, sources
 */
export function bandsHTML(pack, qi, opts = {}) {
  const { pickers, nameOf = u => u, mineIdx = -1, showNames = false, bonusOn = false } = opts;
  const q = pack.questions[qi];
  return pack.categories.map((cat, ti) => {
    const items = q.answers.map((a, ai) => ({ a, ai })).filter(x => x.a.category === cat.id);
    if (!items.length) return '';
    const chips = items.map(({ a, ai }) => {
      const who = pickers?.[qi]?.[ai] || [];
      const picked = who.length > 0;
      const lone = bonusOn && who.length === 1;
      const cls = ['chip', picked ? 'picked' : '', ai === mineIdx ? 'mine' : ''].filter(Boolean).join(' ');
      return `<li class="${cls}" data-ai="${ai}" title="${esc(a.src || '')}">`
        + `<span class="chip-text">${esc(a.text)}</span>`
        + (picked ? `<span class="chip-count" aria-label="${who.length} picked this">${who.length}</span>` : '')
        + (lone ? '<span class="lone" title="Lone diver bonus: only one person found this">★</span>' : '')
        + (showNames && picked ? `<span class="chip-names">${who.map(u => esc(nameOf(u))).join(', ')}</span>` : '')
        + '</li>';
    }).join('');
    return `<section class="band t${ti}" style="--i:${ti}"><header><span class="band-name">${esc(cat.name)}</span><span class="band-pts">${cat.points} pts</span></header><ul class="chips">${chips}</ul></section>`;
  }).join('');
}

export function fmtSeconds(ms) {
  const s = Math.round((ms || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
