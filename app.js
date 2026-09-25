// ─────────────────────────────────────────────
// CONFIG & STATE
// ─────────────────────────────────────────────
const LOCAL_KEY   = 'ygo_jsonbin_v1';
const JSONBIN_BASE = 'https://api.jsonbin.io/v3';

let cfg = { apiKey: '', binId: '' };

let state = {
  players: [
    { name: 'Giocatore 1', decks: ['Dark Magician', 'Blue-Eyes'] },
    { name: 'Giocatore 2', decks: ['Exodia', 'Blackwing'] },
    { name: 'Giocatore 3', decks: ['Cyber Dragon'] }
  ],
  matches: [],
  deckLists: {}   // { "<playerIdx>::<nomeMazzo>": { main:[id], extra:[id], side:[id] } }
};

/** Garantisce i campi introdotti dopo (bin/localStorage vecchi non li hanno). */
function normalizeState() {
  if (!state.deckLists || typeof state.deckLists !== 'object') state.deckLists = {};
  if (!Array.isArray(state.matches)) state.matches = [];
}

// ─────────────────────────────────────────────
// LOCAL STORAGE
// ─────────────────────────────────────────────
function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ cfg, state }));
    console.log('[YGO] Salvato in localStorage');
  } catch(e) {
    console.error('[YGO] Errore salvataggio localStorage:', e);
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) { console.log('[YGO] Nessun dato locale trovato'); return; }
    const parsed = JSON.parse(raw);
    if (parsed.cfg)   cfg   = parsed.cfg;
    if (parsed.state) state = parsed.state;
    normalizeState();
    console.log('[YGO] Dati locali caricati:', { binId: cfg.binId, players: state.players.length, matches: state.matches.length });
  } catch(e) {
    console.error('[YGO] Errore lettura localStorage:', e);
  }
}

// ─────────────────────────────────────────────
// SYNC STATUS UI
// ─────────────────────────────────────────────
function setSync(status, label) {
  document.getElementById('sync-dot').className  = 'sync-dot' + (status ? ' ' + status : '');
  document.getElementById('sync-label').textContent = label;
}

// ─────────────────────────────────────────────
// JSONBIN API
// ─────────────────────────────────────────────

/**
 * Wrapper fetch verso JSONBin.
 * Lancia un errore se la risposta HTTP non è ok.
 */
async function apiFetch(method, path, body) {
  const url = JSONBIN_BASE + path;
  const headers = {
    'X-Master-Key':    cfg.apiKey,
    'Content-Type':    'application/json',
    'X-Bin-Versioning': 'false'
  };

  console.log(`[YGO] ${method} ${url}`, body !== undefined ? body : '');

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let json;
  try {
    json = await res.json();
  } catch(e) {
    console.error(`[YGO] Risposta non-JSON da ${method} ${path}:`, e);
    throw new Error('Risposta non valida dal server');
  }

  if (!res.ok) {
    console.error(`[YGO] HTTP ${res.status} su ${method} ${path}:`, json);
    throw new Error(`HTTP ${res.status}: ${json?.message || 'errore sconosciuto'}`);
  }

  console.log(`[YGO] Risposta ${method} ${path}:`, json);
  return json;
}

/**
 * Crea un nuovo bin su JSONBin.
 * Il POST richiede { record: stato } come body.
 * Restituisce l'id del bin creato.
 */
async function createBin() {
  console.log('[YGO] Creazione nuovo bin...');
  const data = await apiFetch('POST', '/b', { record: state, name: 'YGO Tracker' });
  const id = data?.metadata?.id;
  if (!id) {
    console.error('[YGO] createBin: metadata.id mancante nella risposta:', data);
    throw new Error('ID bin non ricevuto');
  }
  console.log('[YGO] Bin creato con id:', id);
  return id;
}

/**
 * Legge il bin e restituisce il record normalizzato { players, matches }.
 * JSONBin GET /latest → { record: <quello che hai scritto>, metadata: {...} }
 *
 * Il bin attuale è corrotto con doppio wrapping { record: { record: { players, matches } } }
 * causato da writeBin che wrappava erroneamente in { record: state }.
 * Questa funzione gestisce entrambi i casi: normale e doppio-wrappato.
 */
async function readBin() {
  console.log('[YGO] Lettura bin:', cfg.binId);
  const data = await apiFetch('GET', `/b/${cfg.binId}/latest`);

  // JSONBin restituisce sempre { record: <payload>, metadata: {...} }
  let record = data?.record;

  if (!record) {
    console.error('[YGO] readBin: campo "record" assente nella risposta:', data);
    throw new Error('Campo "record" mancante nella risposta');
  }

  // Gestione doppio wrapping: se record non ha "players" ma ha un sotto-"record", scendi di un livello
  if (!record.players && record.record) {
    console.warn('[YGO] readBin: rilevato doppio wrapping — unwrap automatico', record);
    record = record.record;
  }

  if (!record?.players) {
    console.error('[YGO] readBin: struttura non valida dopo unwrap:', record);
    throw new Error('Struttura dati non valida nel bin');
  }

  console.log('[YGO] Record letto:', { players: record.players?.length, matches: record.matches?.length });
  return record; // { players, matches }
}

/**
 * Scrive lo state corrente nel bin.
 * Il PUT su JSONBin vuole il payload grezzo — JSONBin lo wrappa in { record: ... } internamente.
 * NON wrappare manualmente, altrimenti si ottiene { record: { record: state } }.
 */
async function writeBin() {
  console.log('[YGO] Scrittura bin:', cfg.binId, '— matches:', state.matches.length);
  await apiFetch('PUT', `/b/${cfg.binId}`, state); // state grezzo, senza { record: state }
  console.log('[YGO] Bin aggiornato con successo — struttura ora corretta');
}

// ─────────────────────────────────────────────
// CONNECT / DISCONNECT
// ─────────────────────────────────────────────
async function connect() {
  const key        = document.getElementById('apikey-input').value.trim();
  const binIdInput = document.getElementById('binid-input').value.trim();
  const errEl      = document.getElementById('cfg-error');
  errEl.style.display = 'none';

  if (!key) { showCfgError('Inserisci la API key.'); return; }

  cfg.apiKey = key;
  // Se l'utente ha incollato un Bin ID manualmente, usalo (sovrascrive quello in localStorage)
  if (binIdInput) {
    cfg.binId = binIdInput;
    console.log('[YGO] Bin ID fornito manualmente:', cfg.binId);
  }

  setSync('loading', 'connessione...');
  console.log('[YGO] Tentativo di connessione...');

  try {
    // Se non abbiamo ancora un bin, lo creiamo
    if (!cfg.binId) {
      console.log('[YGO] Nessun binId salvato → creo un nuovo bin');
      cfg.binId = await createBin();
    } else {
      console.log('[YGO] BinId:', cfg.binId, '→ leggo dati remoti');
    }

    // Leggo sempre i dati remoti dopo la connessione
    const remote = await readBin();
    if (remote?.players) {
      console.log('[YGO] Dati remoti validi, aggiorno state locale');
      state = remote; normalizeState();
    } else {
      console.warn('[YGO] Dati remoti privi di "players", mantengo state locale:', remote);
    }

    saveLocal();
    onConnected();
    setSync('ok', 'sincronizzato');
    console.log('[YGO] Connessione riuscita');

  } catch(e) {
    console.error('[YGO] Errore durante connect():', e);
    cfg.apiKey = '';
    setSync('err', 'errore');
    showCfgError('API key non valida o errore di rete. Riprova. (Dettagli in console)');
  }
}

function disconnect() {
  if (!confirm("Scollegare l'account? I dati locali restano, ma non si sincronizzeranno più.")) return;
  console.log('[YGO] Disconnessione account');
  cfg = { apiKey: '', binId: '' };
  saveLocal();
  document.getElementById('config-banner').style.display = '';
  document.getElementById('sync-connected').style.display = 'none';
  document.getElementById('apikey-input').value = '';
  document.getElementById('binid-input').value = '';
  setSync('', 'solo locale');
}

function copyBinId() {
  navigator.clipboard.writeText(cfg.binId)
    .then(() => toast('Bin ID copiato ✓'))
    .catch(() => prompt('Copia manualmente:', cfg.binId));
}

