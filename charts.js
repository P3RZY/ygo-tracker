// ─────────────────────────────────────────────
// GRAFICI (Statistiche → Grafici)
//
// SVG e HTML scritti a mano, nessuna libreria. Regole (skill dataviz):
//  - una sola scala per grafico, segni sottili, griglia e assi a filo e recessivi;
//  - legenda per 2+ serie, etichette dirette solo dove servono, testo mai nel colore della serie;
//  - etichetta al passaggio del dito/mouse e da tastiera, e una tabella con gli stessi dati;
//  - il colore segue il giocatore, non la posizione in classifica.
// I colori sono nelle variabili --viz-* di style.css (validati con validate_palette.js).
// ─────────────────────────────────────────────
const VIZ_PERIODS = [{ days: 30, label: '30 giorni' }, { days: 90, label: '90 giorni' }, { days: 0, label: 'Tutto' }];
let vizPeriod = 0;
let vizResizeTimer = null;

const vizNum  = new Intl.NumberFormat('it-IT');
const vizDay  = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const vizWhen = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const vizMon  = new Intl.DateTimeFormat('it-IT', { month: 'short', year: '2-digit' });
const vizPlural = (n, one, many) => `${vizNum.format(n)} ${n === 1 ? one : many}`;
const vizPlayerColor = pi => `var(--viz-p${pi % 3})`;

function setVizPeriod(days) {
  vizPeriod = days;
  renderCharts();
}

window.addEventListener('resize', () => {
  clearTimeout(vizResizeTimer);
  vizResizeTimer = setTimeout(() => { if (currentPage === 'stats' && currentTab === 'charts') renderCharts(); }, 150);
});

/** Partite del periodo scelto (in ordine di data) e quelle del periodo precedente, per il confronto. */
function vizSlice() {
  const sorted = [...state.matches].filter(m => state.players[m.p1i] && state.players[m.p2i]).sort((a, b) => a.ts - b.ts);
  if (!vizPeriod) return { ms: sorted, prev: null };
  const now = Date.now(), span = vizPeriod * 864e5;
  return {
    ms: sorted.filter(m => m.ts >= now - span),
    prev: sorted.filter(m => m.ts >= now - 2 * span && m.ts < now - span)
  };
}

function renderCharts() {
  const c = document.getElementById('tab-charts');
  if (!c) return;
  const { ms, prev } = vizSlice();
  const filters = `<div class="viz-filters" role="group" aria-label="Periodo dei grafici">${VIZ_PERIODS.map(p =>
    `<button class="viz-chip${vizPeriod === p.days ? ' on' : ''}" aria-pressed="${vizPeriod === p.days}" onclick="setVizPeriod(${p.days})">${p.label}</button>`).join('')}</div>`;

  if (!ms.length) {
    c.innerHTML = filters + `<div class="empty">${vizPeriod ? `Nessuna partita negli ultimi ${vizPeriod} giorni.` : 'Nessuna partita registrata.'}<br>
      <small>${vizPeriod ? 'Prova con un periodo più lungo.' : 'Registra un risultato da Partite o gioca un duello: i grafici compariranno qui.'}</small></div>`;
    return;
  }

  c.innerHTML = filters + vizKpis(ms, prev) + `
    <section class="viz-card" id="viz-activity" aria-labelledby="viz-activity-h">
      <h3 id="viz-activity-h">Partite nel tempo</h3>
      <p class="viz-sub" id="viz-activity-sub"></p>
      <div class="viz-plot"></div>
      <details class="viz-table"><summary>Vedi i dati</summary><div class="viz-table-body"></div></details>
    </section>
    <section class="viz-card" id="viz-wins" aria-labelledby="viz-wins-h">
      <h3 id="viz-wins-h">Vittorie accumulate</h3>
      <p class="viz-sub">Quante partite ha vinto ogni giocatore, partita dopo partita</p>
      <div class="viz-legend"></div>
      <div class="viz-plot"></div>
      <details class="viz-table"><summary>Vedi i dati</summary><div class="viz-table-body"></div></details>
    </section>
    <section class="viz-card" id="viz-decks" aria-labelledby="viz-decks-h">
      <h3 id="viz-decks-h">Win rate dei mazzi</h3>
      <p class="viz-sub">Percentuale di vittorie; la linea indica il 50%</p>
      <div class="viz-legend"></div>
      <div class="viz-plot"></div>
      <details class="viz-table"><summary>Vedi i dati</summary><div class="viz-table-body"></div></details>
    </section>`;

  vizActivity(document.getElementById('viz-activity'), ms);
  vizWins(document.getElementById('viz-wins'), ms);
  vizDecks(document.getElementById('viz-decks'), ms);
}

