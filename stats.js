// ─────────────────────────────────────────────
// STATISTICHE — Panoramica (mazzo da battere, podio, chi batte chi) e Mazzi (schede per giocatore)
//
// La classifica va a PUNTEGGIO (0-100), come nella prima versione del tracker: parte dal win rate
// e lo abbassa quando le partite sono poche, così 1 vittoria su 1 non batte 30 su 44.
// Uno scontro diretto mostra la percentuale solo da VIZ_MIN_GAMES partite tra quei due mazzi.
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
  decks.forEach(d => { d.score = statsScore(d.wins, d.games); });
  const byScore = (x, y) => y.score - x.score || y.games - x.games;
  const ranked = [...decks].sort(byScore);
  return { ms, decks, h2h, ranked, byScore };
}

/**
 * Punteggio del mazzo, da 0 a 100: limite inferiore di Wilson (confidenza 95%) sul win rate.
 * Con poche partite resta basso anche col 100% di vittorie; con molte si avvicina al win rate reale.
 */
function statsScore(wins, total) {
  if (!total) return 0;
  const z = 1.96, z2 = z * z, p = wins / total;
  return Math.round((p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total) * 100);
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
      <div class="st-hero-big"><span data-count="${champ.score}">${champ.score}</span><span class="u">punti</span></div>
      <div class="st-hero-meta"><span>${vizPct(champ)}% di vittorie, ${champ.wins} su ${champ.games}</span><span class="st-hero-spark">${statsSpark(champ.history, 'var(--gold)')}</span></div>
      ${statsMatchups(champ, data)}
    </section>` : '';

  const podium = rest.length ? `<div class="st-podium">${rest.slice(0, 2).map((d, i) => `
    <div class="st-step" style="--d:${120 + i * 90}ms">
      <div class="st-step-pos">${i + 2}º posto</div>
      <div class="st-step-name" title="${escH(d.name)}">${escH(d.name)}</div>
      <div class="st-step-pct"><span data-count="${d.score}">${d.score}</span><span class="u">punti</span></div>
      <small>${escH(vizOwner(d))} · ${vizPct(d)}% su ${vizPlural(d.games, 'partita', 'partite')}</small>
    </div>`).join('')}</div>` : '';

  c.innerHTML = hero + podium + statsGridHtml(data);
  // Celle della griglia: si toccano per leggere il dettaglio; da tastiera con Invio, e il lettore di schermo legge il dettaglio
  c.querySelectorAll('.st-cell[data-tip]').forEach(el => {
    el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', el.dataset.tip);
    el.addEventListener('click', () => toast(el.dataset.tip));
  });
  statsEnter(c);
}

/** Griglia mazzo contro mazzo: percentuale di vittorie del mazzo di riga contro quello di colonna. */
function statsGridHtml(data) {
  // In ordine di classifica (punteggio); se sono troppi, i più giocati
  let list = [...data.ranked];
  const hidden = Math.max(0, list.length - STATS_GRID_MAX);
  if (hidden) { const keep = new Set([...list].sort((a, b) => b.games - a.games).slice(0, STATS_GRID_MAX)); list = list.filter(d => keep.has(d)); }
  if (list.length < 2) return '';

  const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
  const EVEN = [44, 46, 54], WIN = [63, 174, 134], LOSE = [224, 104, 95];
  const fillRgb = p => mix(EVEN, p >= 50 ? WIN : LOSE, 0.25 + 0.75 * Math.min(1, Math.abs(p - 50) / 40));
  const fill = p => `rgb(${fillRgb(p).join(',')})`;
  // Testo bianco dove arriva a 4,5:1, altrimenti scuro: sulle celle più intense il bianco scendeva fino a 2,8:1
  const lum = c => c.map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((s, v, k) => s + v * [0.2126, 0.7152, 0.0722][k], 0);
  const ink = p => { const l = lum(fillRgb(p)); return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#fff' : '#000'; };   // il più leggibile dei due: col nero il caso peggiore resta sopra 4,5:1

  const head = `<span></span>${list.map((d, j) => `<span class="st-col" title="${escH(d.name)}">${j + 1}</span>`).join('')}`;
  const rows = list.map((d, i) => `<span class="st-row-name" title="${escH(d.name)} · ${escH(vizOwner(d))}"><b>${i + 1}</b>${escH(d.name)}</span>` + list.map((e, j) => {
    const delay = `--d:${(i + j) * 28}ms`;
    if (i === j) return `<span class="st-cell self" aria-hidden="true" style="${delay}">·</span>`;
    if (d.pi === e.pi) return `<span class="st-cell none" style="${delay}" data-tip="${escH(`${d.name} e ${e.name} sono dello stesso giocatore: non si affrontano`)}">–</span>`;
    const r = data.h2h.get(d.key + STATS_SEP + e.key);
    if (!r) return `<span class="st-cell few" style="${delay}" data-tip="${escH(`${d.name} contro ${e.name}: nessuna partita`)}"></span>`;
    if (r[1] < VIZ_MIN_GAMES) return `<span class="st-cell few" style="${delay}" data-tip="${escH(`${d.name} contro ${e.name}: ${r[0]} su ${r[1]}, ancora poche partite`)}">${r[1]}p</span>`;
    const p = Math.round(r[0] / r[1] * 100);
    return `<span class="st-cell" style="background:${fill(p)};color:${ink(p)};${delay}" data-tip="${escH(`${d.name} contro ${e.name}: ${p}% (${r[0]} vittorie su ${r[1]})`)}">${p}</span>`;
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
      .sort((a, b) => a.games && b.games ? data.byScore(a, b) : b.games - a.games)
      .map(d => {
        const delay = `--d:${n++ * 60}ms`;
        if (!d.games) return `<article class="st-deck empty-deck" style="${delay}"><div class="st-deck-name">${escH(d.name)}</div><small>Nessuna partita registrata</small></article>`;
        const top = d === champ, few = d.games < VIZ_MIN_GAMES;
        return `<article class="st-deck${top ? ' top' : ''}${few ? ' few' : ''}" style="${delay}">
          <div class="st-deck-head">${statsRing(vizPct(d), top ? 'var(--gold)' : 'var(--viz-s1)')}
            <div class="st-deck-id">${top ? '<div class="st-deck-tag">Mazzo da battere</div>' : ''}
              <div class="st-deck-name">${escH(d.name)}</div>
              <small><b class="st-score">${d.score} punti</b> · ${d.wins} V, ${d.games - d.wins} S${few ? ' · pochi dati' : ''}</small></div></div>
          ${statsSpark(d.history, top ? 'var(--gold)' : 'var(--viz-s1)')}
          ${statsMatchups(d, data)}
        </article>`;
      }).join('');
    return `<section class="st-player"><h3 class="stat-player-name ${pClass[pi]}">${escH(p.name)}</h3><div class="st-decks">${cards}</div></section>`;
  }).join('');

  c.innerHTML = html || '<div class="empty">Nessun mazzo.<br><small>Aggiungi i mazzi dalla pagina Mazzi.</small></div>';
  statsEnter(c);
}

// ── Schermata Duello: i 3 mazzi più forti e il duello da giocare ─────────────
// Il duello consigliato mette di fronte due mazzi di giocatori diversi con livello simile
// e pochi scontri diretti: è la partita il cui risultato dice di più alle statistiche.
let homeSuggestIdx = 0;
const HOME_EYE = '<svg class="home-eye" viewBox="0 0 32 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5c6-2.6 17-2.8 24-.6"/><path d="M3 10c6-6.5 18-6.5 26 0-8 5.8-20 5.8-26 0z"/><circle cx="16" cy="10" r="2.8" fill="currentColor"/><path d="M15 15v5.5"/><path d="M19.5 14.6c1.6 3.6 6 5.2 8.5 2.4"/></svg>';

/** Livello stimato di un mazzo (0–1): win rate "prudente", un mazzo mai giocato parte dal 50%. */
const homeLevel = d => (d.wins + 1) / (d.games + 2);

function homeSuggestions(data) {
  const byKey = new Map(data.decks.map(d => [d.key, d]));
  const all = [];
  state.players.forEach((p, pi) => p.decks.forEach(name => {
    const key = `${pi}::${name}`;
    all.push(byKey.get(key) || { key, pi, name, games: 0, wins: 0, history: [] });
  }));
  const out = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.pi === b.pi) continue;
    const r = data.h2h.get(a.key + STATS_SEP + b.key) || [0, 0];
    const close = 1 - Math.abs(homeLevel(a) - homeLevel(b));        // 1 = stesso livello
    const fresh = 1 / (1 + r[1]);                                    // meno si sono affrontati, più conta
    const young = 1 / Math.sqrt(1 + Math.min(a.games, b.games) / 4); // i mazzi con pochi dati imparano di più
    out.push({ a, b, h2h: r, score: close ** 3 * (0.35 + 0.65 * fresh) * (0.6 + 0.4 * young) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 8);
}

function homeReasons(s) {
  const { a, b, h2h } = s, why = [];
  if (a.games && b.games) {
    const pa = vizPct(a), pb = vizPct(b);
    why.push(Math.abs(pa - pb) <= 8 ? `Livello simile: ${pa}% e ${pb}% di vittorie` : `${pa}% contro ${pb}% di vittorie`);
  } else {
    why.push(a.games || b.games ? `${escH((a.games ? b : a).name)} non ha ancora partite: è il momento di provarlo` : 'Due mazzi tutti da scoprire');
  }
  if (!h2h[1]) why.push('Non si sono mai affrontati');
  else if (h2h[1] < VIZ_MIN_GAMES) why.push(`${vizPlural(h2h[1], 'scontro', 'scontri')} finora: ${VIZ_MIN_GAMES - h2h[1] === 1 ? 'ne manca 1' : `ne mancano ${VIZ_MIN_GAMES - h2h[1]}`} per la percentuale in Chi batte chi`);
  else why.push(`Tra loro ${h2h[0]}–${h2h[1] - h2h[0]}: un'altra partita conferma o ribalta il dato`);
  return why;
}