function goToSync() {
  switchPage('settings');
  document.getElementById('sync-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────
// TOAST (sostituisce alert, con azione opzionale es. "Annulla")
// ─────────────────────────────────────────────
let toastTimer = null;
function toast(msg, actionLabel, actionFn) {
  const el  = document.getElementById('toast');
  const btn = document.getElementById('toast-btn');
  document.getElementById('toast-msg').textContent = msg;
  btn.style.display = actionLabel ? '' : 'none';
  btn.textContent   = actionLabel || '';
  btn.onclick = () => { el.classList.remove('show'); if (actionFn) actionFn(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? 5000 : 2500);
}

function showCfgError(msg) {
  const el = document.getElementById('cfg-error');
  el.textContent  = msg;
  el.style.display = 'block';
}

function onConnected() {
  document.getElementById('config-banner').style.display = 'none';
  document.getElementById('sync-connected').style.display = '';
  document.getElementById('bin-id-display').textContent = cfg.binId;

  renderPlayers();
  updateSelects();
  renderMatches();
  renderTab();
}

// ─────────────────────────────────────────────
// SYNC UP / DOWN
// ─────────────────────────────────────────────

/** Carica i dati dal bin remoto e aggiorna l'UI. */
async function syncDown() {
  if (!cfg.apiKey || !cfg.binId) {
    console.log('[YGO] syncDown saltato: account non configurato');
    return;
  }

  setSync('loading', 'aggiornamento...');
  console.log('[YGO] syncDown start');

  try {
    const remote = await readBin(); // già { players, matches }

    if (!remote?.players) {
      console.warn('[YGO] syncDown: dati remoti non validi o privi di "players":', remote);
      setSync('err', 'dati remoti non validi');
      return;
    }

    state = remote;
    normalizeState();
    saveLocal();
    if (dmCtx) renderDeckEditor();
    renderPlayers();
    updateSelects();
    renderMatches();
    renderTab();
    setSync('ok', 'sincronizzato');
    console.log('[YGO] syncDown completato:', { players: state.players.length, matches: state.matches.length });

  } catch(e) {
    console.error('[YGO] syncDown error:', e);
    setSync('err', 'errore lettura');
  }
}

/** Salva lo state corrente sul bin remoto. */
async function syncUp() {
  if (!cfg.apiKey || !cfg.binId) {
    console.log('[YGO] syncUp saltato: account non configurato');
    return;
  }

  setSync('loading', 'salvataggio...');
  console.log('[YGO] syncUp start — matches:', state.matches.length);

  try {
    await writeBin();
    setSync('ok', 'salvato');
    console.log('[YGO] syncUp completato');
  } catch(e) {
    console.error('[YGO] syncUp error:', e);
    setSync('err', 'errore salvataggio');
  }
}

async function manualRefresh() {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  console.log('[YGO] Refresh manuale avviato');
  await syncDown();
  btn.classList.remove('spinning');
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const pClass = ['p0', 'p1', 'p2'];

function escH(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────
// RENDER PLAYERS
// ─────────────────────────────────────────────
function renderPlayers() {
  const c = document.getElementById('players-ui');
  c.innerHTML = '';
  state.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = `player-card ${pClass[i]}`;
    div.innerHTML = `
      <input class="player-name-input ${pClass[i]}" value="${escH(p.name)}" placeholder="Nome giocatore"
        oninput="state.players[${i}].name = this.value; saveLocal(); updateSelects(); renderTab();"
        onblur="syncUp()"/>
      <div class="deck-add-row">
        <input type="text" placeholder="Aggiungi mazzo..." id="ni${i}" onkeydown="if(event.key==='Enter') addDeck(${i})"/>
        <button class="btn-icon" onclick="addDeck(${i})">+</button>
      </div>
      <div class="decks-tags" id="dt${i}"></div>`;
    c.appendChild(div);

    const dt = document.getElementById(`dt${i}`);
    if (!p.decks.length) dt.innerHTML = '<span class="dm-empty">Nessun mazzo: aggiungine uno qui sopra</span>';
    p.decks.forEach((dk, j) => {
      const t = document.createElement('button');
      t.className = `deck-tag ${pClass[i]}`;
      t.title = 'Apri lista carte';
      t.onclick = () => openDeckEditor(i, j);
      const dl = state.deckLists[deckKey(i, dk)];
      const n  = dl ? dl.main.length + dl.extra.length : 0;
      t.innerHTML = `${escH(dk)}<span class="deck-count">${n ? n + ' carte' : '+ lista'}</span>`;
      dt.appendChild(t);
    });
  });
}

function addDeck(pi) {
  const inp = document.getElementById(`ni${pi}`);
  const v   = inp.value.trim();
  if (!v) return;
  if (state.players[pi].decks.includes(v)) { toast('Questo giocatore ha già un mazzo con questo nome.'); return; }
  state.players[pi].decks.push(v);
  inp.value = '';
  console.log(`[YGO] Mazzo aggiunto al giocatore ${pi}:`, v);
  saveLocal(); renderPlayers(); updateSelects(); syncUp();
  document.getElementById(`ni${pi}`)?.focus();
}

/**
 * Le partite referenziano i mazzi per indice: eliminando un mazzo vanno
 * rimosse le sue partite e scalati gli indici dei mazzi successivi,
 * altrimenti lo storico punterebbe ai mazzi sbagliati.
 */
function removeDeck(pi, di) {
  const name = state.players[pi].decks[di];
  const uses = m => (m.p1i === pi && m.d1i === di) || (m.p2i === pi && m.d2i === di);
  const nMatches = state.matches.filter(uses).length;
  const dl   = state.deckLists[deckKey(pi, name)];
  const hasList = dl && (dl.main.length + dl.extra.length + dl.side.length) > 0;

  let msg = `Eliminare il mazzo "${name}"?`;
  if (nMatches) msg += `\n\nCompare in ${nMatches} ${nMatches === 1 ? 'partita registrata, che verrà eliminata' : 'partite registrate, che verranno eliminate'}.`;
  if (hasList)  msg += `\nVerrà eliminata anche la lista carte.`;
  if (!confirm(msg)) return false;

  state.matches = state.matches.filter(m => !uses(m));
  state.matches.forEach(m => {
    if (m.p1i === pi && m.d1i > di) m.d1i--;
    if (m.p2i === pi && m.d2i > di) m.d2i--;
  });
  state.players[pi].decks.splice(di, 1);
  delete state.deckLists[deckKey(pi, name)];
  console.log(`[YGO] Mazzo rimosso dal giocatore ${pi}:`, name, `(${nMatches} partite rimosse)`);
  saveLocal(); renderPlayers(); updateSelects(); renderMatches(); renderTab(); syncUp();
  toast(`Mazzo "${name}" eliminato`);
  return true;
}

// ─────────────────────────────────────────────
// SELECT HELPERS
// ─────────────────────────────────────────────
function updateSelects() {
  ['p1sel', 'p2sel'].forEach((id, idx) => {
    const sel  = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = state.players
      .map((p, i) => `<option value="${i}">${escH(p.name)}</option>`)
      .join('');
    sel.value = prev || String(idx === 0 ? 0 : 1);
  });
  updateDeckSelects();
}

function updateDeckSelects(changed) {
  const s1 = document.getElementById('p1sel'), s2 = document.getElementById('p2sel');
  // Evita di selezionare lo stesso giocatore da entrambi i lati: sposta l'altro
  if (s1.value === s2.value && state.players.length > 1) {
    const other = changed === 2 ? s1 : s2;
    other.value = String((parseInt(other.value) + 1) % state.players.length);
  }
  const p1i = parseInt(s1.value) || 0;
  const p2i = parseInt(s2.value) || 0;
  ['d1sel', 'd2sel'].forEach((id, idx) => {
    const sel  = document.getElementById(id);
    const pi   = idx === 0 ? p1i : p2i;
    const prev = sel.dataset.pi == pi ? sel.value : '';
    const decks = state.players[pi]?.decks || [];
    sel.innerHTML = decks.length
      ? decks.map((d, i) => `<option value="${i}">${escH(d)}</option>`).join('')
      : '<option value="">— nessun mazzo —</option>';
    sel.dataset.pi = pi;
    if (prev && decks[prev] != null) sel.value = prev;
  });
  document.getElementById('win-btn-1').textContent = '🏆 ' + (state.players[p1i]?.name || 'Giocatore 1');
  document.getElementById('win-btn-2').textContent = '🏆 ' + (state.players[p2i]?.name || 'Giocatore 2');
}

// ─────────────────────────────────────────────
// ADD / REMOVE MATCH
// ─────────────────────────────────────────────
async function addMatch(ws) {
  const p1i = parseInt(document.getElementById('p1sel').value);
  const p2i = parseInt(document.getElementById('p2sel').value);
  const d1i = parseInt(document.getElementById('d1sel').value);
  const d2i = parseInt(document.getElementById('d2sel').value);
  const err = document.getElementById('match-error');

  if (p1i === p2i) {
    err.textContent = 'Seleziona due giocatori diversi.';
    console.warn('[YGO] addMatch: stessi giocatori selezionati');
    return;
  }

  const d1 = state.players[p1i]?.decks[d1i];
  const d2 = state.players[p2i]?.decks[d2i];

  if (!d1 || !d2) {
    err.textContent = 'Entrambi i giocatori devono avere almeno un mazzo.';
    console.warn('[YGO] addMatch: mazzo mancante', { d1, d2 });
    return;
  }

  err.textContent = '';

  const match = {
    p1i,
    p2i,
    d1i,
    d2i,
    winner: ws === 1 ? p1i : p2i,
    ts: Date.now()
  };

  state.matches.push(match);
  console.log('[YGO] Partita aggiunta:', {
    giocatore1: state.players[p1i].name,
    mazzo1:     d1,
    giocatore2: state.players[p2i].name,
    mazzo2:     d2,
    vincitore:  state.players[match.winner].name
  });

  saveLocal(); renderMatches(); renderTab();
  toast(`Vittoria di ${state.players[match.winner].name} registrata`, 'Annulla', () => {
    const idx = state.matches.indexOf(match);
    if (idx >= 0) { state.matches.splice(idx, 1); saveLocal(); renderMatches(); renderTab(); syncUp(); }
  });
  await syncUp();
}

function removeMatch(i) {
  const [removed] = state.matches.splice(i, 1);
  console.log('[YGO] Partita eliminata (indice', i, '):', removed);
  saveLocal(); renderMatches(); renderTab(); syncUp();
  toast('Partita eliminata', 'Annulla', () => {
    state.matches.splice(Math.min(i, state.matches.length), 0, removed);
    saveLocal(); renderMatches(); renderTab(); syncUp();
  });
}

// ─────────────────────────────────────────────
// MATCHUP KEY
// ─────────────────────────────────────────────
function matchKey(p1, d1n, p2, d2n) {
  const a = `${p1}::${d1n}`, b = `${p2}::${d2n}`;
  return a < b ? `${a}|||${b}` : `${b}|||${a}`;
}

// ─────────────────────────────────────────────
// PAGE NAVIGATION
// ─────────────────────────────────────────────
let currentPage = 'duel';

function switchPage(p) {
  currentPage = p;
  ['duel','matches','stats','settings'].forEach(id => {
    document.getElementById(`page-${id}`).style.display = id === p ? '' : 'none';
    document.getElementById(`nav-${id}`).classList.toggle('active', id === p);
  });
  // Render the relevant content when switching
  if (p === 'matches')  { renderMatches(); }
  if (p === 'stats')    { renderTab(); }
  if (p === 'settings') { renderPlayers(); }
}

// ─────────────────────────────────────────────
// TABS (inside Stats page)
// ─────────────────────────────────────────────
let currentTab = 'stats';

function switchTab(t) {
  currentTab = t;
  document.querySelectorAll('.tab').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === t)
  );
  ['matchups', 'stats'].forEach(id => {
    const el = document.getElementById(`tab-${id}`);
    if (el) el.style.display = id === t ? '' : 'none';
  });
  renderTab();
}

function renderTab() {
  if (currentTab === 'matchups') renderMatchups();
  else                           renderStats();
}

// ─────────────────────────────────────────────
// RENDER: STORICO (card layout)
// ─────────────────────────────────────────────
function renderMatches() {
  const c = document.getElementById('tab-matches');
  if (!c) return;
  if (!state.matches.length) {
    c.innerHTML = '<div class="empty">Nessuna partita registrata.<br><small>Gioca un duello o registra un risultato da Partite.</small></div>';
    return;
  }

  const cards = [...state.matches].reverse().map((m, ri) => {
    const realIdx = state.matches.length - 1 - ri;
    const p1  = state.players[m.p1i];
    const p2  = state.players[m.p2i];
    const d1  = p1?.decks[m.d1i] || '?';
    const d2  = p2?.decks[m.d2i] || '?';
    const p1w = m.winner === m.p1i;
    const dt  = new Date(m.ts).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

    return `<div class="match-card">
      <div class="match-card-side">
        <div class="match-card-player"><span class="badge ${pClass[m.p1i]}">${escH(p1?.name||'?')}</span></div>
        <div class="match-card-deck">${escH(d1)}</div>
        <div class="match-card-result ${p1w?'win':'loss'}">${p1w?'VITTORIA':'SCONFITTA'}</div>
      </div>
      <div class="match-card-center">
        <div class="match-card-vs">VS</div>
        <div class="match-card-date">${dt}</div>
        <button class="match-card-rm" onclick="removeMatch(${realIdx})">×</button>
      </div>
      <div class="match-card-side right">
        <div class="match-card-player"><span class="badge ${pClass[m.p2i]}">${escH(p2?.name||'?')}</span></div>
        <div class="match-card-deck">${escH(d2)}</div>
        <div class="match-card-result ${p1w?'loss':'win'}">${p1w?'SCONFITTA':'VITTORIA'}</div>
      </div>
    </div>`;
  }).join('');

  c.innerHTML = `<div class="match-list">${cards}</div>`;
}

// ─────────────────────────────────────────────
// RENDER: SCONTRI
// ─────────────────────────────────────────────
function renderMatchups() {
  const c   = document.getElementById('tab-matchups');
  const map = {};

  state.matches.forEach(m => {
    const p1 = state.players[m.p1i];
    const p2 = state.players[m.p2i];
    if (!p1 || !p2) return;

    const d1n = p1.decks[m.d1i] || '?';
    const d2n = p2.decks[m.d2i] || '?';
    const key = matchKey(m.p1i, d1n, m.p2i, d2n);

    if (!map[key]) {
      const aFirst = `${m.p1i}::${d1n}` < `${m.p2i}::${d2n}`;
      map[key] = {
        p1i:   aFirst ? m.p1i : m.p2i,
        d1:    aFirst ? d1n   : d2n,
        p2i:   aFirst ? m.p2i : m.p1i,
        d2:    aFirst ? d2n   : d1n,
        w1:    0, w2: 0, total: 0
      };
    }

    const mu = map[key];
    mu.total++;
    if (m.winner === mu.p1i) mu.w1++; else mu.w2++;
  });

  const keys = Object.keys(map);
  if (!keys.length) {
    c.innerHTML = '<div class="empty">Nessuna partita registrata.<br><small>Gioca un duello o registra un risultato da Partite.</small></div>';
    return;
  }

  c.innerHTML = '<div>' + keys.map(k => {
    const mu = map[k];
    const p1 = state.players[mu.p1i];
    const p2 = state.players[mu.p2i];
    return `<div class="matchup-row">
      <div>
        <div class="matchup-deck">${escH(mu.d1)}</div>
        <div style="margin-top:4px"><span class="badge ${pClass[mu.p1i]}">${escH(p1?.name || '?')}</span></div>
      </div>
      <div>
        <div class="matchup-score">${mu.w1} – ${mu.w2}</div>
        <div class="matchup-games">${mu.total} ${mu.total === 1 ? 'partita' : 'partite'}</div>
      </div>
      <div style="text-align:right">
        <div class="matchup-deck">${escH(mu.d2)}</div>
        <div style="margin-top:4px;display:flex;justify-content:flex-end">
          <span class="badge ${pClass[mu.p2i]}">${escH(p2?.name || '?')}</span>
        </div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

// ─────────────────────────────────────────────
// SCORING ENGINE
// ─────────────────────────────────────────────

/**
 * Wilson score lower bound (intervallo di confidenza 95%).
 * Penalizza i deck con poche partite: con n=1 il punteggio
 * è molto vicino allo 0, con n≥15 converge al win rate reale.
 * Restituisce un valore 0–1.
 */
function wilsonScore(wins, total) {
  if (total === 0) return 0;
  const z  = 1.96; // 95% confidence
  const p  = wins / total;
  const z2 = z * z;
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total))
       / (1 + z2 / total);
}

/**
 * Forza media degli avversari battuti.
 * Usa il wilson score degli avversari come peso: battere deck forti vale di più.
 * Restituisce 0–1 (0.5 se nessuna vittoria).
 */
function opponentStrength(wonAgainst, deckStats) {
  const entries = Object.entries(wonAgainst);
  if (!entries.length) return 0.5;
  let weightedSum = 0, totalCount = 0;
  entries.forEach(([oppKey, { count }]) => {
    const opp = deckStats[oppKey];
    if (!opp) return;
    const oppWilson = wilsonScore(opp.wins, opp.wins + opp.losses);
    weightedSum += oppWilson * count;
    totalCount  += count;
  });
  return totalCount ? weightedSum / totalCount : 0.5;
}

/**
 * Punteggio finale composito (0–100):
 *   70% Wilson score (win rate corretto per sample size)
 *   30% Forza avversari battuti
 *
 * Con poche partite il Wilson score è basso → il punteggio
 * resta modesto anche con 100% win rate su 1 partita.
 */
function deckScore(ds, deckStats) {
  const total   = ds.wins + ds.losses;
  const wilson  = wilsonScore(ds.wins, total);
  const oppStr  = opponentStrength(ds.wonAgainst, deckStats);
  return Math.round((wilson * 0.70 + oppStr * 0.30) * 100);
}

// ─────────────────────────────────────────────
// RENDER: STATISTICHE (per deck × giocatore)
// ─────────────────────────────────────────────
function renderStats() {
  const c = document.getElementById('tab-stats');
  if (!state.matches.length) {
    c.innerHTML = '<div class="empty">Nessuna partita registrata.<br><small>Gioca un duello o registra un risultato da Partite.</small></div>';
    return;
  }

  const deckStats = buildDeckStats();

  // ── Ranking globale ───────────────────────────────────────────────────
  let html = renderRanking(deckStats);

  // ── Per giocatore ─────────────────────────────────────────────────────
  html += '<div style="margin-top:1.5rem">';
  state.players.forEach((p, i) => {
    const decks = Object.values(deckStats)
      .filter(d => d.pi === i)
      .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));

    if (!decks.length) return;

    html += `<div class="stat-player">
      <div class="stat-player-name ${pClass[i]}">${escH(p.name)}</div>
      <div class="stat-decks-list">`;

    decks.forEach((d, idx) => {
      const total   = d.wins + d.losses;
      const wr      = total ? Math.round(d.wins / total * 100) : 0;
      const score   = Math.round(wilsonScore(d.wins, total) * 100);
      const wrColor = wr >= 50 ? 'var(--green)' : 'var(--red)';
      const uid     = `sd_${i}_${idx}`;
      const lowData = total < 3;

      const wonList  = Object.values(d.wonAgainst).sort((a, b) => b.count - a.count);
      const lostList = Object.values(d.lostAgainst).sort((a, b) => b.count - a.count);

      const renderOppRows = (list) => list.length
        ? list.map(o => `
            <div class="detail-opponent-row">
              <div>
                <div class="detail-opponent-deck">${escH(o.oppDeck)}</div>
                <div class="detail-opponent-player">${escH(state.players[o.oppPi]?.name || '?')}</div>
              </div>
              <div class="detail-count">${o.count}×</div>
            </div>`).join('')
        : '<div class="detail-empty">—</div>';

      html += `<div class="stat-deck-row" id="${uid}" onclick="toggleDeckDetail('${uid}')">
        <div class="stat-deck-header">
          <div class="stat-deck-left">
            <span class="stat-deck-chevron">▶</span>
            <span class="stat-deck-name ${pClass[i]}">${escH(d.deckName)}</span>
            ${lowData ? '<span class="rank-lowdata">pochi dati</span>' : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="stat-deck-wr" style="color:${wrColor}">${wr}%</div>
            <div style="font-size:10px;color:var(--text3)">score ${score}</div>
          </div>
        </div>
        <div class="stat-deck-bar-bg">
          <div class="stat-deck-bar" style="width:${wr}%;background:${wrColor}"></div>
        </div>
        <div class="stat-deck-nums">
          <span class="win">${d.wins}V</span>
          <span style="color:var(--text3)"> / </span>
          <span class="loss">${d.losses}S</span>
          <span style="color:var(--text3);font-size:11px;margin-left:6px">${total} partite</span>
        </div>
        <div class="stat-deck-detail">
          <div class="detail-section-title">✓ Vittorie contro</div>
          <div class="detail-opponent-list">${renderOppRows(wonList)}</div>
          <div class="detail-section-title" style="margin-top:10px">✗ Sconfitte contro</div>
          <div class="detail-opponent-list">${renderOppRows(lostList)}</div>
        </div>
      </div>`;
    });

    html += '</div></div>';
  });

  html += '</div>';
  c.innerHTML = html;
}

function toggleDeckDetail(uid) {
  const el = document.getElementById(uid);
  if (el) el.classList.toggle('open');
}

// ─────────────────────────────────────────────
// RENDER: RANKING DECK
// ─────────────────────────────────────────────
function buildDeckStats() {
  const deckStats = {};
  state.matches.forEach(m => {
    const sides = [
      { myPi: m.p1i, myDi: m.d1i, oppPi: m.p2i, oppDi: m.d2i },
      { myPi: m.p2i, myDi: m.d2i, oppPi: m.p1i, oppDi: m.d1i }
    ];
    sides.forEach(({ myPi, myDi, oppPi, oppDi }) => {
      const myDeck  = state.players[myPi]?.decks[myDi]  || '?';
      const oppDeck = state.players[oppPi]?.decks[oppDi] || '?';
      const key     = `${myPi}::${myDeck}`;
      const won     = m.winner === myPi;
      const oppKey  = `${oppPi}::${oppDeck}`;
      if (!deckStats[key]) {
        deckStats[key] = { pi: myPi, deckName: myDeck, wins: 0, losses: 0, wonAgainst: {}, lostAgainst: {} };
      }
      const ds = deckStats[key];
      if (won) {
        ds.wins++;
        if (!ds.wonAgainst[oppKey])  ds.wonAgainst[oppKey]  = { count: 0, oppPi, oppDeck };
        ds.wonAgainst[oppKey].count++;
      } else {
        ds.losses++;
        if (!ds.lostAgainst[oppKey]) ds.lostAgainst[oppKey] = { count: 0, oppPi, oppDeck };
        ds.lostAgainst[oppKey].count++;
      }
    });
  });
  return deckStats;
}

function renderRanking(deckStats) {
  const ranked = Object.values(deckStats)
    .map(d => {
      const total = d.wins + d.losses;
      const wr    = total ? d.wins / total : 0;
      const score = wilsonScore(d.wins, total);
      return { ...d, total, wr, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return '';

  const medals = ['🥇', '🥈', '🥉'];

  const renderOppRows = (list) => list.length
    ? list.map(o => `
        <div class="detail-opponent-row">
          <div>
            <div class="detail-opponent-deck">${escH(o.oppDeck)}</div>
            <div class="detail-opponent-player">${escH(state.players[o.oppPi]?.name || '?')}</div>
          </div>
          <div class="detail-count">${o.count}×</div>
        </div>`).join('')
    : '<div class="detail-empty">—</div>';

  const rows = ranked.map((d, idx) => {
    const wr      = Math.round(d.wr * 100);
    const score   = Math.round(d.score * 100);
    const wrColor = wr >= 50 ? 'var(--green)' : 'var(--red)';
    const medal   = medals[idx] || `#${idx + 1}`;
    const lowData = d.total < 3;
    const p       = state.players[d.pi];
    const uid     = `rk_${d.pi}_${idx}`;

    const wonList  = Object.values(d.wonAgainst).sort((a, b) => b.count - a.count);
    const lostList = Object.values(d.lostAgainst).sort((a, b) => b.count - a.count);

    return `<div class="rank-row" id="${uid}" onclick="toggleDeckDetail('${uid}')">
      <div class="rank-row-header">
        <div class="rank-pos">${medal}</div>
        <div class="rank-info">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="stat-deck-chevron">▶</span>
            <div class="rank-deck-name ${pClass[d.pi]}">${escH(d.deckName)}</div>
          </div>
          <div class="rank-player"><span class="badge ${pClass[d.pi]}">${escH(p?.name || '?')}</span>${lowData ? '<span class="rank-lowdata">pochi dati</span>' : ''}</div>
        </div>
        <div class="rank-right">
          <div class="rank-wr" style="color:${wrColor}">${wr}%</div>
          <div class="rank-score">score ${score}</div>
          <div class="rank-games">${d.wins}V ${d.losses}S · ${d.total} pt</div>
        </div>
      </div>
      <div class="stat-deck-detail">
        <div class="detail-section-title">✓ Vittorie contro</div>
        <div class="detail-opponent-list">${renderOppRows(wonList)}</div>
        <div class="detail-section-title" style="margin-top:10px">✗ Sconfitte contro</div>
        <div class="detail-opponent-list">${renderOppRows(lostList)}</div>
      </div>
    </div>`;
  }).join('');

  return `<div class="ranking-panel">
    <div class="ranking-title">🏆 Classifica Mazzi</div>
    <div class="ranking-subtitle">Ordinati per affidabilità: conta il win rate ma anche quante partite ha giocato · tocca un mazzo per i dettagli</div>
    <div class="ranking-list">${rows}</div>
  </div>`;
}

// ─────────────────────────────────────────────
// DUELLO — LP TRACKER
// ─────────────────────────────────────────────

const STARTING_LP   = 8000;
const DANGER_LP     = 2000;
const MAX_LP        = 999999;

// duelState è separato dallo state principale (non viene salvato nel bin).
// Un solo tastierino condiviso: si tocca il giocatore bersaglio (sel) e poi si applica.
let duelState = null;

function renderDuel() {
  const c = document.getElementById('duel-content');
  const resetBtn = document.getElementById('duel-reset-btn');

  if (!duelState) {
    // ── Setup screen: scelta giocatore + mazzo per ciascuno dei 2 slot ──
    resetBtn.style.display = 'none';
    const slotSelect = (slot) => {
      const playerOpts = state.players.map((p, pi) =>
        `<option value="${pi}">${escH(p.name)}</option>`).join('');
      return `
        <div class="duel-slot">
          <div class="form-label" style="margin-bottom:6px">Giocatore ${slot + 1}</div>
          <select id="duel-p${slot}" onchange="onDuelPlayerChange(${slot})">${playerOpts}</select>
          <select id="duel-d${slot}" style="margin-top:6px"></select>
        </div>`;
    };
    const noDecks = state.players.some(p => !p.decks.length);

    c.innerHTML = `
      <div class="duel-setup">
        <div class="duel-slots-row">
          ${slotSelect(0)}
          <div class="duel-vs-sep">VS</div>
          ${slotSelect(1)}
        </div>
        ${noDecks ? `<p class="hint" style="margin:0">Qualche giocatore non ha ancora mazzi: aggiungili in <a onclick="switchPage('settings')">Mazzi</a>.</p>` : ''}
        <div id="duel-setup-err" class="form-error"></div>
        <button class="btn-start-duel" onclick="startDuel()">⚔ Inizia Duello · ${STARTING_LP.toLocaleString('it-IT')} LP</button>
      </div>`;

    const p1sel = document.getElementById('duel-p1');
    if (p1sel && state.players.length > 1) p1sel.value = '1';
    onDuelPlayerChange(0);
    onDuelPlayerChange(1);
    return;
  }

  resetBtn.style.display = duelState.over ? 'none' : '';
  const canUndo = duelState.history.length > 0;

  if (duelState.over) {
    // ── Game over screen ──────────────────────────────────────────────
    const winner = duelState.winner;
    const loser  = winner && duelState.players.find(p => p.slot !== winner.slot);
    c.innerHTML = `
      <div class="duel-over-banner">
        ${winner ? `
          <div class="duel-over-title">🏆 ${escH(winner.name)} vince!</div>
          <div class="duel-over-sub">${escH(winner.deck)} batte ${escH(loser.name)} (${escH(loser.deck)})</div>`
        : `
          <div class="duel-over-title">Pareggio</div>
          <div class="duel-over-sub">Entrambi i giocatori sono a 0 LP — i pareggi non vengono registrati.</div>`}
        <div class="duel-over-btns">
          ${winner ? `<button class="btn-save-result" onclick="saveDuelResult()">💾 Salva risultato</button>` : ''}
          <button class="btn-new-duel" onclick="undoDuel()">↶ Annulla ultima mossa</button>
          <button class="btn-new-duel" onclick="resetDuel()">↺ Nuovo duello</button>
        </div>
      </div>`;
    return;
  }

  // ── Active duel ───────────────────────────────────────────────────
  const cards = duelState.players.map(p => {
    const pct      = Math.min(100, Math.max(0, p.lp / STARTING_LP * 100));
    const danger   = p.lp <= DANGER_LP;
    const barColor = danger ? 'var(--red)' : `var(--${pClass[p.pi]})`;
    const sel      = duelState.sel === p.slot;
    return `
    <button class="duel-player-card ${pClass[p.pi]}${sel ? ' selected' : ''}" onclick="selectDuelPlayer(${p.slot})">
      <div class="duel-player-header" style="display:block">
        <div class="duel-player-name ${pClass[p.pi]}">${escH(p.name)}</div>
        <div class="duel-deck-badge">${escH(p.deck)}</div>
      </div>
      <div class="duel-lp-display ${pClass[p.pi]}${danger ? ' danger' : ''}">${p.lp.toLocaleString('it-IT')}</div>
      <div class="duel-lp-bar-bg"><div class="duel-lp-bar" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="duel-target-tag">${sel ? '▲ bersaglio' : ''}</div>
    </button>`;
  }).join('');

  const target = duelState.players[duelState.sel];
  const keys = [7,8,9,4,5,6,1,2,3].map(n =>
    `<button class="duel-key" onclick="kbPress('${n}')">${n}</button>`).join('')
    + `<button class="duel-key small" onclick="kbPress('00')">00</button>`
    + `<button class="duel-key" onclick="kbPress('0')">0</button>`
    + `<button class="duel-key small" onclick="kbPress('000')">000</button>`;

  const logEntries = [...duelState.log].reverse().slice(0, 12)
    .map(e => `<div class="duel-log-entry ${e.type}">${escH(e.msg)}</div>`).join('');

  c.innerHTML = `
    <div class="duel-board">${cards}</div>
    <div class="duel-pad">
      <div class="duel-quick-row">
        ${[100, 200, 300, 500, 1000, 2000].map(v =>
          `<button class="duel-quick-btn ${v >= 1000 ? 'q-thousands' : 'q-hundreds'}" onclick="quickApply(-${v})">−${v >= 1000 ? v / 1000 + 'k' : v}</button>`).join('')}
        <button class="duel-quick-btn" onclick="halveLp()" title="Dimezza i LP">½</button>
      </div>
      <div class="duel-display">
        <button class="duel-display-back" onclick="kbBack()" title="Cancella">⌫</button>
        <div class="duel-display-num ${duelState.buf ? '' : 'empty'}" id="kdisp">
          ${duelState.buf ? parseInt(duelState.buf).toLocaleString('it-IT') : `importo per ${escH(target.name)}…`}
        </div>
      </div>
      <div class="duel-keypad">${keys}</div>
      <div class="duel-action-row">
        <button class="duel-btn-dmg" onclick="applyDmg()">− Danno</button>
        <button class="duel-btn-heal" onclick="applyHl()">+ Cura</button>
      </div>
      <div class="duel-util-row">
        <button class="btn-cfg-sec" onclick="undoDuel()" ${canUndo ? '' : 'disabled'}>↶ Annulla</button>
      </div>
    </div>
    ${duelState.log.length ? `<div class="duel-log">${logEntries}</div>` : ''}
    <div class="tools-panel">
      <div class="dice-panel">
        <div class="dice-label-title">🎲 Dado d6</div>
        <button class="dice-btn" onclick="rollDice()">⚄</button>
        <div class="dice-result-wrap">
          <span class="dice-result" id="dice-result">—</span>
          <div class="dice-faces">lancia il dado</div>
        </div>
      </div>
      <div class="coin-panel">
        <div class="coin-label-title">🪙 Moneta</div>
        <button class="coin-btn" onclick="flipCoin()">🪙</button>
        <div class="coin-result-wrap">
          <span class="coin-result" id="coin-result">—</span>
          <div class="coin-sub">lancia la moneta</div>
        </div>
      </div>
    </div>`;
}

function onDuelPlayerChange(slot) {
  const pi      = parseInt(document.getElementById(`duel-p${slot}`)?.value ?? slot);
  const deckSel = document.getElementById(`duel-d${slot}`);
  if (!deckSel) return;
  const decks = state.players[pi]?.decks || [];
  deckSel.innerHTML = decks.length
    ? decks.map((d, di) => `<option value="${di}">${escH(d)}</option>`).join('')
    : '<option value="">— nessun mazzo —</option>';
}

function startDuel() {
  const pi0 = parseInt(document.getElementById('duel-p0').value);
  const pi1 = parseInt(document.getElementById('duel-p1').value);
  const di0 = parseInt(document.getElementById('duel-d0').value || 0);
  const di1 = parseInt(document.getElementById('duel-d1').value || 0);
  const err = document.getElementById('duel-setup-err');

  if (pi0 === pi1) {
    err.textContent = 'Seleziona due giocatori diversi.';
    return;
  }
  err.textContent = '';

  const p0 = state.players[pi0];
  const p1 = state.players[pi1];

  if (!p0?.decks?.length || !p1?.decks?.length) {
    err.textContent = 'Entrambi i giocatori devono avere almeno un mazzo.';
    return;
  }

  const players = [
    { slot: 0, pi: pi0, name: p0.name, deck: p0.decks[di0] || '?', lp: STARTING_LP },
    { slot: 1, pi: pi1, name: p1.name, deck: p1.decks[di1] || '?', lp: STARTING_LP },
  ];

  duelState = { players, log: [], history: [], over: false, winner: null, buf: '', sel: 0 };
  console.log('[YGO] Duello iniziato:', players.map(p => `${p.name} (${p.deck})`));
  renderDuel();
}

function resetDuel() {
  if (duelState && !duelState.over) {
    if (!confirm('Abbandonare il duello in corso?')) return;
  }
  duelState = null;
  renderDuel();
}

function selectDuelPlayer(slot) {
  if (!duelState || duelState.over) return;
  duelState.sel = slot;
  renderDuel();
}

// ── Tastierino condiviso ──────────────────────────────────────────────────
function kbPress(digits) {
  const cur = duelState.buf;
  if (!cur && /^0+$/.test(digits)) return;           // niente zeri iniziali
  if ((cur + digits).length > 6) return;             // max 999.999
  duelState.buf = cur + digits;
  refreshDisplay();
}

function kbBack() {
  duelState.buf = duelState.buf.slice(0, -1);
  refreshDisplay();
}

function refreshDisplay() {
  const el = document.getElementById('kdisp');
  if (!el) return;
  const buf = duelState.buf;
  el.className   = 'duel-display-num' + (buf ? '' : ' empty');
  el.textContent = buf ? parseInt(buf).toLocaleString('it-IT') : `importo per ${duelState.players[duelState.sel].name}…`;
}

// ── Modifica LP (con cronologia per "Annulla") ────────────────────────────
function changeLp(delta, label) {
  const p = duelState.players[duelState.sel];
  if (!p || !delta) return;
  duelState.history.push({ lps: duelState.players.map(x => x.lp), logLen: duelState.log.length });
  const prev = p.lp;
  p.lp = Math.max(0, Math.min(MAX_LP, p.lp + delta));
  const fmt = n => n.toLocaleString('it-IT');
  duelState.log.push({
    type: delta < 0 ? 'dmg' : 'heal',
    msg:  `${p.name}: ${label || (delta < 0 ? '−' : '+') + fmt(Math.abs(delta))} LP  (${fmt(prev)} → ${fmt(p.lp)})`
  });
  duelState.buf = '';
  checkDuelOver();
  renderDuel();
}

function quickApply(delta) { changeLp(delta); }
function applyDmg() { const a = parseInt(duelState.buf) || 0; if (a) changeLp(-a); }
function applyHl()  { const a = parseInt(duelState.buf) || 0; if (a) changeLp(a); }

function halveLp() {
  const p = duelState.players[duelState.sel];
  changeLp(-Math.floor(p.lp / 2), '½');
}

function undoDuel() {
  const h = duelState?.history.pop();
  if (!h) return;
  duelState.players.forEach((p, i) => { p.lp = h.lps[i]; });
  duelState.log.length = h.logLen;
  duelState.over = false;
  duelState.winner = null;
  renderDuel();
}

// Tastiera fisica: cifre, Backspace, Invio/− = danno, + = cura, ←/→ = bersaglio, Ctrl+Z = annulla
document.addEventListener('keydown', e => {
  if (currentPage !== 'duel' || !duelState || duelState.over || dmCtx) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (/^\d$/.test(e.key))                       kbPress(e.key);
  else if (e.key === 'Backspace')               kbBack();
  else if (e.key === 'Enter' || e.key === '-')  applyDmg();
  else if (e.key === '+')                       applyHl();
  else if (e.key === 'ArrowLeft')               selectDuelPlayer(0);
  else if (e.key === 'ArrowRight')              selectDuelPlayer(1);
  else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) undoDuel();
  else return;
  e.preventDefault();
});

function rollDice() {
  const result = Math.floor(Math.random() * 6) + 1;
  const glyphs = ['⚀','⚁','⚂','⚃','⚄','⚅'];
  const el = document.getElementById('dice-result');
  if (el) {
    el.textContent = glyphs[result - 1];
    el.classList.remove('roll');
    void el.offsetWidth;
    el.classList.add('roll');
  }
  console.log(`[YGO] Dado d6: ${result}`);
}

function flipCoin() {
  const heads = Math.random() < 0.5;
  const el    = document.getElementById('coin-result');
  if (el) {
    el.textContent = heads ? '⬆ Testa' : '⬇ Croce';
    el.style.color = heads ? 'var(--gold2)' : 'var(--text2)';
    el.classList.remove('flip');
    void el.offsetWidth;
    el.classList.add('flip');
  }
  console.log(`[YGO] Moneta: ${heads ? 'Testa' : 'Croce'}`);
}

function checkDuelOver() {
  const alive = duelState.players.filter(p => p.lp > 0);
  if (alive.length === duelState.players.length) return;
  duelState.over   = true;
  duelState.winner = alive.length === 1 ? alive[0] : null;   // null = pareggio
  console.log('[YGO] Duello terminato. Vincitore:', duelState.winner?.name || 'pareggio');
}

async function saveDuelResult() {
  if (!duelState?.over || !duelState.winner) return;
  const [a, b] = duelState.players;
  // Risolvo gli indici dei mazzi per nome: potrebbero essere cambiati durante il duello
  const d1i = state.players[a.pi]?.decks.indexOf(a.deck);
  const d2i = state.players[b.pi]?.decks.indexOf(b.deck);
  if (d1i < 0 || d2i < 0) { toast('Un mazzo del duello non esiste più: impossibile salvare.'); return; }

  const match = { p1i: a.pi, p2i: b.pi, d1i, d2i, winner: duelState.winner.pi, ts: Date.now() };
  state.matches.push(match);
  console.log('[YGO] Risultato duello salvato:', match);

  saveLocal();
  renderTab();
  duelState = null;
  renderDuel();
  switchPage('matches');
  toast('Risultato salvato ✓');
  await syncUp();
}

// ─────────────────────────────────────────────
// DECK LIST — dati carte da YGOPRODeck, import/export .ydk e YDKE
// ─────────────────────────────────────────────
const CARD_CACHE_KEY = 'ygo_cards_v1';
const YGOPRO_API     = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const CARD_IMG       = id => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;
const SECTION_MAX    = { main: 60, extra: 15, side: 15 };
const SECTION_MIN    = { main: 40, extra: 0,  side: 0  };
const SECTION_LABEL  = { main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' };
const MAX_COPIES     = 3;

// Cache locale dei dati carta (solo nome/tipo) — NON va nel bin per non gonfiarlo
let cardCache = {};
try { cardCache = JSON.parse(localStorage.getItem(CARD_CACHE_KEY) || '{}'); } catch(e) { cardCache = {}; }

function saveCardCache() {
  try { localStorage.setItem(CARD_CACHE_KEY, JSON.stringify(cardCache)); }
  catch(e) { console.warn('[YGO] Cache carte piena, reset', e); cardCache = {}; }
}

function deckKey(pi, name) { return `${pi}::${name}`; }

function getDeckList(create) {
  if (!dmCtx) return null;
  const k = deckKey(dmCtx.pi, dmCtx.name);
  if (!state.deckLists[k] && create) state.deckLists[k] = { main: [], extra: [], side: [] };
  return state.deckLists[k] || { main: [], extra: [], side: [] };
}

function isExtraFrame(f) { return /^(fusion|synchro|xyz|link)/.test(f || ''); }

function cacheCard(c, overwrite = true) {
  const entry = { n: c.name, f: c.frameType || '', t: c.type || '' };
  const id = String(c.id);
  if (overwrite || !cardCache[id]) cardCache[id] = entry;
  // Gli artwork alternativi hanno id propri: li mappiamo sulla stessa carta
  (c.card_images || []).forEach(im => {
    const aid = String(im.id);
    if (overwrite || !cardCache[aid]) cardCache[aid] = entry;
  });
  return entry;
}

async function apiCards(params) {
  const res = await fetch(`${YGOPRO_API}?${new URLSearchParams(params)}`);
  if (res.status === 400) return [];            // l'API risponde 400 quando non trova nulla
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return j.data || [];
}

/** Scarica i dati delle carte non ancora in cache. Ritorna gli id sconosciuti. */
async function ensureCards(ids) {
  const missing = [...new Set(ids.map(String))].filter(id => !cardCache[id]);
  if (!missing.length) return [];
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    try { (await apiCards({ id: chunk.join(',') })).forEach(c => cacheCard(c)); }
    catch(e) { console.error('[YGO] ensureCards chunk:', e); }
  }
  // Se un id non valido fa fallire la richiesta multipla, riprova uno per uno
  const still = missing.filter(id => !cardCache[id]);
  for (let i = 0; i < still.length && i < 90; i += 10) {
    await Promise.all(still.slice(i, i + 10).map(id =>
      apiCards({ id }).then(r => r.forEach(c => cacheCard(c))).catch(() => {})));
  }
  saveCardCache();
  return missing.filter(id => !cardCache[id]);
}

// ── Formati ──
function parseYdk(text) {
  const out = { main: [], extra: [], side: [] };
  let sec = 'main';
  text.split(/\r?\n/).forEach(raw => {
    const l = raw.trim();
    if (!l) return;
    if (/^#main/i.test(l))  { sec = 'main';  return; }
    if (/^#extra/i.test(l)) { sec = 'extra'; return; }
    if (/^!side/i.test(l))  { sec = 'side';  return; }
    if (l.startsWith('#') || l.startsWith('!')) return;
    const m = l.match(/^(\d+)/);
    if (m) out[sec].push(String(parseInt(m[1], 10)));
  });
  return out;
}

function toYdk(l) {
  return ['#created by YGO Tracker', '#main', ...l.main, '#extra', ...l.extra, '!side', ...l.side, ''].join('\n');
}

function b64ToIds(b64) {
  if (!b64) return [];
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dv = new DataView(bytes.buffer);
  const ids = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) ids.push(String(dv.getUint32(i, true)));
  return ids;
}

function idsToB64(ids) {
  const buf = new ArrayBuffer(ids.length * 4);
  const dv  = new DataView(buf);
  ids.forEach((id, i) => dv.setUint32(i * 4, Number(id) >>> 0, true));
  let s = '';
  new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s);
}

function parseYdke(url) {
  const parts = url.trim().replace(/^ydke:\/\//i, '').split('!');
  if (parts.length < 3) throw new Error('Link YDKE non valido');
  return { main: b64ToIds(parts[0]), extra: b64ToIds(parts[1]), side: b64ToIds(parts[2]) };
}

function toYdke(l) {
  return `ydke://${idsToB64(l.main)}!${idsToB64(l.extra)}!${idsToB64(l.side)}!`;
}

// ── Editor UI ──
let dmCtx = null;          // { pi, name }
let dmSyncTimer = null;
let searchTimer = null, searchSeq = 0;

function dmMsg(text, cls = '') {
  const el = document.getElementById('dm-msg');
  el.textContent = text;
  el.className = 'dm-msg' + (cls ? ' ' + cls : '');
}

function scheduleDeckSync() {
  clearTimeout(dmSyncTimer);
  dmSyncTimer = setTimeout(() => { dmSyncTimer = null; syncUp(); }, 1500);
}

function commitDeck() {
  saveLocal();
  renderDeckEditor();
  renderSearchResults();
  renderPlayers();
  scheduleDeckSync();
}

let dmTarget = 'auto';     // 'auto' = Main o Extra in base al tipo, 'side' = Side Deck
function setDeckTarget(v) {
  dmTarget = v;
  document.querySelectorAll('#dm-target button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

async function openDeckEditor(pi, di) {
  const name = state.players[pi]?.decks[di];
  if (name == null) return;
  dmCtx = { pi, name };
  document.getElementById('dm-title').textContent = `${name} — ${state.players[pi].name}`;
  document.getElementById('dm-search-input').value = '';
  dmResults = [];
  searchSeq++;
  document.getElementById('dm-results').innerHTML = '';
  document.getElementById('dm-import').classList.remove('open');
  document.getElementById('dm-export').classList.remove('open');
  document.getElementById('dm-import-text').value = '';
  setDeckTarget('auto');
  dmMsg('');
  document.getElementById('deck-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderDeckEditor();
  // Focus automatico solo con mouse: su telefono aprirebbe la tastiera sopra la lista
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) document.getElementById('dm-search-input').focus();

  const l = getDeckList(false);
  const all = [...l.main, ...l.extra, ...l.side];
  if (all.some(id => !cardCache[id])) {
    dmMsg('Caricamento dati carte...');
    const unknown = await ensureCards(all);
    dmMsg(unknown.length ? `${unknown.length} carte non trovate nel database.` : '', unknown.length ? 'err' : '');
    if (dmCtx) renderDeckEditor();
  }
}

function closeDeckEditor() {
  dmCtx = null;
  document.getElementById('deck-modal').classList.remove('open');
  document.body.style.overflow = '';
  if (dmSyncTimer) { clearTimeout(dmSyncTimer); dmSyncTimer = null; syncUp(); }
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && dmCtx) closeDeckEditor(); });

function typeOrder(c) {
  if (!c) return 9;
  if (c.f === 'spell') return 2;
  if (c.f === 'trap')  return 3;
  if (c.f.startsWith('fusion'))  return 4;
  if (c.f.startsWith('synchro')) return 5;
  if (c.f.startsWith('xyz'))     return 6;
  if (c.f === 'link')            return 7;
  return 1;
}

function cardRowHtml(id, name, type, controls, rowAttrs = '', extraCls = '') {
  return `<div class="card-row ${extraCls}" ${rowAttrs}>
    <img src="${CARD_IMG(id)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'"/>
    <div class="card-info">
      <div class="card-name">${escH(name)}</div>
      <div class="card-type">${escH(type)}</div>
    </div>
    ${controls}
  </div>`;
}

function renderDeckEditor() {
  if (!dmCtx) return;
  const l = getDeckList(false);
  const bad = sec => l[sec].length > SECTION_MAX[sec] || l[sec].length < SECTION_MIN[sec];
  document.getElementById('dm-counts').innerHTML =
    ['main', 'extra', 'side'].map(sec =>
      `<span style="${bad(sec) ? 'color:var(--red)' : ''}">${SECTION_LABEL[sec].split(' ')[0]} ${l[sec].length}</span>`
    ).join(' · ');

  let html = '';
  ['main', 'extra', 'side'].forEach(sec => {
    const counts = new Map();
    l[sec].forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    const rows = [...counts.entries()].sort((a, b) => {
      const ca = cardCache[a[0]], cb = cardCache[b[0]];
      return typeOrder(ca) - typeOrder(cb) || (ca?.n || a[0]).localeCompare(cb?.n || b[0]);
    });
    if (!rows.length && sec !== 'main') return;   // Extra/Side vuoti: niente sezione
    html += `<div class="dm-section">
      <div class="dm-section-title">
        <span>${SECTION_LABEL[sec]}</span>
        <span class="${bad(sec) ? 'bad' : ''}">${l[sec].length}${sec === 'main' ? ' / 40–60' : ' / ' + SECTION_MAX[sec]}</span>
      </div>
      <div class="dm-list">`;
    if (!rows.length) html += `<div class="dm-empty">Lista vuota: cerca una carta qui sopra oppure usa ⇩ Importa per caricare un file .ydk.</div>`;
    rows.forEach(([id, n]) => {
      const c = cardCache[id];
      const controls = `
        <button class="card-btn" title="${sec === 'side' ? 'Sposta nel Main/Extra' : 'Sposta nel Side'}" onclick="moveCard('${sec}','${id}')">⇄</button>
        <button class="card-btn" onclick="changeCard('${sec}','${id}',-1)">−</button>
        <span class="card-qty">${n}</span>
        <button class="card-btn" onclick="changeCard('${sec}','${id}',1)">+</button>`;
      html += cardRowHtml(id, c ? c.n : `#${id}`, c ? c.t : 'caricamento...', controls);
    });
    html += `</div></div>`;
  });
  document.getElementById('dm-sections').innerHTML = html;
}

function copiesOf(l, id) {
  const c = cardCache[id];
  // conta anche gli artwork alternativi della stessa carta
  const same = x => x === id || (c && cardCache[x] === c);
  return [...l.main, ...l.extra, ...l.side].filter(same).length;
}

function canAdd(l, sec, id) {
  if (copiesOf(l, id) >= MAX_COPIES) { dmMsg(`Massimo ${MAX_COPIES} copie per carta.`, 'err'); return false; }
  if (l[sec].length >= SECTION_MAX[sec]) { dmMsg(`${SECTION_LABEL[sec]} pieno (${SECTION_MAX[sec]}).`, 'err'); return false; }
  return true;
}

function naturalSection(id) { return isExtraFrame(cardCache[id]?.f) ? 'extra' : 'main'; }

function addCard(id) {
  const l   = getDeckList(true);
  const sec = dmTarget === 'side' ? 'side' : naturalSection(id);
  if (!canAdd(l, sec, id)) return;
  l[sec].push(String(id));
  dmMsg(`+1 ${cardCache[id]?.n || id} → ${SECTION_LABEL[sec]}`, 'ok');
  commitDeck();
}

function changeCard(sec, id, delta) {
  const l = getDeckList(true);
  if (delta > 0) {
    if (!canAdd(l, sec, id)) return;
    l[sec].push(id);
  } else {
    const idx = l[sec].lastIndexOf(id);
    if (idx >= 0) l[sec].splice(idx, 1);
  }
  dmMsg('');
  commitDeck();
}

function moveCard(sec, id) {
  const l    = getDeckList(true);
  const dest = sec === 'side' ? naturalSection(id) : 'side';
  if (l[dest].length >= SECTION_MAX[dest]) { dmMsg(`${SECTION_LABEL[dest]} pieno.`, 'err'); return; }
  const idx = l[sec].lastIndexOf(id);
  if (idx < 0) return;
  l[sec].splice(idx, 1);
  l[dest].push(id);
  dmMsg('');
  commitDeck();
}

function clearDeckList() {
  const l = getDeckList(false);
  if (!l.main.length && !l.extra.length && !l.side.length) return;
  if (!confirm('Svuotare la lista carte di questo mazzo?')) return;
  delete state.deckLists[deckKey(dmCtx.pi, dmCtx.name)];
  dmMsg('Lista svuotata.', 'ok');
  commitDeck();
}

function renameDeck() {
  if (!dmCtx) return;
  const { pi, name } = dmCtx;
  const v = (prompt('Nuovo nome del mazzo:', name) || '').trim();
  if (!v || v === name) return;
  const decks = state.players[pi].decks;
  if (decks.includes(v)) { dmMsg('Esiste già un mazzo con questo nome.', 'err'); return; }
  const di = decks.indexOf(name);
  if (di < 0) return;
  decks[di] = v;   // le partite usano l'indice: restano collegate
  const oldKey = deckKey(pi, name);
  if (state.deckLists[oldKey]) { state.deckLists[deckKey(pi, v)] = state.deckLists[oldKey]; delete state.deckLists[oldKey]; }
  dmCtx.name = v;
  document.getElementById('dm-title').textContent = `${v} — ${state.players[pi].name}`;
  updateSelects(); renderMatches(); renderTab();
  dmMsg('Mazzo rinominato ✓', 'ok');
  commitDeck();
}

function deleteDeckFromEditor() {
  if (!dmCtx) return;
  const di = state.players[dmCtx.pi].decks.indexOf(dmCtx.name);
  if (di < 0) return;
  const pi = dmCtx.pi;
  dmCtx = null;                                   // evita che il sync ricrei la lista
  if (removeDeck(pi, di)) closeDeckEditor();
  else dmCtx = { pi, name: state.players[pi].decks[di] };
}

// ── Ricerca carte ──
// L'API cerca per sottostringa esatta ("blue eyes" non trova "Blue-Eyes").
// Se la query intera non dà risultati, cerco la parola più lunga e filtro in locale
// richiedendo tutte le parole (ignorando maiuscole, accenti e punteggiatura).
let dmResults = [];

function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function onCardSearch(q) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runCardSearch(q.trim()), 350);
}

function onCardSearchKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(searchTimer);
  // Invio aggiunge il primo risultato (se la ricerca è già completata)
  if (dmResults.length && document.getElementById('dm-search-input').value.trim() === dmResults.q) addCard(dmResults[0].id);
  else runCardSearch(e.target.value.trim());
}

async function searchBoth(fname, num) {
  const p = num ? { fname, num, offset: 0 } : { fname };
  const [en, it] = await Promise.all([
    apiCards(p).catch(() => []),
    apiCards({ ...p, language: 'it' }).catch(() => [])
  ]);
  return { en, it };
}

async function runCardSearch(q) {
  const box = document.getElementById('dm-results');
  const seq = ++searchSeq;
  if (normName(q).length < 3) {
    dmResults = [];
    box.innerHTML = q ? `<div class="dm-empty">Scrivi almeno 3 lettere…</div>` : '';
    return;
  }
  box.innerHTML = `<div class="dm-empty">Ricerca…</div>`;
  try {
    const words = normName(q).split(' ').filter(Boolean);
    let { en, it } = await searchBoth(q, 40);

    if (!en.length && !it.length) {
      const tokens = [...new Set(words)].filter(w => w.length >= 3).sort((a, b) => b.length - a.length).slice(0, 2);
      for (const t of tokens) {
        if (seq !== searchSeq) return;
        const r = await searchBoth(t);
        const ok = c => { const n = normName(c.name); return words.every(w => n.includes(w)); };
        en = r.en.filter(ok); it = r.it.filter(ok);
        if (en.length || it.length) break;
      }
    }
    const playable = c => !/^(Token|Skill Card)$/.test(c.type || "");
    en = en.filter(playable); it = it.filter(playable);
    if (seq !== searchSeq) return;

    const map = new Map();
    en.forEach(c => { cacheCard(c); map.set(String(c.id), { id: String(c.id), name: c.name, type: c.type }); });
    it.forEach(c => {
      const id = String(c.id);
      if (map.has(id)) { map.get(id).it = c.name; return; }
      cacheCard(c, false);
      map.set(id, { id, name: c.name, type: c.type });
    });
    saveCardCache();

    const ql = normName(q);
    const score = r => {
      const names = [r.name, r.it].filter(Boolean).map(normName);
      if (names.some(n => n === ql)) return 0;
      if (names.some(n => n.startsWith(ql))) return 1;
      return 2;
    };
    dmResults = [...map.values()].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)).slice(0, 30);
    dmResults.q = q;
    renderSearchResults();
  } catch(e) {
    console.error('[YGO] Ricerca carte:', e);
    if (seq === searchSeq) box.innerHTML = `<div class="dm-empty">Errore di rete durante la ricerca. Riprova.</div>`;
  }
}