// ── Numeri chiave ────────────────────────────────────────────────────────────
function vizDeckStats(ms) {
  const map = new Map();
  ms.forEach(m => [[m.p1i, m.d1i], [m.p2i, m.d2i]].forEach(([pi, di]) => {
    const name = state.players[pi]?.decks[di];
    if (name == null) return;
    const k = `${pi}::${di}`;
    if (!map.has(k)) map.set(k, { pi, name, games: 0, wins: 0 });
    const d = map.get(k);
    d.games++;
    if (m.winner === pi) d.wins++;
  }));
  return [...map.values()];
}

function vizKpis(ms, prev) {
  const decks = vizDeckStats(ms);
  const most = [...decks].sort((a, b) => b.games - a.games || b.wins - a.wins)[0];
  const best = decks.filter(d => d.games >= 3).sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games)[0];
  const owner = d => escH(state.players[d.pi]?.name || '?');

  let delta = '';
  if (prev) {
    const diff = ms.length - prev.length;
    delta = diff === 0 ? `come nei ${vizPeriod} giorni prima`
      : `${diff > 0 ? '+' : '−'}${vizNum.format(Math.abs(diff))} rispetto ai ${vizPeriod} giorni prima`;
  }
  const tile = (label, value, sub) => `<div class="viz-stat"><div class="viz-stat-label">${label}</div><div class="viz-stat-value">${value}</div><div class="viz-stat-sub">${sub}</div></div>`;
  return `<div class="viz-stats">
    ${tile('Partite', vizNum.format(ms.length), delta || `dal ${vizDay.format(ms[0].ts)}`)}
    ${tile('Mazzo più giocato', escH(most.name), `${owner(most)} · ${vizPlural(most.games, 'partita', 'partite')}`)}
    ${best ? tile('Miglior win rate', `${Math.round(best.wins / best.games * 100)}%`, `${escH(best.name)} di ${owner(best)} · ${best.wins} su ${best.games}`)
           : tile('Miglior win rate', '—', 'servono almeno 3 partite con lo stesso mazzo')}
  </div>`;
}

// ── Strumenti comuni ─────────────────────────────────────────────────────────
/** Massimo "pulito" e passo dei tick per una scala da 0 (numeri interi). */
function vizNiceScale(max, maxTicks = 4) {
  if (max <= 0) return { max: 1, step: 1 };
  const raw = max / maxTicks, mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(f => f * mag).find(s => s >= raw));
  return { max: Math.ceil(max / step) * step, step };
}

