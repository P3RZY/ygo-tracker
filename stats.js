// ─────────────────────────────────────────────
// STATISTICHE — Panoramica (mazzo da battere, podio, chi batte chi) e Mazzi (schede per giocatore)
//
// Tutto in percentuale e per mazzo. Un mazzo entra in classifica da VIZ_MIN_GAMES partite,
// e uno scontro diretto mostra la percentuale solo da VIZ_MIN_GAMES partite tra quei due mazzi.
// Riusa vizDeckStats / vizPct / vizOwner di charts.js.
// Le animazioni partono solo quando si apre la pagina o si cambia scheda (statsAnimate),
// non a ogni aggiornamento dei dati; con "riduci animazioni" attivo non partono.
// ─────────────────────────────────────────────
let statsAnimate = false;
const STATS_GRID_MAX = 8;        // oltre, su telefono le caselle della griglia diventano illeggibili
const STATS_SEP = '\u0001';

function statsData() {
  const ms = [...state.matches].filter(m => state.players[m.p1i] && state.players[m.p2i]).sort((a, b) => a.ts - b.ts);
  const decks = vizDeckStats(ms);
  const h2h = new Map();       // "mazzoA␁mazzoB" → [vittorie di A, partite]
  ms.forEach(m => {
    const n1 = state.players[m.p1i].decks[m.d1i], n2 = state.players[m.p2i].decks[m.d2i];
    if (n1 == null || n2 == null) return;
    const a = `${m.p1i}::${n1}`, b = `${m.p2i}::${n2}`;
    const add = (x, y, won) => { const k = x + STATS_SEP + y, r = h2h.get(k) || [0, 0]; r[1]++; if (won) r[0]++; h2h.set(k, r); };
    add(a, b, m.winner === m.p1i);
    add(b, a, m.winner === m.p2i);
  });
  const byRate = (x, y) => y.wins / y.games - x.wins / x.games || y.games - x.games;
  const ranked = decks.filter(d => d.games >= VIZ_MIN_GAMES).sort(byRate);
  return { ms, decks, h2h, ranked, byRate };
}

/** Avvia le animazioni d'ingresso su un contenitore appena disegnato (una volta sola). */
function statsEnter(c) {
  const animate = statsAnimate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  statsAnimate = false;
  c.classList.toggle('st-anim', animate);
  if (!animate) return;
  // Numeri che salgono fino al valore: 700ms, rallentando alla fine
  c.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, t0 = performance.now(), dur = 700;
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  });
}