function renderSearchResults() {
  const box = document.getElementById('dm-results');
  if (!dmCtx || !dmResults.q) return;
  if (!dmResults.length) {
    box.innerHTML = `<div class="dm-empty">Nessuna carta trovata per “${escH(dmResults.q)}”. Prova con meno parole o col nome inglese.</div>`;
    return;
  }
  const l = getDeckList(false);
  box.innerHTML = dmResults.map(r => {
    const have = copiesOf(l, r.id);
    const maxed = have >= MAX_COPIES;
    return cardRowHtml(
      r.id,
      r.it && r.it !== r.name ? `${r.name} · ${r.it}` : r.name,
      r.type || '',
      `${have ? `<span class="card-have">${have}/${MAX_COPIES}</span>` : ''}<button class="card-btn" title="Aggiungi" tabindex="-1">+</button>`,
      `onclick="addCard('${r.id}')" title="Tocca per aggiungere"`, maxed ? 'maxed' : ''
    );
  }).join('');
}

// ── Import / Export ──
function toggleDeckPanel(id) {
  ['dm-import', 'dm-export'].forEach(p =>
    document.getElementById(p).classList.toggle('open', p === id && !document.getElementById(p).classList.contains('open')));
}

async function importDeckFromText(text) {
  if (!dmCtx) return;
  text = (text || '').trim();
  let parsed;
  try {
    const ydke = text.match(/ydke:\/\/[A-Za-z0-9+/=!]+/i);
    parsed = ydke ? parseYdke(ydke[0]) : parseYdk(text);
  } catch(e) {
    dmMsg('Formato non riconosciuto: ' + e.message, 'err');
    return;
  }
  const total = parsed.main.length + parsed.extra.length + parsed.side.length;
  if (!total) { dmMsg('Nessuna carta trovata nel testo.', 'err'); return; }

  const cur = getDeckList(false);
  if ((cur.main.length + cur.extra.length + cur.side.length) > 0 &&
      !confirm('Sostituire la lista attuale con quella importata?')) return;

  state.deckLists[deckKey(dmCtx.pi, dmCtx.name)] = parsed;
  document.getElementById('dm-import').classList.remove('open');
  document.getElementById('dm-import-text').value = '';
  commitDeck();

  dmMsg(`Importate ${total} carte, caricamento dati...`);
  const unknown = await ensureCards([...parsed.main, ...parsed.extra, ...parsed.side]);
  if (!dmCtx) return;
  renderDeckEditor();
  dmMsg(unknown.length
    ? `Importate ${total} carte (${unknown.length} id non riconosciuti).`
    : `Importate ${total} carte ✓`, unknown.length ? 'err' : 'ok');
}