/** Tooltip della scheda: costruito con textContent (i nomi sono dati dell'utente). */
function vizTip(card, x, y, title, rows, place = 'above') {
  let tip = card.querySelector('.viz-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'viz-tip'; tip.setAttribute('role', 'status'); card.appendChild(tip); }
  tip.replaceChildren();
  rows.forEach(r => {
    const row = document.createElement('div'); row.className = 'viz-tip-row';
    if (r.color) { const k = document.createElement('span'); k.className = 'viz-tip-key'; k.style.background = r.color; row.appendChild(k); }
    const v = document.createElement('strong'); v.textContent = r.value; row.appendChild(v);
    const l = document.createElement('span'); l.textContent = r.label; row.appendChild(l);
    tip.appendChild(row);
  });
  const t = document.createElement('div'); t.className = 'viz-tip-title'; t.textContent = title; tip.appendChild(t);
  tip.hidden = false;
  const cw = card.clientWidth, tw = tip.offsetWidth;
  tip.style.left = Math.max(8, Math.min(cw - tw - 8, x - tw / 2)) + 'px';
  // "above": sopra il punto indicato; "below": dentro l'area del grafico, sotto il bordo superiore (non copre titolo e legenda)
  tip.style.top = (place === 'below' ? y : Math.max(4, y - tip.offsetHeight - 10)) + 'px';
}
function vizTipHide(card) { const t = card.querySelector('.viz-tip'); if (t) t.hidden = true; }

function vizTable(card, head, rows) {
  card.querySelector('.viz-table-body').innerHTML = `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function vizLegend(card, pis) {
  card.querySelector('.viz-legend').innerHTML = pis.map(pi =>
    `<span class="viz-legend-item"><span class="viz-legend-key" style="background:${vizPlayerColor(pi)}"></span>${escH(state.players[pi]?.name || '?')}</span>`).join('');
}

/** Colonna con estremo dati arrotondato (4px) e base quadrata. */
function vizColumnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ── Partite nel tempo (colonne) ──────────────────────────────────────────────
function vizBuckets(ms) {
  const weekStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const first = vizPeriod ? Date.now() - vizPeriod * 864e5 : ms[0].ts;
  let weeks = [];
  for (let t = weekStart(first); t <= Date.now(); ) { weeks.push(t); const d = new Date(t); d.setDate(d.getDate() + 7); t = d.getTime(); }
  if (weeks.length <= 26) {
    return { unit: 'settimana', buckets: weeks.map((t, i) => ({ start: t, end: weeks[i + 1] ?? Infinity, label: vizDay.format(t), n: 0 })) };
  }
  // Periodi lunghi: un mese per colonna, così le colonne restano leggibili
  const months = [];
  const d = new Date(first); d.setDate(1); d.setHours(0, 0, 0, 0);
  while (d.getTime() <= Date.now()) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  return { unit: 'mese', buckets: months.map((t, i) => ({ start: t, end: months[i + 1] ?? Infinity, label: vizMon.format(t), n: 0 })) };
}

function vizActivity(card, ms) {
  const { unit, buckets } = vizBuckets(ms);
  ms.forEach(m => { const b = buckets.find(b => m.ts >= b.start && m.ts < b.end); if (b) b.n++; });
  card.querySelector('#viz-activity-sub').textContent = unit === 'mese' ? 'Partite registrate ogni mese' : 'Partite registrate ogni settimana (da lunedì)';

  const plot = card.querySelector('.viz-plot');
  const W = Math.max(260, plot.clientWidth), H = 190, ml = 30, mr = 8, mt = 18, mb = 26;
  const pw = W - ml - mr, ph = H - mt - mb;
  const { max, step } = vizNiceScale(Math.max(...buckets.map(b => b.n)));
  const band = pw / buckets.length, bw = Math.max(3, Math.min(24, band * 0.62));
  const y = v => mt + ph - v / max * ph;

  const ticks = []; for (let v = 0; v <= max; v += step) ticks.push(v);
  const maxN = Math.max(...buckets.map(b => b.n));
  const maxIdx = buckets.findIndex(b => b.n === maxN);
  // Etichette dell'asse x: poche, sempre la prima e l'ultima
  const every = Math.ceil(buckets.length / Math.max(2, Math.floor(pw / 56)));
  const showX = i => i === 0 || i === buckets.length - 1 || (i % every === 0 && buckets.length - 1 - i >= every / 2);

  plot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Partite per ${unit}, massimo ${maxN}">
    ${ticks.map(v => `<line class="viz-grid" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/><text class="viz-axis" x="${ml - 6}" y="${y(v) + 4}" text-anchor="end">${vizNum.format(v)}</text>`).join('')}
    <line class="viz-base" x1="${ml}" x2="${W - mr}" y1="${y(0)}" y2="${y(0)}"/>
    ${buckets.map((b, i) => {
      const cx = ml + band * i + band / 2, h = y(0) - y(b.n);
      return `<g class="viz-col" tabindex="0" data-i="${i}" aria-label="${unit === 'mese' ? b.label : 'Settimana dal ' + b.label}: ${vizPlural(b.n, 'partita', 'partite')}">
        <rect class="viz-hit" x="${ml + band * i}" y="${mt}" width="${band}" height="${ph}"/>
        ${b.n ? `<path class="viz-mark" style="fill:var(--viz-s1)" d="${vizColumnPath(cx - bw / 2, y(b.n), bw, h)}"/>` : ''}
        ${i === maxIdx && b.n ? `<text class="viz-value" x="${cx}" y="${y(b.n) - 5}" text-anchor="middle">${b.n}</text>` : ''}
        ${showX(i) ? `<text class="viz-axis" x="${cx}" y="${H - 8}" text-anchor="middle">${b.label}</text>` : ''}
      </g>`;
    }).join('')}
  </svg>`;

  plot.querySelectorAll('.viz-col').forEach(g => {
    const show = () => {
      const b = buckets[+g.dataset.i], r = g.getBoundingClientRect(), cr = card.getBoundingClientRect();
      plot.querySelectorAll('.viz-col.on').forEach(x => x.classList.remove('on')); g.classList.add('on');
      vizTip(card, r.left - cr.left + r.width / 2, plot.offsetTop + y(b.n), unit === 'mese' ? b.label : `settimana dal ${b.label}`, [{ value: vizNum.format(b.n), label: b.n === 1 ? 'partita' : 'partite' }]);
    };
    const hide = () => { g.classList.remove('on'); vizTipHide(card); };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', hide); g.addEventListener('blur', hide);
  });

  vizTable(card, [unit === 'mese' ? 'Mese' : 'Settimana dal', 'Partite'], buckets.map(b => [b.label, vizNum.format(b.n)]));
}

// ── Vittorie accumulate (linee, una per giocatore) ───────────────────────────
function vizWins(card, ms) {
  const pis = [...new Set(ms.flatMap(m => [m.p1i, m.p2i]))].sort((a, b) => a - b);
  vizLegend(card, pis);
  // Un punto per partita: vittorie di ognuno fino a quella partita compresa
  const wins = Object.fromEntries(pis.map(pi => [pi, 0]));
  const points = ms.map(m => { wins[m.winner] = (wins[m.winner] || 0) + 1; return { ts: m.ts, m, v: { ...wins } }; });

  const plot = card.querySelector('.viz-plot');
  const W = Math.max(260, plot.clientWidth), H = 210, ml = 30, mr = 84, mt = 12, mb = 26;
  const pw = W - ml - mr, ph = H - mt - mb;
  const t0 = points[0].ts, t1 = points[points.length - 1].ts;
  const x = ts => ml + (t1 === t0 ? pw : (ts - t0) / (t1 - t0) * pw);
  const { max, step } = vizNiceScale(Math.max(1, ...pis.map(pi => wins[pi])));
  const y = v => mt + ph - v / max * ph;
  const ticks = []; for (let v = 0; v <= max; v += step) ticks.push(v);

  const line = pi => {
    const pts = [[x(t0), y(0)], ...points.map(p => [x(p.ts), y(p.v[pi] || 0)])];
    return `M${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join('L')}`;
  };
  // Etichette finali: solo dove non si sovrappongono (altrimenti bastano legenda e tooltip)
  const ends = pis.map(pi => ({ pi, yv: y(wins[pi]) })).sort((a, b) => a.yv - b.yv);
  let lastY = -Infinity;
  ends.forEach(e => { e.show = e.yv - lastY >= 14; if (e.show) lastY = e.yv; });
  const short = s => s.length > 10 ? s.slice(0, 9) + '…' : s;

  plot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vittorie accumulate per giocatore">
    ${ticks.map(v => `<line class="viz-grid" x1="${ml}" x2="${ml + pw}" y1="${y(v)}" y2="${y(v)}"/><text class="viz-axis" x="${ml - 6}" y="${y(v) + 4}" text-anchor="end">${vizNum.format(v)}</text>`).join('')}
    <line class="viz-base" x1="${ml}" x2="${ml + pw}" y1="${y(0)}" y2="${y(0)}"/>
    <text class="viz-axis" x="${ml}" y="${H - 8}">${vizDay.format(t0)}</text>
    <text class="viz-axis" x="${ml + pw}" y="${H - 8}" text-anchor="end">${vizDay.format(t1)}</text>
    ${pis.map(pi => `<path class="viz-line" style="stroke:${vizPlayerColor(pi)}" d="${line(pi)}"/>`).join('')}
    ${pis.map(pi => `<circle class="viz-dot" style="fill:${vizPlayerColor(pi)}" cx="${x(t1)}" cy="${y(wins[pi])}" r="4"/>`).join('')}
    ${ends.filter(e => e.show).map(e => `<text class="viz-end" x="${x(t1) + 9}" y="${e.yv + 4}">${escH(short(state.players[e.pi]?.name || '?'))} <tspan class="viz-end-v">${wins[e.pi]}</tspan></text>`).join('')}
    <line class="viz-cross" x1="0" x2="0" y1="${mt}" y2="${y(0)}" visibility="hidden"/>
    <rect class="viz-hit viz-overlay" x="${ml}" y="${mt}" width="${pw}" height="${ph}" tabindex="0" aria-label="Scorri le partite con le frecce sinistra e destra"/>
  </svg>`;

  // Mirino: segue il dito/mouse e si aggancia alla partita più vicina; da tastiera con le frecce
  const svg = plot.querySelector('svg'), cross = svg.querySelector('.viz-cross'), overlay = svg.querySelector('.viz-overlay');
  let idx = points.length - 1;
  const showAt = i => {
    idx = Math.max(0, Math.min(points.length - 1, i));
    const p = points[idx], px = x(p.ts);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    const w = state.players[p.m.winner]?.name || '?';
    const tipX = px > ml + pw / 2 ? px - 90 : px + 90;   // di lato al mirino, non sopra
    vizTip(card, plot.offsetLeft + tipX, plot.offsetTop + mt, `dopo la partita del ${vizWhen.format(p.ts)} (vince ${w})`,
      [...pis].sort((a, b) => (p.v[b] || 0) - (p.v[a] || 0)).map(pi => ({ color: vizPlayerColor(pi), value: String(p.v[pi] || 0), label: state.players[pi]?.name || '?' })), 'below');
  };
  const nearest = clientX => {
    const r = svg.getBoundingClientRect(), px = clientX - r.left;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const d = Math.abs(x(p.ts) - px); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); vizTipHide(card); };
  overlay.addEventListener('pointermove', e => showAt(nearest(e.clientX)));
  overlay.addEventListener('pointerdown', e => showAt(nearest(e.clientX)));
  overlay.addEventListener('pointerleave', hide);
  overlay.addEventListener('focus', () => showAt(idx));
  overlay.addEventListener('blur', hide);
  overlay.addEventListener('keydown', e => {
    const k = { ArrowLeft: idx - 1, ArrowRight: idx + 1, Home: 0, End: points.length - 1 }[e.key];
    if (k === undefined) return;
    e.preventDefault(); showAt(k);
  });

  vizTable(card, ['Partita', 'Vince', ...pis.map(pi => escH(state.players[pi]?.name || '?'))],
    [...points].reverse().map(p => [vizWhen.format(p.ts), escH(state.players[p.m.winner]?.name || '?'), ...pis.map(pi => p.v[pi] || 0)]));
}

// ── Win rate dei mazzi (barre orizzontali, colore = proprietario) ────────────
function vizDecks(card, ms) {
  const decks = vizDeckStats(ms).sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games);
  vizLegend(card, [...new Set(decks.map(d => d.pi))].sort((a, b) => a - b));
  const shown = decks.slice(0, 10);
  const pct = d => Math.round(d.wins / d.games * 100);

  const plot = card.querySelector('.viz-plot');
  plot.innerHTML = `<div class="viz-bars">${shown.map((d, i) => `
    <div class="viz-bar-row" tabindex="0" data-i="${i}" aria-label="${escH(d.name)} di ${escH(state.players[d.pi]?.name || '?')}: ${pct(d)}% di vittorie, ${d.wins} su ${d.games}">
      <div class="viz-bar-name"><span title="${escH(d.name)}">${escH(d.name)}</span><small>${escH(state.players[d.pi]?.name || '?')}</small></div>
      <div class="viz-bar-track">
        <div class="viz-bar-ref" aria-hidden="true"></div>
        <div class="viz-bar" style="width:${Math.max(pct(d), 1)}%;background:${vizPlayerColor(d.pi)}"></div>
        <span class="viz-bar-value" style="left:${Math.max(pct(d), 1)}%">${pct(d)}%<small> · ${d.games}${d.games < 3 ? ' (pochi dati)' : ''}</small></span>
      </div>
    </div>`).join('')}</div>
    <div class="viz-bars-axis" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
    ${decks.length > shown.length ? `<p class="viz-more">e altri ${decks.length - shown.length} mazzi nella tabella</p>` : ''}`;

  plot.querySelectorAll('.viz-bar-row').forEach(row => {
    const show = () => {
      const d = shown[+row.dataset.i], r = row.querySelector('.viz-bar').getBoundingClientRect(), cr = card.getBoundingClientRect();
      vizTip(card, r.right - cr.left, r.top - cr.top, `${d.name} · ${state.players[d.pi]?.name || '?'}`,
        [{ color: vizPlayerColor(d.pi), value: `${pct(d)}%`, label: `vittorie (${d.wins} su ${d.games})` }]);
    };
    const hide = () => vizTipHide(card);
    row.addEventListener('pointerenter', show); row.addEventListener('focus', show);
    row.addEventListener('pointerleave', hide); row.addEventListener('blur', hide);
  });

  vizTable(card, ['Mazzo', 'Giocatore', 'Vittorie', 'Partite', 'Win rate'],
    decks.map(d => [escH(d.name), escH(state.players[d.pi]?.name || '?'), d.wins, d.games, pct(d) + '%']));
}