/** Andamento del win rate: linea 2px, velo sotto, riferimento al 50%, punto finale. */
function statsSpark(history, color) {
  if (history.length < 2) return '';
  const W = 200, H = 34, n = history.length;
  const x = i => 4 + i * (W - 8) / (n - 1), y = v => 3 + (H - 6) * (1 - v / 100);
  const pts = history.map((h, i) => `${x(i).toFixed(1)},${y(h.pct).toFixed(1)}`).join(' ');
  return `<svg class="st-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Andamento del win rate, ora ${Math.round(history[n - 1].pct)}%">
    <line x1="0" x2="${W}" y1="${y(50)}" y2="${y(50)}" stroke="var(--border2)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    <polygon points="${x(0)},${H} ${pts} ${x(n - 1)},${H}" fill="${color}" opacity="0.1"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function statsRing(pct, color) {
  const r = 26, C = 2 * Math.PI * r, len = C * pct / 100;
  return `<div class="st-ring"><svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="6"/>
    <circle class="st-ring-arc" cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" style="--len:${len.toFixed(1)}"/></svg>
    <b><span data-count="${pct}">${pct}</span>%</b></div>`;
}

/** Contro chi un mazzo va meglio e contro chi soffre (solo scontri con abbastanza partite). */
function statsMatchups(d, data) {
  let hi = null, lo = null;
  data.decks.forEach(e => {
    const r = data.h2h.get(d.key + STATS_SEP + e.key);
    if (!r || r[1] < VIZ_MIN_GAMES) return;
    const p = Math.round(r[0] / r[1] * 100);
    if (!hi || p > hi.p) hi = { e, p };
    if (!lo || p < lo.p) lo = { e, p };
  });
  // "Meglio" solo se sopra il 50%, "soffre" solo se sotto: un 50% non è né l'uno né l'altro
  const good = hi && hi.p > 50 ? `Meglio contro <i>${escH(hi.e.name)}</i> <i class="w">${hi.p}%</i>` : '';
  const bad  = lo && lo.p < 50 ? `Soffre contro <i>${escH(lo.e.name)}</i> <i class="l">${lo.p}%</i>` : '';
  return good || bad ? `<div class="st-vs">${[good, bad].filter(Boolean).join('<br>')}</div>` : '';
}

// ── Panoramica ───────────────────────────────────────────────────────────────
function renderOverview() {
  const c = document.getElementById('tab-stats');
  if (!c) return;
  const data = statsData();
  if (!data.ms.length) {
    c.innerHTML = '<div class="empty">Nessuna partita registrata.<br><small>Gioca un duello o registra un risultato da Partite.</small></div>';
    return;
  }
  const [champ, ...rest] = data.ranked;
  const hero = champ ? `
    <section class="st-hero" aria-label="Mazzo da battere">
      <div class="st-hero-tag">Mazzo da battere</div>
      <div class="st-hero-id"><div class="st-hero-name">${escH(champ.name)}</div><small>${escH(vizOwner(champ))}</small></div>
      <div class="st-hero-big"><span data-count="${vizPct(champ)}">${vizPct(champ)}</span><span class="u">%</span></div>
      <div class="st-hero-meta"><span>${champ.wins} vittorie su ${champ.games} partite</span><span class="st-hero-spark">${statsSpark(champ.history, 'var(--gold)')}</span></div>
      ${statsMatchups(champ, data)}
    </section>` : `<div class="empty">Nessun mazzo ha ancora ${VIZ_MIN_GAMES} partite.<br><small>La classifica parte dalla ${VIZ_MIN_GAMES}ª partita di un mazzo.</small></div>`;

  const podium = rest.length ? `<div class="st-podium">${rest.slice(0, 2).map((d, i) => `
    <div class="st-step" style="--d:${120 + i * 90}ms">
      <div class="st-step-pos">${i + 2}º posto</div>
      <div class="st-step-name" title="${escH(d.name)}">${escH(d.name)}</div>
      <div class="st-step-pct"><span data-count="${vizPct(d)}">${vizPct(d)}</span>%</div>
      <small>${escH(vizOwner(d))}, ${vizPlural(d.games, 'partita', 'partite')}</small>
    </div>`).join('')}</div>` : '';

  c.innerHTML = hero + podium + statsGridHtml(data);
  c.querySelectorAll('.st-cell[data-tip]').forEach(el => el.addEventListener('click', () => toast(el.dataset.tip)));
  statsEnter(c);
}

/** Griglia mazzo contro mazzo: percentuale di vittorie del mazzo di riga contro quello di colonna. */
function statsGridHtml(data) {
  // Prima i mazzi in classifica (per win rate), poi gli altri; se sono troppi, i più giocati
  let list = [...data.ranked, ...data.decks.filter(d => d.games < VIZ_MIN_GAMES).sort((a, b) => b.games - a.games)];
  const hidden = Math.max(0, list.length - STATS_GRID_MAX);
  if (hidden) { const keep = new Set([...list].sort((a, b) => b.games - a.games).slice(0, STATS_GRID_MAX)); list = list.filter(d => keep.has(d)); }
  if (list.length < 2) return '';

  const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
  const EVEN = [44, 46, 54], WIN = [63, 174, 134], LOSE = [224, 104, 95];
  const fill = p => `rgb(${mix(EVEN, p >= 50 ? WIN : LOSE, 0.25 + 0.75 * Math.min(1, Math.abs(p - 50) / 40)).join(',')})`;

  const head = `<span></span>${list.map((d, j) => `<span class="st-col" title="${escH(d.name)}">${j + 1}</span>`).join('')}`;
  const rows = list.map((d, i) => `<span class="st-row-name" title="${escH(d.name)} · ${escH(vizOwner(d))}"><b>${i + 1}</b>${escH(d.name)}</span>` + list.map((e, j) => {
    const delay = `--d:${(i + j) * 28}ms`;
    if (i === j) return `<span class="st-cell self" aria-hidden="true" style="${delay}">·</span>`;
    if (d.pi === e.pi) return `<span class="st-cell none" style="${delay}" data-tip="${escH(`${d.name} e ${e.name} sono dello stesso giocatore: non si affrontano`)}">–</span>`;
    const r = data.h2h.get(d.key + STATS_SEP + e.key);
    if (!r) return `<span class="st-cell few" style="${delay}" data-tip="${escH(`${d.name} contro ${e.name}: nessuna partita`)}"></span>`;
    if (r[1] < VIZ_MIN_GAMES) return `<span class="st-cell few" style="${delay}" data-tip="${escH(`${d.name} contro ${e.name}: ${r[0]} su ${r[1]}, ancora poche partite`)}">${r[1]}p</span>`;
    const p = Math.round(r[0] / r[1] * 100);
    return `<span class="st-cell" style="background:${fill(p)};${delay}" data-tip="${escH(`${d.name} contro ${e.name}: ${p}% (${r[0]} vittorie su ${r[1]})`)}">${p}</span>`;
  }).join('')).join('');

  return `<section class="st-block">
    <h3>Chi batte chi</h3>
    <p class="st-sub">Percentuale di vittorie del mazzo di riga contro quello di colonna. Tocca una casella per i dettagli.</p>
    <div class="st-grid-scroll"><div class="st-grid" style="--n:${list.length}">${head}${rows}</div></div>
    <div class="st-scale"><span>perde</span><i></i><span>vince</span></div>
    <div class="st-keys"><span class="kfew">meno di ${VIZ_MIN_GAMES} partite</span><span class="knone">stesso giocatore</span></div>
    ${hidden ? `<p class="st-sub" style="margin:8px 0 0">Mostrati gli ${STATS_GRID_MAX} mazzi più giocati su ${list.length + hidden}.</p>` : ''}
  </section>`;
}

// ── Mazzi: una scheda per mazzo, divise per giocatore ────────────────────────
function renderDeckCards() {
  const c = document.getElementById('tab-decks');
  if (!c) return;
  const data = statsData();
  const byKey = new Map(data.decks.map(d => [d.key, d]));
  const champ = data.ranked[0];
  let n = 0;

  const html = state.players.map((p, pi) => {
    if (!p.decks.length) return '';
    const cards = p.decks.map(name => byKey.get(`${pi}::${name}`) || { key: `${pi}::${name}`, pi, name, games: 0, wins: 0, history: [] })
      .sort((a, b) => (b.games >= VIZ_MIN_GAMES) - (a.games >= VIZ_MIN_GAMES) || (a.games && b.games ? data.byRate(a, b) : b.games - a.games))
      .map(d => {
        const delay = `--d:${n++ * 60}ms`;
        if (!d.games) return `<article class="st-deck empty-deck" style="${delay}"><div class="st-deck-name">${escH(d.name)}</div><small>Nessuna partita registrata</small></article>`;
        const top = d === champ, few = d.games < VIZ_MIN_GAMES;
        return `<article class="st-deck${top ? ' top' : ''}${few ? ' few' : ''}" style="${delay}">
          <div class="st-deck-head">${statsRing(vizPct(d), top ? 'var(--gold)' : 'var(--viz-s1)')}
            <div class="st-deck-id">${top ? '<div class="st-deck-tag">Mazzo da battere</div>' : ''}
              <div class="st-deck-name">${escH(d.name)}</div>
              <small>${d.wins} vittorie, ${d.games - d.wins} sconfitte${few ? ' · pochi dati' : ''}</small></div></div>
          ${statsSpark(d.history, top ? 'var(--gold)' : 'var(--viz-s1)')}
          ${statsMatchups(d, data)}
        </article>`;
      }).join('');
    return `<section class="st-player"><h3 class="stat-player-name ${pClass[pi]}">${escH(p.name)}</h3><div class="st-decks">${cards}</div></section>`;
  }).join('');

  c.innerHTML = html || '<div class="empty">Nessun mazzo.<br><small>Aggiungi i mazzi dalla pagina Mazzi.</small></div>';
  statsEnter(c);
}