function homeFace(d, side) {
  const p = state.players[d.pi];
  return `<div class="home-face ${pClass[d.pi]} ${side}">
    <small class="home-face-owner">${escH(p?.name || '?')}</small>
    <b class="home-face-name">${escH(d.name)}</b>
    <span class="home-face-stat">${d.games ? `${vizPct(d)}% · ${vizPlural(d.games, 'partita', 'partite')}` : 'nessuna partita'}</span>
  </div>`;
}

function renderHome() {
  const c = document.getElementById('home-extra');
  if (!c) return;
  if (duelState) { c.hidden = true; return; }      // durante il duello conta solo il tastierino
  c.hidden = false;
  const data = statsData();

  const top = data.ranked.filter(d => d.games).slice(0, 3);
  const topHtml = top.length ? `<section class="panel home-top" aria-labelledby="home-top-title">
    <div class="panel-title"><span id="home-top-title">I mazzi più forti</span><button class="home-more" onclick="switchPage('stats')">Classifica <span aria-hidden="true">→</span></button></div>
    <ol class="home-ranks">${top.map((d, i) => `
      <li class="home-rank r${i + 1}" style="--d:${80 + i * 70}ms">
        <span class="home-pyr" aria-label="${i + 1}º posto"><svg viewBox="0 0 28 24" aria-hidden="true"><path d="M14 2 26.5 22h-25z"/></svg><b>${i + 1}</b></span>
        <span class="home-rank-id"><b>${escH(d.name)}</b><small>${escH(vizOwner(d))} · ${d.wins} V, ${d.games - d.wins} S</small></span>
        <span class="home-rank-score"><b>${d.score}</b><small>punti</small></span>
      </li>`).join('')}</ol>
  </section>` : '';

  const sug = homeSuggestions(data);
  let sugHtml = '';
  if (sug.length) {
    const s = sug[homeSuggestIdx % sug.length];
    const ia = state.players[s.a.pi].decks.indexOf(s.a.name), ib = state.players[s.b.pi].decks.indexOf(s.b.name);
    sugHtml = `<section class="panel home-sug" aria-labelledby="home-sug-title">
      <div class="panel-title">${HOME_EYE}<span id="home-sug-title">Il duello da giocare</span></div>
      <div class="home-vs">${homeFace(s.a, 'l')}<span class="home-vs-gem" aria-hidden="true"><i>VS</i></span>${homeFace(s.b, 'r')}</div>
      <ul class="home-why">${homeReasons(s).map(w => `<li>${w}</li>`).join('')}</ul>
      <div class="home-sug-btns">
        <button class="btn-cfg" onclick="homePlan(${s.a.pi},${ia},${s.b.pi},${ib})">Prepara questo duello</button>
        ${sug.length > 1 ? `<button class="btn-cfg-sec" onclick="homeNext()">Un'altra proposta</button>` : ''}
      </div>
    </section>`;
  }
  c.innerHTML = topHtml + sugHtml;
}

function homeNext() {
  homeSuggestIdx++;
  renderHome();
  replayAnim(document.querySelector('#home-extra .home-sug'), 'home-swap');
}

/** Compila la scelta giocatori e mazzi del nuovo duello con la proposta. */
function homePlan(pa, da, pb, db) {
  if (duelState) return;
  [[pa, da], [pb, db]].forEach(([pi, di], slot) => {
    const ps = document.getElementById(`duel-p${slot}`);
    if (!ps) return;
    ps.value = String(pi);
    onDuelPlayerChange(slot);
    document.getElementById(`duel-d${slot}`).value = String(di);
  });
  const panel = document.getElementById('duel-panel');
  panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  replayAnim(panel, 'home-filled');
  announce(`Duello pronto: ${state.players[pa].decks[da]} contro ${state.players[pb].decks[db]}. Tocca Inizia il duello.`);
}

renderHome();