async function importDeckFromFile(input) {
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try { await importDeckFromText(await f.text()); }
  catch(e) { dmMsg('Impossibile leggere il file.', 'err'); }
}

function safeFileName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'deck'; }

function exportYdkFile() {
  const l = getDeckList(false);
  const blob = new Blob([toYdk(l)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeFileName(dmCtx.name) + '.ydk';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  dmMsg('File .ydk scaricato — in Dueling Nexus: Deck Editor → Import.', 'ok');
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    dmMsg(okMsg, 'ok');
  } catch(e) {
    prompt('Copia manualmente:', text);
  }
}

function copyYdkText() { copyText(toYdk(getDeckList(false)), 'Testo .ydk copiato ✓'); }
function copyYdke()    { copyText(toYdke(getDeckList(false)), 'Link YDKE copiato ✓'); }

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
console.log('[YGO] Inizializzazione tracker...');
loadLocal();

if (cfg.apiKey && cfg.binId) {
  console.log('[YGO] Account trovato in localStorage, connessione automatica...');
  document.getElementById('apikey-input').value = cfg.apiKey;
  document.getElementById('binid-input').value  = cfg.binId;
  onConnected();
  syncDown();
} else {
  console.log('[YGO] Nessun account configurato, modalità locale');
  setSync('', 'solo locale');
}

renderPlayers();
updateSelects();
renderMatches();
renderDuel();
// Init stats tab with matchups visible
currentTab = 'stats';
console.log('[YGO] Tracker pronto');
