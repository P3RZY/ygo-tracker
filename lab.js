// ─────────────────────────────────────────────
// LABORATORIO — verifica delle interazioni tra carte
//
// Regole ed effetti sono applicati dal motore di EDOPro:
//   • ygopro-core (AGPLv3, Project Ignis / edo9300), compilato in WebAssembly
//     da ocgcore-wasm (MIT, n1xx1)
//   • script degli effetti: ProjectIgnis/CardScripts (AGPLv3)
//   • testi di sistema in italiano e nomi degli archetipi: ProjectIgnis/Distribution (AGPLv3)
// I dati delle carte arrivano da YGOPRODeck e sono convertiti nel formato del motore:
// il database di EDOPro (BabelCDB) non dichiara una licenza, quindi non viene usato.
// Tutto viene scaricato dai CDN quando serve: nulla di tutto ciò è copiato nel repository.
// ─────────────────────────────────────────────
const LAB_CORE_URL   = 'https://cdn.jsdelivr.net/npm/ocgcore-wasm@0.1.2/dist/index.js';
const LAB_SCRIPT_CDN = ['https://cdn.jsdelivr.net/gh/ProjectIgnis/CardScripts@master/',
                        'https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/'];
const LAB_DIST_CDN   = 'https://cdn.jsdelivr.net/gh/ProjectIgnis/Distribution@master/config/';
const LAB_SETUP_KEY  = 'ygo_lab_setup_v1';
const LAB_LIB_SCRIPTS = ['constant.lua', 'card_counter_constants.lua', 'archetype_setcode_constants.lua', 'utility.lua',
  'debug_utility.lua', 'chain.lua', 'cards_specific_functions.lua', 'proc_fusion.lua', 'proc_fusion_spell.lua',
  'proc_ritual.lua', 'proc_synchro.lua', 'proc_union.lua', 'proc_xyz.lua', 'proc_pendulum.lua', 'proc_link.lua',
  'proc_equip.lua', 'proc_persistent.lua', 'proc_workaround.lua', 'proc_normal.lua', 'proc_skill.lua', 'proc_rush.lua',
  'proc_maximum.lua', 'proc_gemini.lua', 'proc_spirit.lua', 'proc_unofficial.lua', 'deprecated_functions.lua'];

const LAB_SIDES = ['Tu', 'Avversario'];
const LAB_SETUP_ZONES = [
  { k: 'hand',    label: 'Mano' },
  { k: 'mzone',   label: 'Zona Mostri', max: 5 },
  { k: 'szone',   label: 'Magie / Trappole', max: 5 },
  { k: 'fzone',   label: 'Zona Terreno', max: 1 },
  { k: 'grave',   label: 'Cimitero' },
  { k: 'removed', label: 'Banditi' },
  { k: 'deck',    label: 'Deck (1ª in cima)' },
  { k: 'extra',   label: 'Extra Deck' },
];
const LAB_POS_CYCLE = { mzone: ['atk', 'def', 'set'], szone: ['up', 'set'], fzone: ['up', 'set'] };
const LAB_POS_LABEL = { atk: 'ATT', def: 'DIF', set: 'coperta', up: 'scoperta' };
const LAB_LOC_CODE  = { deck: 1, hand: 2, mzone: 4, szone: 8, grave: 16, removed: 32, extra: 64, fzone: 8 };
const LAB_LOC_NAME  = { 1: 'Deck', 2: 'Mano', 4: 'Zona Mostri', 8: 'Zona Magie/Trappole', 16: 'Cimitero', 32: 'Banditi', 64: 'Extra Deck', 128: 'materiale Xyz' };
const LAB_PHASE     = { 1: 'Draw Phase', 2: 'Standby Phase', 4: 'Main Phase 1', 8: 'Battle Phase', 16: 'Battle Step',
                        32: 'Damage Step', 64: 'Calcolo danni', 128: 'Fine Battle Phase', 256: 'Main Phase 2', 512: 'End Phase' };
const LAB_SELECT_TYPES = new Set([10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 132, 140, 141, 142, 143]);
const LAB_EXAMPLE = {
  first: 0, lp: [8000, 8000],
  sides: [
    { hand: [{ code: 55144522, name: "Pot of Greed" }], mzone: [], szone: [], fzone: [], grave: [], removed: [],
      deck: [{ code: 89631139, name: "Blue-Eyes White Dragon" }, { code: 46986414, name: "Dark Magician" }, { code: 40640057, name: "Kuriboh" }], extra: [] },
    { hand: [{ code: 14558127, name: "Ash Blossom & Joyous Spring" }], mzone: [], szone: [], fzone: [], grave: [], removed: [],
      deck: [{ code: 40640057, name: "Kuriboh" }, { code: 40640057, name: "Kuriboh" }], extra: [] },
  ]
};

let labSetup = labLoadSetup();
let labE = null;               // motore pronto: { ocg, core, sys, setnames }
let labInitPromise = null;
const labInfo    = new Map();  // codice → carta YGOPRODeck (dati inglesi, + .it con nome/testo italiani)
const labData    = new Map();  // codice → dati nel formato del motore (null = sconosciuta)
const labScripts = new Map();  // nome file → sorgente Lua (null = inesistente)
let labDuel = null;            // duello in corso (vedi labStart)
let labSel  = [];              // selezione multipla in corso
let labPickerCtx = null;       // { side, zone } oppure { announce: msg }
let labPickerSeq = 0, labPickerTimer = null;
let labBusy = '';              // messaggio di caricamento
let labPromptMin = false;      // finestra delle scelte ridotta (per guardare il campo)

// ── Setup (salvato sul dispositivo) ──────────────────────────────────────────
function labEmptySide() { return { hand: [], mzone: [], szone: [], fzone: [], grave: [], removed: [], deck: [], extra: [] }; }

function labLoadSetup() {
  try {
    const s = JSON.parse(localStorage.getItem(LAB_SETUP_KEY));
    if (s?.sides?.length === 2) return s;
  } catch(e) {}
  return { first: 0, lp: [8000, 8000], sides: [labEmptySide(), labEmptySide()], decks: [null, null] };
}

function labSaveSetup() {
  try { localStorage.setItem(LAB_SETUP_KEY, JSON.stringify(labSetup)); } catch(e) {}
}

// ── Rete ─────────────────────────────────────────────────────────────────────
async function labFetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.text();
}

// Il motore chiede script e dati in modo sincrono: quello che non è stato
// precaricato viene scaricato con una richiesta sincrona (capita di rado, es. token).
function labSyncGet(url) {
  try {
    const x = new XMLHttpRequest();
    x.open('GET', url, false);
    x.send();
    return x.status === 200 ? x.responseText : null;
  } catch(e) { return null; }
}

function labScriptPath(name) { return /^c\d+\.lua$/.test(name) ? 'official/' + name : name; }

async function labFetchScript(name) {
  if (labScripts.has(name)) return;
  for (const base of LAB_SCRIPT_CDN) {
    try {
      const r = await fetch(base + labScriptPath(name));
      if (r.ok) { labScripts.set(name, await r.text()); return; }
      if (r.status === 404) break;
    } catch(e) { /* prova il CDN successivo */ }
  }
  labScripts.set(name, null);
}

function labScriptReader(name) {
  if (!labScripts.has(name)) {
    let s = null;
    for (const base of LAB_SCRIPT_CDN) { s = labSyncGet(base + labScriptPath(name)); if (s != null) break; }
    labScripts.set(name, s);
  }
  return labScripts.get(name);
}

// ── Avvio del motore (una volta sola) ────────────────────────────────────────
function labParseStrings(txt, sys, setnames) {
  txt.split(/\r?\n/).forEach(line => {
    let m = line.match(/^!system (\d+) (.*)$/);
    if (m) { sys.set(+m[1], m[2].trim()); return; }
    if (setnames && (m = line.match(/^!setname (0x[0-9a-fA-F]+) ([^\t]+)/))) {
      const key = normName(m[2]);
      if (key) setnames.push({ re: new RegExp('(^| )' + key + '( |$)'), code: parseInt(m[1], 16) });
    }
  });
}

function labInit() {
  if (labE) return Promise.resolve(labE);
  if (!labInitPromise) {
    labInitPromise = (async () => {
      const [ocg, en, it] = await Promise.all([
        import(LAB_CORE_URL),
        labFetchText(LAB_DIST_CDN + 'strings.conf'),
        labFetchText(LAB_DIST_CDN + 'languages/Italiano/strings.conf').catch(() => ''),
        ...LAB_LIB_SCRIPTS.map(labFetchScript)
      ]);
      const core = await ocg.default({ sync: true });
      const sys = new Map(), setnames = [];
      labParseStrings(en, sys, setnames);
      labParseStrings(it, sys, null);          // l'italiano sostituisce l'inglese dove presente
      labScripts.set('c0.lua', null);
      labE = { ocg, core, sys, setnames };
      console.log('[YGO] Laboratorio: motore EDOPro pronto, versione', core.getVersion().join('.'));
      return labE;
    })().catch(e => { labInitPromise = null; throw e; });
  }
  return labInitPromise;
}

// ── Dati carta: YGOPRODeck → formato del motore ──────────────────────────────
const LAB_RACE = { 'warrior': 1n, 'spellcaster': 2n, 'fairy': 4n, 'fiend': 8n, 'zombie': 16n, 'machine': 32n, 'aqua': 64n,
  'pyro': 128n, 'rock': 256n, 'winged beast': 512n, 'plant': 1024n, 'insect': 2048n, 'thunder': 4096n, 'dragon': 8192n,
  'beast': 16384n, 'beast-warrior': 32768n, 'dinosaur': 65536n, 'fish': 131072n, 'sea serpent': 262144n, 'reptile': 524288n,
  'psychic': 1048576n, 'divine-beast': 2097152n, 'creator god': 4194304n, 'wyrm': 8388608n, 'cyberse': 16777216n,
  'illusion': 33554432n };
const LAB_ATTR = { EARTH: 1, WATER: 2, FIRE: 4, WIND: 8, LIGHT: 16, DARK: 32, DIVINE: 64 };
const LAB_MARKER = { 'Bottom-Left': 1, 'Bottom': 2, 'Bottom-Right': 4, 'Left': 8, 'Right': 32, 'Top-Left': 64, 'Top': 128, 'Top-Right': 256 };

/**
 * Archetipi: un nome di archetipo fa parte del nome della carta (o del testo
 * "è sempre considerata una carta …"). I sotto-archetipi condividono i 12 bit bassi
 * del codice e si combinano con OR, come nel database di EDOPro.
 */
function labSetcodes(c) {
  const names = [normName(c.name)];
  for (const m of (c.desc || '').matchAll(/always treated as (?:an? )?"([^"]+)"/gi)) names.push(normName(m[1]));
  const byBase = new Map();
  for (const s of labE.setnames) {
    if (names.some(n => s.re.test(n))) byBase.set(s.code & 0xfff, (byBase.get(s.code & 0xfff) || 0) | s.code);
  }
  return [...byBase.values()];
}

function labToCardData(c, code) {
  const T = labE.ocg.OcgType;
  const SUB = { Normal: T.NORMAL, Effect: T.EFFECT, Fusion: T.FUSION, Ritual: T.RITUAL, Spirit: T.SPIRIT, Union: T.UNION,
    Gemini: T.GEMINI, Tuner: T.TUNER, Synchro: T.SYNCHRO, Flip: T.FLIP, Toon: T.TOON, Xyz: T.XYZ, XYZ: T.XYZ,
    Pendulum: T.PENDULUM, Link: T.LINK };
  const SPT = { 'Quick-Play': T.QUICKPLAY, Continuous: T.CONTINUOUS, Equip: T.EQUIP, Field: T.FIELD, Ritual: T.RITUAL, Counter: T.COUNTER };
  let type, race = 0n, attribute = 0, level = 0, lscale = 0, rscale = 0, link_marker = 0;
  if (/spell/i.test(c.type))      type = T.SPELL | (SPT[c.race] || 0);
  else if (/trap/i.test(c.type))  type = T.TRAP | (SPT[c.race] || 0);
  else {
    type = T.MONSTER;
    if (c.type === 'Token') type |= T.TOKEN;
    (c.typeline || []).forEach(t => { if (SUB[t]) type |= SUB[t]; });
    if (!(type & (T.NORMAL | T.EFFECT | T.TOKEN)) && /normal/.test(c.frameType || '')) type |= T.NORMAL;
    if (/Cannot be Normal Summoned\/Set/i.test(c.desc || '')) type |= T.SPSUMMON;
    race = LAB_RACE[(c.race || '').toLowerCase()] || 0n;
    attribute = LAB_ATTR[c.attribute] || 0;
    level = (type & T.LINK) ? (c.linkval || 0) : (c.level || 0);
    if (c.scale != null) lscale = rscale = c.scale;
    (c.linkmarkers || []).forEach(m => { link_marker |= LAB_MARKER[m] || 0; });
  }
  return { code, alias: code !== c.id ? c.id : 0, setcodes: labSetcodes(c), type, level, attribute, race,
           attack: c.atk ?? 0, defense: (type & T.LINK) ? 0 : (c.def ?? 0), lscale, rscale, link_marker };
}

function labStoreApiCard(c) {
  const prev = labInfo.get(c.id);
  if (prev?.it) c.it = prev.it;
  labInfo.set(c.id, c);
  (c.card_images || []).forEach(im => { if (im.id !== c.id && !labInfo.has(im.id)) labInfo.set(im.id, c); });
}

/** Scarica (EN + IT) i dati delle carte non ancora note. */
async function labEnsureCards(codes) {
  const missing = [...new Set(codes.map(Number))].filter(c => c && !labInfo.has(c));
  const fetchChunk = async ids => {
    const [en, it] = await Promise.all([
      apiCards({ id: ids.join(',') }).catch(() => []),
      apiCards({ id: ids.join(','), language: 'it' }).catch(() => [])
    ]);
    en.forEach(labStoreApiCard);
    it.forEach(c => { const e = labInfo.get(c.id); if (e) e.it = { name: c.name, desc: c.desc }; });
  };
  for (let i = 0; i < missing.length; i += 40) await fetchChunk(missing.slice(i, i + 40));
  // Se un id non valido fa fallire la richiesta multipla, riprovo uno per uno
  const still = missing.filter(c => !labInfo.has(c));
  await Promise.all(still.slice(0, 60).map(id => fetchChunk([id])));
}

function labCardData(code) {
  if (!code) return null;
  if (labData.has(code)) return labData.get(code);
  if (!labInfo.has(code)) {
    try { (JSON.parse(labSyncGet(`${YGOPRO_API}?id=${code}`) || '{}').data || []).forEach(labStoreApiCard); } catch(e) {}
  }
  const c = labInfo.get(code);
  const d = c ? labToCardData(c, code) : null;
  labData.set(code, d);
  return d;
}

function labName(code) {
  const c = labInfo.get(code);
  return c ? c.name : (cardCache[code]?.n || `#${code}`);
}

// ── Testi di sistema e descrizioni degli effetti ─────────────────────────────
function labSys(id, ...args) {
  let s = labE?.sys.get(id) || '';
  args.forEach(a => { s = s.replace(/%ls|%d/, a); });
  return s;
}

/**
 * Le descrizioni sono (codice carta << 20) | indice della stringa. I testi specifici
 * delle carte stanno solo nel database di EDOPro, che non usiamo: mostriamo
 * "opzione N" e il testo completo della carta resta consultabile.
 */
const LAB_MIN_CARD_DESC = 1000n << 20n;   // sotto questa soglia è un testo di sistema (come nel client EDOPro)

function labDesc(desc) {
  const d = BigInt(desc || 0);
  if (d < LAB_MIN_CARD_DESC) return labSys(Number(d));
  return `${labName(Number(d >> 20n))}: effetto/opzione ${Number(d & 0xfffffn) + 1}`;
}

function labEffectSuffix(desc, code) {
  const d = BigInt(desc || 0);
  if (d < LAB_MIN_CARD_DESC) { const s = d ? labSys(Number(d)) : ''; return s ? ` (${s})` : ''; }
  const dcode = Number(d >> 20n), idx = Number(d & 0xfffffn);
  if (dcode !== code) return ` (effetto concesso da ${labName(dcode)})`;
  return idx ? ` (effetto ${idx + 1})` : '';
}

// ── Duello ───────────────────────────────────────────────────────────────────
function labWho(p) { return LAB_SIDES[p ^ labDuel.first]; }
function labLoc(lp) {
  if (!lp) return '';
  if (lp.location === 8 && lp.sequence === 5) return 'Zona Terreno';
  if (lp.location & 128) return 'materiale Xyz';
  if (lp.location === 4 && lp.sequence >= 5) return 'Zona Mostri Extra';
  return LAB_LOC_NAME[lp.location] || 'fuori dal gioco';
}
function labCodeAt(lp) {
  try {
    const q = labE.core.duelQuery(labDuel.h, { flags: labE.ocg.OcgQueryFlags.CODE, controller: lp.controller,
      location: lp.location, sequence: lp.sequence, overlaySequence: lp.overlay_sequence || 0 });
    return q?.code || 0;
  } catch(e) { return 0; }
}

function labLog(text, cls = '') { labDuel.log.push({ text, cls }); }

function labPos(k, pos) {
  const P = labE.ocg.OcgPosition;
  if (k === 'mzone') return pos === 'def' ? P.FACEUP_DEFENSE : pos === 'set' ? P.FACEDOWN_DEFENSE : P.FACEUP_ATTACK;
  if (k === 'szone' || k === 'fzone') return pos === 'set' ? P.FACEDOWN_DEFENSE : P.FACEUP_ATTACK;
  if (k === 'deck' || k === 'extra') return P.FACEDOWN_DEFENSE;
  return P.FACEUP_ATTACK;
}

/** Crea il duello dal setup. Nel motore gioca per primo il giocatore 0: se inizia l'avversario i lati vengono scambiati. */
function labCreate(d) {
  const { ocg, core } = labE;
  const M = ocg.OcgDuelMode;
  const team = s => ({ startingLP: labSetup.lp[s] || 8000, startingDrawCount: 0,
                       drawCountPerTurn: labSetup.sides[s].deck.length ? 1 : 0 });
  const h = core.createDuel({
    flags: M.MODE_MR5 | M.ATTACK_FIRST_TURN,
    seed: d.seed,
    team1: team(0 ^ d.first), team2: team(1 ^ d.first),
    cardReader: labCardData,
    scriptReader: labScriptReader,
    errorHandler: (t, s) => { console.warn('[YGO] Motore:', s); labDuel?.log.push({ text: 'Motore: ' + s, cls: 'warn' }); }
  });
  if (!h) throw new Error('Impossibile creare il duello');
  core.loadScript(h, 'constant.lua', labScriptReader('constant.lua'));
  core.loadScript(h, 'utility.lua', labScriptReader('utility.lua'));

  labSetup.sides.forEach((side, s) => {
    const t = s ^ d.first;
    LAB_SETUP_ZONES.forEach(({ k }) => {
      // Deck: ogni carta aggiunta va in cima, quindi le inserisco al contrario (la prima della lista resta in cima)
      const list = k === 'deck' ? [...side[k]].reverse() : side[k];
      list.forEach((e, i) => core.duelNewCard(h, {
        team: t, duelist: 0, code: Number(e.code), controller: t, location: LAB_LOC_CODE[k],
        sequence: k === 'fzone' ? 5 : (k === 'mzone' || k === 'szone') ? i : 0,
        position: labPos(k, e.pos)
      }));
    });
  });
  core.startDuel(h);
  return h;
}

/** Avvia (o ricostruisce, rigiocando le risposte date) il duello. */
function labStart(seed, replay = []) {
  if (labDuel?.h) { try { labE.core.destroyDuel(labDuel.h); } catch(e) {} }
  labDuel = {
    h: null, seed, first: labSetup.first, responses: [], queue: replay.slice(),
    log: [], pending: null, lastPrompt: null, hint: null, chain: [],
    turn: 0, phase: 0, turnPlayer: 0, lp: [0, 0], winner: null, ended: false
  };
  labDuel.lp[0 ^ labDuel.first] = labSetup.lp[0] || 8000;
  labDuel.lp[1 ^ labDuel.first] = labSetup.lp[1] || 8000;
  labSel = [];
  labDuel.h = labCreate(labDuel);
  labProcess();
}

function labProcess() {
  const { ocg, core } = labE;
  const RES = ocg.OcgProcessResult;
  const d = labDuel;
  for (let guard = 0; guard < 10000; guard++) {
    const st = core.duelProcess(d.h);
    let prompt = null;
    for (const m of core.duelGetMessage(d.h)) {
      if (LAB_SELECT_TYPES.has(m.type)) prompt = m;
      else labOnMessage(m);
    }
    if (d.retry) {                       // risposta rifiutata: si ripropone la stessa richiesta
      d.retry = false;
      d.responses.pop();
      prompt = prompt || d.lastPrompt;
      if (!d.queue.length) toast('Il motore ha rifiutato la scelta: riprova.');
    }
    if (st === RES.END) { d.pending = null; d.ended = true; break; }
    if (st !== RES.WAITING) continue;
    if (!prompt) { d.pending = null; break; }
    d.pending = prompt;
    const next = d.queue.length ? d.queue.shift() : null;
    if (next) { labSend(next.resp, next.manual); continue; }
    const auto = labAutoResponse(prompt);
    if (auto) { labSend(auto, false); continue; }
    break;
  }
}

function labSend(resp, manual) {
  const d = labDuel;
  d.responses.push({ resp, manual });
  d.lastPrompt = d.pending;
  d.pending = null;
  d.hint = null;
  labSel = [];
  labE.core.duelSetResponse(d.h, resp);
}

/** Risposta dell'utente a una richiesta del motore. */
function labRespond(resp) {
  labPromptMin = false;
  labSend(resp, true);
  try { labProcess(); } catch(e) { labFail(e); return; }
  labRender();
  const log = document.getElementById('lab-log');
  if (log) log.scrollTop = log.scrollHeight;
}

/** Richieste che non richiedono una vera scelta: risposte automatiche. */
function labAutoResponse(m) {
  const { ocg } = labE;
  const MT = ocg.OcgMessageType, R = ocg.OcgResponseType;
  switch (m.type) {
    case MT.SELECT_CHAIN:
      if (m.forced) return null;
      if (!m.selects.length) return { type: R.SELECT_CHAIN, index: null };
      // Finestre "vuote" di Draw e Standby Phase (nessuna azione né catena aperta): saltate, salvo richiesta esplicita.
      // Nelle altre fasi si chiede sempre: è lì che l'avversario risponde ai cambi di fase.
      if (!labSetup.askPhases && labDuel.phase <= 2 && !labDuel.chain.length && !labDuel.acted) return { type: R.SELECT_CHAIN, index: null };
      return null;
    case MT.SELECT_POSITION: {
      const opts = [1, 2, 4, 8].filter(p => m.positions & p);
      return opts.length === 1 ? { type: R.SELECT_POSITION, position: opts[0] } : null;
    }
    case MT.SORT_CHAIN:
    case MT.SORT_CARD:
      labLog('Ordine delle carte: predefinito del motore', 'info');
      return { type: R.SORT_CARD, order: null };
    case MT.ROCK_PAPER_SCISSORS:
      return { type: R.ROCK_PAPER_SCISSORS, value: 1 + Math.floor(Math.random() * 3) };
    case MT.SELECT_COUNTER: {
      let left = m.count;
      const counters = m.cards.map(c => { const n = Math.min(c.count, left); left -= n; return n; });
      labLog(`Segnalini rimossi automaticamente (${m.count})`, 'info');
      return { type: R.SELECT_COUNTER, counters };
    }
  }
  return null;
}

// ── Messaggi del motore → registro in italiano ───────────────────────────────
function labOnMessage(m) {
  const MT = labE.ocg.OcgMessageType;
  const d = labDuel, who = labWho, name = labName;
  if ([MT.SUMMONING, MT.SPSUMMONING, MT.FLIPSUMMONING, MT.SET, MT.MOVE, MT.CHAINING, MT.CHAIN_END, MT.ATTACK,
       MT.DAMAGE, MT.RECOVER, MT.PAY_LPCOST, MT.POS_CHANGE, MT.BECOME_TARGET].includes(m.type)) d.acted = true;
  switch (m.type) {
    case MT.RETRY: d.retry = true; break;
    case MT.HINT:
      if (m.hint_type === labE.ocg.OcgHintType.SELECTMSG) d.hint = { player: m.player, hint: m.hint };
      break;
    case MT.NEW_TURN:
      d.turn++; d.turnPlayer = m.player;
      labLog(`Turno ${d.turn} — ${who(m.player)}`, 'turn');
      break;
    case MT.NEW_PHASE: d.phase = m.phase; d.acted = false; labLog(LAB_PHASE[m.phase] || 'Nuova fase', 'phase'); break;
    case MT.SUMMONING:   labLog(`${who(m.controller)} evoca normalmente ${name(m.code)}`); break;
    case MT.SPSUMMONING: labLog(`${who(m.controller)} evoca tramite Evocazione Speciale ${name(m.code)}`); break;
    case MT.FLIPSUMMONING: labLog(`${who(m.controller)} evoca per scoperta ${name(m.code)}`); break;
    case MT.SET: labLog(`${who(m.controller)} posiziona ${name(m.code)}`); break;
    case MT.POS_CHANGE: {
      const P = labE.ocg.OcgPosition;
      const flip = (m.prev_position & P.FACEDOWN) && (m.position & P.FACEUP);
      labLog(flip ? `${name(m.code)} viene scoperta` : `${name(m.code)} passa in ${m.position & P.DEFENSE ? "Posizione di Difesa" : "Posizione di Attacco"}`);
      break;
    }
    case MT.CHAINING:
      d.chain[m.chain_size - 1] = m.code;
      labLog(`Catena ${m.chain_size}: ${who(m.controller)} attiva ${name(m.code)}${labEffectSuffix(m.description, m.code)}`, 'chain');
      break;
    case MT.CHAIN_SOLVING:  labLog(`Risolve l'anello ${m.chain_size}: ${name(d.chain[m.chain_size - 1])}`, 'solve'); break;
    case MT.CHAIN_NEGATED:  labLog(`Anello ${m.chain_size}: attivazione negata`, 'neg'); break;
    case MT.CHAIN_DISABLED: labLog(`Anello ${m.chain_size}: effetto negato`, 'neg'); break;
    case MT.CHAIN_END: d.chain = []; labLog('Fine della catena', 'solve'); break;
    case MT.MOVE: {
      const { from, to } = m;
      if (!from.location && to.location) { labLog(`Viene creato ${name(m.card)} (${labLoc(to)})`); break; }
      if (from.location && !to.location) { labLog(`${name(m.card)} lascia il gioco`); break; }
      if (from.location === to.location && from.controller === to.controller) break;
      const ctrl = from.controller !== to.controller ? ` (ora di ${who(to.controller)})` : '';
      labLog(`${name(m.card)}: ${labLoc(from)} → ${labLoc(to)}${ctrl}`, 'move');
      break;
    }
    case MT.DRAW: labLog(`${who(m.player)} pesca ${m.drawn.map(x => name(x.code)).join(', ')}`); break;
    case MT.DAMAGE:
      d.lp[m.player] -= m.amount;
      labLog(`${who(m.player)} subisce ${m.amount} danni (LP ${Math.max(0, d.lp[m.player])})`, 'dmg');
      break;
    case MT.RECOVER:
      d.lp[m.player] += m.amount;
      labLog(`${who(m.player)} guadagna ${m.amount} LP (LP ${d.lp[m.player]})`, 'heal');
      break;
    case MT.PAY_LPCOST:
      d.lp[m.player] -= m.amount;
      labLog(`${who(m.player)} paga ${m.amount} LP`, 'dmg');
      break;
    case MT.LPUPDATE: d.lp[m.player] = m.lp; break;
    case MT.ATTACK:
      labLog(`${name(labCodeAt(m.card))} attacca ${m.target ? name(labCodeAt(m.target)) : 'direttamente'}`, 'battle');
      break;
    case MT.ATTACK_DISABLED: labLog('Attacco annullato', 'neg'); break;
    case MT.BECOME_TARGET: labLog(`Bersaglio: ${m.cards.map(c => name(labCodeAt(c))).join(', ')}`); break;
    case MT.MISSED_EFFECT:
      labLog(`${name(m.code)}: l'effetto non si attiva (ha "mancato il tempismo")`, 'warn');
      break;
    case MT.CONFIRM_CARDS: labLog(`${who(m.player)} mostra: ${m.cards.map(c => name(c.code)).join(', ')}`); break;
    case MT.TOSS_COIN: labLog(`Lancio della moneta: ${m.results.map(r => r ? 'Testa' : 'Croce').join(', ')}`); break;
    case MT.TOSS_DICE: labLog(`Lancio del dado: ${m.results.join(', ')}`); break;
    case MT.WIN:
      d.winner = m.player;
      labLog(m.player > 1 ? 'Il duello termina in pareggio' : `Vince ${who(m.player)}`, 'win');
      break;
  }
}

// ── Stato del campo ──────────────────────────────────────────────────────────
function labField() {
  const { ocg, core } = labE, L = ocg.OcgLocation, Q = ocg.OcgQueryFlags;
  // Niente Q.TYPE: in ocgcore-wasm 0.1.2 la sua lettura fallisce ("eof"); il tipo si ricava dai dati della carta
  const flags = Q.CODE | Q.POSITION | Q.ATTACK | Q.DEFENSE | Q.OVERLAY_CARD;
  const q = (p, location) => core.duelQueryLocation(labDuel.h, { flags, controller: p, location });
  return [0, 1].map(p => ({
    mzone: q(p, L.MZONE), szone: q(p, L.SZONE), hand: q(p, L.HAND).filter(Boolean),
    grave: q(p, L.GRAVE).filter(Boolean), removed: q(p, L.REMOVED).filter(Boolean),
    extra: q(p, L.EXTRA).filter(Boolean), deck: q(p, L.DECK).filter(Boolean)
  }));
}

// ── Interfaccia: pagina ──────────────────────────────────────────────────────
function labOnShow() {
  labRender();
  // Precarico il motore in background: all'avvio della prova sarà già pronto
  labInit().catch(e => console.warn('[YGO] Precaricamento motore:', e));
}

function labFail(e) {
  console.error('[YGO] Laboratorio:', e);
  labBusy = '';
  toast('Errore del Laboratorio: ' + (e.message || e));
  labRender();
}

function labRender() {
  const c = document.getElementById('lab-content');
  if (!c) return;
  if (labBusy) { c.innerHTML = `<div class="lab-busy"><div class="lab-spinner"></div>${escH(labBusy)}</div>`; return; }
  c.innerHTML = labDuel ? labPlayHtml() : labSetupHtml();
  if (!labDuel) labLoadSetupNames();
}

// I nomi delle carte importate da un mazzo possono non essere ancora noti: li scarico una volta
const labNamesTried = new Set();
function labLoadSetupNames() {
  const missing = labSetup.sides.flatMap(sd => LAB_SETUP_ZONES.flatMap(z => sd[z.k]))
    .map(e => Number(e.code)).filter(c => !labInfo.has(c) && !cardCache[c] && !labNamesTried.has(c));
  if (!missing.length) return;
  missing.forEach(c => labNamesTried.add(c));
  labEnsureCards(missing).then(() => { if (!labDuel) labRender(); }).catch(() => {});
}

function labCardImg(code) { return CARD_IMG(code); }

// ── Setup ────────────────────────────────────────────────────────────────────
// ── Mazzo di riferimento per ciascun lato ────────────────────────────────────
// labSetup.decks[s] = { pi, name }: all'inizio tutte le carte del mazzo stanno in Deck ed Extra Deck;
// le carte prese dal mazzo si spostano (non si duplicano). Le carte aggiunte dalla ricerca che
// non fanno parte del mazzo sono ammesse, ma vengono segnalate con un banner.
function labDeckRef(s) { return labSetup.decks?.[s] || null; }

function labDeckListOf(s) {
  const ref = labDeckRef(s);
  if (!ref) return null;
  return state.deckLists[deckKey(ref.pi, ref.name)] || null;
}

/** Stesso id per gli artwork alternativi, così non risultano "fuori mazzo". */
function labBaseId(code) { const i = labInfo.get(Number(code)); return i ? i.id : Number(code); }

/** Carte del lato s che eccedono il mazzo scelto (lista di codici, con ripetizioni). */
function labOutsideCards(s) {
  const l = labDeckListOf(s);
  if (!l) return [];
  const allowed = new Map();
  [...l.main, ...l.extra, ...l.side].forEach(c => { const k = labBaseId(c); allowed.set(k, (allowed.get(k) || 0) + 1); });
  const out = [];
  LAB_SETUP_ZONES.forEach(z => labSetup.sides[s][z.k].forEach(e => {
    const k = labBaseId(e.code), n = allowed.get(k) || 0;
    if (n > 0) allowed.set(k, n - 1); else out.push(Number(e.code));
  }));
  return out;
}

function labOutsideBannerHtml() {
  const parts = [0, 1].map(s => {
    const out = labOutsideCards(s);
    if (!out.length) return '';
    const counts = new Map();
    out.forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
    const names = [...counts].map(([c, n]) => `${escH(labName(c))}${n > 1 ? ' ×' + n : ''}`).join(', ');
    return `<div><b>${LAB_SIDES[s]}</b> (mazzo «${escH(labDeckRef(s).name)}»): ${names}</div>`;
  }).filter(Boolean);
  if (!parts.length) return '';
  return `<div class="lab-banner"><div class="lab-banner-title">⚠ Carte non presenti nel mazzo</div>${parts.join('')}</div>`;
}

function labSetupHtml() {
  const deckOpts = s => {
    const ref = labDeckRef(s);
    return state.players.flatMap((p, pi) => p.decks.map(dk => {
      const l = state.deckLists[deckKey(pi, dk)];
      const n = l ? l.main.length + l.extra.length : 0;
      const sel = ref && ref.pi === pi && ref.name === dk ? ' selected' : '';
      return `<option value="${pi}:${escH(dk)}"${sel}${n ? '' : ' disabled'}>${escH(p.name)} — ${escH(dk)}${n ? ` (${l.main.length}+${l.extra.length})` : ' (lista vuota)'}</option>`;
    })).join('');
  };

  const sideHtml = s => {
    const ref = labDeckRef(s);
    return `
    <div class="lab-setup-side ${s ? 'opp' : 'me'}">
      <div class="lab-setup-head">
        <span class="lab-side-name">${LAB_SIDES[s]}</span>
        <label class="lab-lp-input">LP <input type="number" min="1" step="100" value="${labSetup.lp[s]}" onchange="labSetLp(${s}, this.value)"/></label>
      </div>
      <select class="lab-deck-sel" onchange="labSelectDeck(${s}, this.value)">
        <option value=""${ref ? '' : ' selected'}>Nessun mazzo: carte scelte liberamente</option>
        ${deckOpts(s)}
      </select>
      ${ref ? `<p class="lab-deck-note">Tutte le carte di «${escH(ref.name)}» partono da Deck ed Extra Deck: con <b>+ carta</b> puoi prenderle da lì e metterle in mano o sul campo.</p>` : ''}
      ${LAB_SETUP_ZONES.map(z => {
        const list = labSetup.sides[s][z.k];
        const full = z.max && list.length >= z.max;
        return `<div class="lab-setup-zone">
          <div class="lab-zone-label">${z.label}${list.length ? ` <span>${list.length}${z.max ? '/' + z.max : ''}</span>` : ''}</div>
          <div class="lab-chips">
            ${list.map((e, i) => `
              <span class="lab-chip">
                <img src="${labCardImg(e.code)}" alt="" loading="lazy" onclick="labShowCard(${e.code})"/>
                <span class="lab-chip-name" onclick="labShowCard(${e.code})">${escH(e.name || labName(e.code))}</span>
                ${LAB_POS_CYCLE[z.k] ? `<button class="lab-pos" onclick="labCyclePos(${s},'${z.k}',${i})" title="Cambia posizione">${LAB_POS_LABEL[e.pos || LAB_POS_CYCLE[z.k][0]]}</button>` : ''}
                <button class="lab-x" onclick="labRemoveCard(${s},'${z.k}',${i})" title="${ref && z.k !== 'deck' && z.k !== 'extra' ? 'Rimetti nel mazzo' : 'Togli'}">×</button>
              </span>`).join('')}
            ${full ? '' : `<button class="lab-add" onclick="labOpenPicker(${s},'${z.k}')">+ carta</button>`}
            ${z.k === 'deck' && list.length > 1 ? `<button class="lab-add" onclick="labShuffleDeck(${s})" title="Mescola il Deck">🔀 Mescola</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  };

  const total = labSetup.sides.reduce((n, sd) => n + LAB_SETUP_ZONES.reduce((m, z) => m + sd[z.k].length, 0), 0);
  return `
    <p class="hint">Prepara una situazione di gioco e poi gioca le mosse per entrambi i giocatori: il motore di EDOPro applica le regole
      e gli effetti ufficiali, e il registro mostra catene, negazioni e risoluzioni passo per passo.</p>
    ${labOutsideBannerHtml()}
    ${sideHtml(1)}
    ${sideHtml(0)}
    <div class="lab-setup-opts">
      <span>Inizia il turno</span>
      <div class="seg">
        <button class="${labSetup.first === 0 ? 'on' : ''}" onclick="labSetFirst(0)">Tu</button>
        <button class="${labSetup.first === 1 ? 'on' : ''}" onclick="labSetFirst(1)">Avversario</button>
      </div>
    </div>
    <button class="btn-start-duel" onclick="labStartFromSetup()" ${total ? '' : 'disabled'}>▶ Avvia la prova</button>
    <div class="lab-setup-foot">
      <button class="btn-cfg-sec" onclick="labLoadExample()">Esempio: Ash Blossom contro Pot of Greed</button>
      ${total ? `<button class="btn-danger" onclick="labClearSetup()">Svuota tutto</button>` : ''}
    </div>
    ${labCreditsHtml()}`;
}

function labCreditsHtml() {
  return `<div class="lab-credits">
    Regole ed effetti: motore <a href="https://github.com/edo9300/ygopro-core" target="_blank" rel="noopener">ygopro-core</a> di EDOPro
    (AGPLv3) tramite <a href="https://github.com/n1xx1/ocgcore-wasm" target="_blank" rel="noopener">ocgcore-wasm</a> (MIT) ·
    script <a href="https://github.com/ProjectIgnis/CardScripts" target="_blank" rel="noopener">Project Ignis CardScripts</a> (AGPLv3) ·
    testi <a href="https://github.com/ProjectIgnis/Distribution" target="_blank" rel="noopener">Project Ignis</a> (AGPLv3) ·
    dati carte <a href="https://ygoprodeck.com" target="_blank" rel="noopener">YGOPRODeck</a>.
    Progetto non ufficiale, non affiliato a Konami né a Project Ignis.
    <a href="https://github.com/P3RZY/ygo-tracker" target="_blank" rel="noopener">Codice sorgente (AGPLv3)</a>.
  </div>`;
}

function labSetLp(s, v) { labSetup.lp[s] = Math.max(1, parseInt(v) || 8000); labSaveSetup(); }
function labSetFirst(s) { labSetup.first = s; labSaveSetup(); labRender(); }

function labCyclePos(s, k, i) {
  const e = labSetup.sides[s][k][i], cyc = LAB_POS_CYCLE[k];
  e.pos = cyc[(cyc.indexOf(e.pos || cyc[0]) + 1) % cyc.length];
  labSaveSetup(); labRender();
}

/** Togliendo una carta presa dal mazzo, torna nel Deck (o nell'Extra Deck). */
function labRemoveCard(s, k, i) {
  const side = labSetup.sides[s];
  const l = labDeckListOf(s);
  const outsideBefore = labOutsideCards(s);
  const [e] = side[k].splice(i, 1);
  if (l && k !== 'deck' && k !== 'extra') {
    const code = Number(e.code);
    const wasOutside = labOutsideCards(s).length < outsideBefore.length;   // era una carta fuori mazzo: si elimina e basta
    if (!wasOutside) {
      const toExtra = l.extra.some(c => labBaseId(c) === labBaseId(code));
      (toExtra ? side.extra : side.deck).push({ code, name: e.name });
    }
  }
  labSaveSetup(); labRender();
}

function labShuffleDeck(s) {
  const d = labSetup.sides[s].deck;
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  labSaveSetup(); labRender();
  toast('Deck mescolato');
}

function labClearSetup() {
  if (!confirm('Svuotare tutta la situazione di gioco?')) return;
  labSetup = { first: labSetup.first, lp: [8000, 8000], sides: [labEmptySide(), labEmptySide()], decks: [null, null], askPhases: labSetup.askPhases, helpSeen: labSetup.helpSeen };
  labSaveSetup(); labRender();
}

function labLoadExample() {
  labSetup = { ...JSON.parse(JSON.stringify(LAB_EXAMPLE)), decks: [null, null], askPhases: labSetup.askPhases, helpSeen: labSetup.helpSeen };
  labSaveSetup(); labRender();
  toast('Esempio caricato: premi "Avvia la prova"');
}

/** Sceglie il mazzo di un lato: tutte le sue carte vanno in Deck ed Extra Deck. */
function labSelectDeck(s, v) {
  const side = labSetup.sides[s];
  const hasCards = LAB_SETUP_ZONES.some(z => side[z.k].length);
  if (!labSetup.decks) labSetup.decks = [null, null];
  if (!v) { labSetup.decks[s] = null; labSaveSetup(); labRender(); return; }
  const sep = v.indexOf(':');
  const pi = Number(v.slice(0, sep)), name = v.slice(sep + 1);
  const l = state.deckLists[deckKey(pi, name)];
  if (!l) return;
  if (hasCards && !confirm(`Le carte di ${LAB_SIDES[s]} verranno sostituite con il mazzo «${name}». Continuare?`)) { labRender(); return; }
  labSetup.sides[s] = labEmptySide();
  labSetup.sides[s].deck  = l.main.map(code => ({ code: Number(code) }));
  labSetup.sides[s].extra = l.extra.map(code => ({ code: Number(code) }));
  labSetup.decks[s] = { pi, name };
  labSaveSetup(); labRender();
  toast(`«${name}»: ${l.main.length} carte nel Deck, ${l.extra.length} nell'Extra Deck`);
}

// ── Scelta carte (setup e "dichiara una carta") ──────────────────────────────
function labOpenPicker(side, zone) {
  labPickerCtx = { side, zone };
  const z = LAB_SETUP_ZONES.find(x => x.k === zone);
  labShowPicker(`Aggiungi a ${LAB_SIDES[side]} · ${z.label}`);
  labRenderPickerDeck();
}

function labShowPicker(title) {
  document.getElementById('lab-picker-title').textContent = title;
  document.getElementById('lab-picker-input').value = '';
  document.getElementById('lab-picker-results').innerHTML = '';
  document.getElementById('lab-picker-deck').innerHTML = '';
  document.getElementById('lab-picker-msg').textContent = '';
  document.getElementById('lab-picker-input').placeholder = '🔍 Cerca carta (italiano o inglese)';
  document.getElementById('lab-picker').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !labDeckRef(labPickerCtx?.side)) document.getElementById('lab-picker-input').focus();
}

/** Nel picker, se c'è un mazzo scelto: prima le carte ancora nel suo Deck / Extra Deck. */
function labRenderPickerDeck() {
  const ctx = labPickerCtx, box = document.getElementById('lab-picker-deck');
  if (!ctx || ctx.announce || !labDeckRef(ctx.side) || ctx.zone === 'deck' || ctx.zone === 'extra') { box.innerHTML = ''; return; }
  const side = labSetup.sides[ctx.side];
  const sources = ctx.zone === 'hand' || ctx.zone === 'szone' || ctx.zone === 'fzone' ? ['deck'] : ['deck', 'extra'];
  const groups = new Map();
  sources.forEach(src => side[src].forEach(e => {
    const key = src + ':' + e.code;
    if (!groups.has(key)) groups.set(key, { code: Number(e.code), src, n: 0, name: e.name });
    groups.get(key).n++;
  }));
  const rows = [...groups.values()].sort((a, b) => (a.src > b.src) - (a.src < b.src) || labName(a.code).localeCompare(labName(b.code)));
  document.getElementById('lab-picker-input').placeholder = '🔍 Cerca un\'altra carta';
  box.innerHTML = `
    <div class="lab-picker-h">Dal mazzo «${escH(labDeckRef(ctx.side).name)}»</div>
    <div class="dm-list lab-picker-decklist">${rows.map(r => cardRowHtml(r.code, r.name || labName(r.code), r.src === 'extra' ? 'Extra Deck' : 'Deck',
      `<span class="card-have">×${r.n}</span><button class="card-btn" tabindex="-1">+</button>`,
      `onclick="labPickFromDeck(${r.code},'${r.src}')" title="Prendi dal mazzo"`)).join('') || '<div class="dm-empty">Nessuna carta rimasta nel mazzo.</div>'}</div>
    <div class="lab-picker-h">Altre carte</div>`;
}

function labAddToZone(ctx, code, name) {
  const list = labSetup.sides[ctx.side][ctx.zone];
  const z = LAB_SETUP_ZONES.find(x => x.k === ctx.zone);
  if (z.max && list.length >= z.max) { document.getElementById('lab-picker-msg').textContent = `${z.label}: al massimo ${z.max} carte.`; return false; }
  list.push({ code, name, ...(LAB_POS_CYCLE[ctx.zone] ? { pos: ctx.zone === "szone" ? "set" : LAB_POS_CYCLE[ctx.zone][0] } : {}) });
  labSaveSetup();
  return true;
}

function labPickFromDeck(code, src) {
  const ctx = labPickerCtx;
  if (!ctx) return;
  const from = labSetup.sides[ctx.side][src];
  const idx = from.findIndex(e => Number(e.code) === code);
  if (idx < 0) return;
  const [e] = from.splice(idx, 1);
  if (!labAddToZone(ctx, code, e.name || labName(code))) { from.splice(idx, 0, e); return; }
  const z = LAB_SETUP_ZONES.find(x => x.k === ctx.zone), n = labSetup.sides[ctx.side][ctx.zone].length;
  const msg = document.getElementById('lab-picker-msg');
  msg.textContent = `+ ${e.name || labName(code)} dal mazzo (${n}${z.max ? '/' + z.max : ''})`;
  msg.className = 'dm-msg ok';
  if (z.max && n >= z.max) labClosePicker(); else labRenderPickerDeck();
}

function labClosePicker() {
  labPickerCtx = null;
  document.getElementById('lab-picker').classList.remove('open');
  document.body.style.overflow = '';
  labRender();
}

function labPickerSearch(q) {
  clearTimeout(labPickerTimer);
  labPickerTimer = setTimeout(() => labPickerRun(q.trim()), 350);
}

async function labPickerRun(q) {
  const box = document.getElementById('lab-picker-results');
  const seq = ++labPickerSeq;
  if (normName(q).length < 3) { box.innerHTML = q ? '<div class="dm-empty">Scrivi almeno 3 lettere…</div>' : ''; return; }
  box.innerHTML = '<div class="dm-empty">Ricerca…</div>';
  try {
    let results = await searchCardsApi(q, () => seq === labPickerSeq);
    if (seq !== labPickerSeq) return;
    if (labPickerCtx?.announce) {
      // Solo le carte che si possono dichiarare in questa richiesta
      await labEnsureCards(results.map(r => r.id));
      if (seq !== labPickerSeq) return;
      results = results.filter(r => { const cd = labCardData(Number(r.id)); return cd && labE.ocg.cardMatchesOpcode(cd, labPickerCtx.announce.opcodes); });
    }
    if (!results.length) { box.innerHTML = `<div class="dm-empty">Nessuna carta trovata${labPickerCtx?.announce ? ' tra quelle dichiarabili' : ''}.</div>`; return; }
    box.innerHTML = results.map(r => cardRowHtml(r.id, r.it && r.it !== r.name ? `${r.name} · ${r.it}` : r.name, r.type || '',
      '<button class="card-btn" tabindex="-1">+</button>', `onclick="labPick(${r.id}, this)" title="Scegli"`)).join('');
  } catch(e) {
    if (seq === labPickerSeq) box.innerHTML = '<div class="dm-empty">Errore di rete durante la ricerca. Riprova.</div>';
  }
}

function labPick(code, el) {
  const ctx = labPickerCtx;
  if (!ctx) return;
  const name = el?.querySelector('.card-name')?.textContent.split(' · ')[0] || labName(code);
  if (ctx.announce) {
    labClosePicker();
    labRespond({ type: labE.ocg.OcgResponseType.ANNOUNCE_CARD, card: code });
    return;
  }
  if (!labAddToZone(ctx, code, name)) return;
  const z = LAB_SETUP_ZONES.find(x => x.k === ctx.zone), n = labSetup.sides[ctx.side][ctx.zone].length;
  const outside = labDeckRef(ctx.side) && labOutsideCards(ctx.side).includes(code);
  const msg = document.getElementById('lab-picker-msg');
  msg.textContent = `+ ${name} (${n}${z.max ? '/' + z.max : ''})${outside ? ' — non è nel mazzo: verrà segnalata' : ''}`;
  msg.className = 'dm-msg ' + (outside ? 'warn' : 'ok');
  if (z.max && n >= z.max) labClosePicker();
}

// ── Avvio / controlli della prova ────────────────────────────────────────────
async function labStartFromSetup() {
  const codes = labSetup.sides.flatMap(sd => LAB_SETUP_ZONES.flatMap(z => sd[z.k].map(e => Number(e.code))));
  if (!codes.length) return;
  try {
    labBusy = labE ? 'Preparazione delle carte…' : 'Caricamento del motore di EDOPro (solo la prima volta, circa 3 MB)…';
    labRender();
    await labInit();
    labBusy = 'Caricamento di dati e script delle carte…';
    labRender();
    await labEnsureCards(codes);
    const ids = new Set(codes);
    codes.forEach(c => { const i = labInfo.get(c); if (i && i.id !== c) ids.add(i.id); });
    await Promise.all([...ids].map(c => labFetchScript(`c${c}.lua`)));
    const unknown = codes.filter(c => !labInfo.has(c));
    labBusy = '';
    const r = () => BigInt(Math.floor(Math.random() * 2 ** 32)) + 1n;
    labStart([r(), r(), r(), r()]);
    if (unknown.length) labLog(`Carte non trovate nel database: ${[...new Set(unknown)].join(', ')}`, 'warn');
    labRender();
  } catch(e) { labFail(e); }
}

function labUndo() {
  const d = labDuel;
  if (!d) return;
  let i = d.responses.length - 1;
  while (i >= 0 && !d.responses[i].manual) i--;
  if (i < 0) { toast('Niente da annullare'); return; }
  try { labStart(d.seed, d.responses.slice(0, i)); } catch(e) { labFail(e); return; }
  labRender();
}

function labRestart() {
  if (!labDuel) return;
  try { labStart(labDuel.seed); } catch(e) { labFail(e); return; }
  labRender();
}

function labBackToSetup() {
  if (labDuel?.h) { try { labE.core.destroyDuel(labDuel.h); } catch(e) {} }
  labDuel = null;
  labRender();
}

// ── Campo di gioco ───────────────────────────────────────────────────────────
const LAB_PILE_LOC = { grave: 16, removed: 32, extra: 64, deck: 1 };

/**
 * Azioni possibili ADESSO per la carta in (controller, location, sequence),
 * ricavate dalla richiesta in corso del motore.
 */
function labActionsFor(ctrl, loc, seq) {
  const m = labDuel?.pending;
  if (!m) return [];
  const { OcgMessageType: MT, SelectIdleCMDAction: I, SelectBattleCMDAction: B } = labE.ocg;
  const out = [];
  const add = (list, label, fn) => (list || []).forEach((c, i) => {
    if (c.controller === ctrl && c.location === loc && c.sequence === seq)
      out.push({ label: typeof label === 'function' ? label(c) : label, fn: fn(i) });
  });
  const act = pre => c => pre + labEffectSuffix(c.description, c.code);
  switch (m.type) {
    case MT.SELECT_IDLECMD:
      add(m.activates, act('Attiva'), i => `labIdle(${I.SELECT_ACTIVATE},${i})`);
      add(m.summons, 'Evocazione Normale', i => `labIdle(${I.SELECT_SUMMON},${i})`);
      add(m.special_summons, 'Evocazione Speciale', i => `labIdle(${I.SELECT_SPECIAL_SUMMON},${i})`);
      add(m.monster_sets, 'Posiziona coperto', i => `labIdle(${I.SELECT_MONSTER_SET},${i})`);
      add(m.spell_sets, 'Posiziona coperta', i => `labIdle(${I.SELECT_SPELL_SET},${i})`);
      add(m.pos_changes, 'Cambia posizione', i => `labIdle(${I.SELECT_POS_CHANGE},${i})`);
      break;
    case MT.SELECT_BATTLECMD:
      add(m.attacks, 'Attacca', i => `labBattle(${B.SELECT_BATTLE},${i})`);
      add(m.chains, act('Attiva'), i => `labBattle(${B.SELECT_CHAIN},${i})`);
      break;
    case MT.SELECT_CHAIN:
      add(m.selects, act('Attiva in risposta'), i => `labChain(${i})`);
      break;
    case MT.SELECT_CARD:
    case MT.SELECT_TRIBUTE:
    case MT.SELECT_SUM: {
      const single = m.type !== MT.SELECT_SUM && m.min === 1 && m.max === 1;
      add(m.selects, single ? 'Scegli questa carta' : 'Aggiungi / togli dalla scelta', i => single ? `labSelectCards([${i}])` : `labToggle(${i})`);
      break;
    }
    case MT.SELECT_UNSELECT_CARD:
      add(m.select_cards, 'Scegli questa carta', i => `labUnselect(${i})`);
      add(m.unselect_cards, 'Togli dalla scelta', i => `labUnselect(${m.select_cards.length + i})`);
      break;
  }
  return out;
}

function labTile(card, extraCls = '', loc = null) {
  if (!card) return `<div class="lab-zone ${extraCls}"></div>`;
  const P = labE.ocg.OcgPosition, T = labE.ocg.OcgType;
  const inHand = extraCls.includes("hc");                 // in mano il motore le considera coperte: le mostro comunque
  const down = !inHand && (card.position & P.FACEDOWN), def = !inHand && (card.position & P.DEFENSE);
  const type = labCardData(card.code)?.type || 0;
  const isMon = (type & T.MONSTER) && extraCls.includes("mz");
  const mats = card.overlayCards?.length ? `<span class="lab-mats">${card.overlayCards.length}</span>` : '';
  const can = loc && labActionsFor(loc.controller, loc.location, loc.sequence).length;
  const tap = loc ? `labTapCard(${card.code},${loc.controller},${loc.location},${loc.sequence})` : `labShowCard(${card.code})`;
  return `<div class="lab-zone ${extraCls} has${down ? ' down' : ''}${def ? ' def' : ''}${can ? ' can' : ''}" onclick="${tap}" title="${escH(labName(card.code))}">
    <img src="${labCardImg(card.code)}" alt="" loading="lazy"/>
    ${down ? '<span class="lab-badge">coperta</span>' : def && isMon ? '<span class="lab-badge">DIF</span>' : ''}
    ${isMon && !down ? `<span class="lab-stat">${card.attack}/${type & T.LINK ? "L" : card.defense}</span>` : ''}${mats}
  </div>`;
}

/** Tocco su una carta: azioni disponibili ora (se ce ne sono) + testo della carta. */
function labTapCard(code, ctrl, loc, seq) {
  const acts = labActionsFor(ctrl, loc, seq);
  const m = labDuel?.pending;
  let html;
  if (acts.length) {
    html = `<div class="lab-card-actions">${acts.map(a => `<button class="lab-opt act" onclick="labCloseCard(); ${a.fn}">${escH(a.label)}</button>`).join('')}</div>`;
  } else if (m) {
    const mine = ctrl === m.player;
    const meTurn = (m.player ^ labDuel.first) === 0;
    const why = !mine && [labE.ocg.OcgMessageType.SELECT_IDLECMD, labE.ocg.OcgMessageType.SELECT_BATTLECMD].includes(m.type)
      ? (meTurn
          ? `Adesso tocca a te. L'avversario potrà usare questa carta solo in risposta a una tua azione (evocazione, attivazione, attacco o cambio di fase): in quel momento il Laboratorio gli chiederà se vuole attivarla.`
          : `Adesso tocca all'avversario. Potrai usare questa carta solo in risposta a una sua azione (evocazione, attivazione, attacco o cambio di fase): in quel momento il Laboratorio ti chiederà se vuoi attivarla.`)
      : `In questo momento questa carta non si può usare. Le carte utilizzabili sono evidenziate in oro.`;
    html = `<div class="lab-card-note">${escH(why)}</div>`;
  }
  labShowCard(code, html);
}

function labPlayHtml() {
  const d = labDuel, f = labField();
  const me = 0 ^ d.first, opp = 1 ^ d.first;          // giocatori del motore
  const L = labE.ocg.OcgLocation;
  const at = (p, location, sequence) => ({ controller: p, location, sequence });
  const hand = p => `<div class="lab-hand">${f[p].hand.map((c, i) => labTile(c, 'hc', at(p, L.HAND, i))).join('') || '<span class="lab-empty">mano vuota</span>'}</div>`;
  const pileCan = (p, k) => f[p][k].some((c, i) => labActionsFor(p, LAB_PILE_LOC[k], i).length);
  const pile = (p, k, label) => `<button class="lab-pile${pileCan(p, k) ? ' can' : ''}" onclick="labShowPile(${p},'${k}')">${label} <b>${f[p][k].length}</b></button>`;
  const piles = p => `<div class="lab-piles">${pile(p, 'grave', 'Cimitero')}${pile(p, 'removed', 'Banditi')}${pile(p, 'extra', 'Extra')}${pile(p, 'deck', 'Deck')}</div>`;
  const mrow = p => [0, 1, 2, 3, 4].map(i => labTile(f[p].mzone[i], 'mz', at(p, L.MZONE, i)));
  const srow = p => [0, 1, 2, 3, 4].map(i => labTile(f[p].szone[i], 'sz', at(p, L.SZONE, i)));
  const fzone = p => labTile(f[p].szone[5], 'fz', at(p, L.SZONE, 5));
  // Zone Mostri Extra condivise: la sinistra è la 5 per me e la 6 per l'avversario (e viceversa)
  const emz = (mySeq, oppSeq) => f[me].mzone[mySeq] ? labTile(f[me].mzone[mySeq], 'mz', at(me, L.MZONE, mySeq))
                                                    : labTile(f[opp].mzone[oppSeq], 'mz', at(opp, L.MZONE, oppSeq));
  const lp = p => `<span class="lab-lp ${d.lp[p] <= 0 ? 'ko' : ''}">${LAB_SIDES[p ^ d.first]} · <b>${Math.max(0, d.lp[p])}</b> LP</span>`;

  const board = `
    <div class="lab-board">
      <div class="lab-player-bar">${lp(opp)}</div>
      ${hand(opp)}
      ${piles(opp)}
      <div class="lab-row">${srow(opp).reverse().join('')}${fzone(opp)}</div>
      <div class="lab-row">${mrow(opp).reverse().join('')}<div class="lab-zone blank"></div></div>
      <div class="lab-row emz"><div class="lab-zone blank"></div>${emz(5, 6)}<div class="lab-zone blank"></div>${emz(6, 5)}<div class="lab-zone blank"></div><div class="lab-zone blank"></div></div>
      <div class="lab-row">${mrow(me).join('')}<div class="lab-zone blank"></div></div>
      <div class="lab-row">${srow(me).join('')}${fzone(me)}</div>
      ${piles(me)}
      ${hand(me)}
      <div class="lab-player-bar">${lp(me)}</div>
    </div>`;

  const status = d.ended || d.winner != null
    ? `<div class="lab-status end">${d.winner != null && d.winner < 2 ? `Duello finito: vince ${labWho(d.winner)}` : 'Duello finito'}</div>`
    : `<div class="lab-status">Turno ${d.turn} · ${LAB_PHASE[d.phase] || ''} · di turno: <b>${labWho(d.turnPlayer)}</b></div>`;

  const log = d.log.map(e => `<div class="lab-log-line ${e.cls}">${escH(e.text)}</div>`).join('');
  const canUndo = d.responses.some(r => r.manual);

  const help = `
    <details class="lab-help" ${labSetup.helpSeen ? '' : 'open'} ontoggle="labHelpToggled(this)">
      <summary>Come si gioca nel Laboratorio</summary>
      <ul>
        <li><b>Le carte con il bordo dorato si possono usare adesso.</b> Toccane una per vedere le azioni: Attiva, Evoca, Attacca…</li>
        <li>In alternativa usa la finestra <b>"cosa fai?"</b> in basso, che elenca tutte le azioni possibili.</li>
        <li>Giochi <b>tu per entrambi</b>: quando l'avversario può rispondere (dopo un'evocazione, un'attivazione, un attacco o un cambio di fase) la finestra in basso lo chiede a lui.</li>
        <li>Se un effetto non compare, <b>in quel momento non si può attivare</b>: è proprio quello che il Laboratorio ti aiuta a verificare. Tocca la carta per capire perché.</li>
        <li><b>↶ Annulla mossa</b> torna indietro di una scelta per provare un'altra strada.</li>
      </ul>
    </details>`;

  return `${status}
    ${labOutsideBannerHtml()}
    ${help}
    ${board}
    <div class="lab-prompt${labPromptMin ? " min" : ""}" id="lab-prompt">${labPromptHtml()}</div>
    <div class="lab-log-head">Registro</div>
    <div class="lab-log" id="lab-log">${log || '<div class="lab-log-line">—</div>'}</div>
    <div class="lab-actions">
      <button class="btn-cfg-sec" onclick="labUndo()" ${canUndo ? '' : 'disabled'}>↶ Annulla mossa</button>
      <button class="btn-cfg-sec" onclick="labRestart()">↺ Ricomincia</button>
      <button class="btn-cfg-sec" onclick="labBackToSetup()">✎ Modifica situazione</button>
      <button class="btn-cfg-sec" onclick="labToggleAskPhases()" title="Finestre di risposta in Draw e Standby Phase quando non succede nulla">Draw/Standby: ${labSetup.askPhases ? "chiedi sempre" : "salta se vuote"}</button>
    </div>
    ${labCreditsHtml()}`;
}

// ── Richieste del motore → pulsanti ──────────────────────────────────────────
function labCardRef(c) {
  const where = c.location ? ` · ${labLoc(c)}${c.controller !== undefined && labDuel ? ' (' + labWho(c.controller) + ')' : ''}` : '';
  return `${escH(labName(c.code))}<small>${escH(where)}</small>`;
}

function labBtn(label, onclick, cls = '') {
  return `<button class="lab-opt ${cls}" onclick="${onclick}">${label}</button>`;
}

function labPromptHtml() {
  const d = labDuel, m = d.pending;
  if (!m) return d.ended || d.winner != null
    ? '<div class="lab-prompt-title">Il duello è finito. Puoi annullare l\'ultima mossa o ricominciare.</div>'
    : '<div class="lab-prompt-title">In attesa…</div>';
  const { ocg } = labE, MT = ocg.OcgMessageType;
  const who = labWho(m.player);
  const hintTxt = d.hint && d.hint.player === m.player && d.hint.hint ? labDesc(d.hint.hint) : '';
  const title = t => `<div class="lab-prompt-title" onclick="labTogglePrompt()" title="Riduci / espandi"><span class="lab-prompt-who ${m.player === (0 ^ d.first) ? 'me' : 'opp'}">${who}</span> ${escH(t)}</div>`;
  const I = ocg.SelectIdleCMDAction, B = ocg.SelectBattleCMDAction;

  switch (m.type) {
    case MT.SELECT_IDLECMD: {
      const groups = [
        ['Attiva', m.activates.map((c, i) => labBtn(`${labCardRef(c)}${escH(labEffectSuffix(c.description, c.code))}`, `labIdle(${I.SELECT_ACTIVATE},${i})`, 'act'))],
        ['Evocazione Normale', m.summons.map((c, i) => labBtn(labCardRef(c), `labIdle(${I.SELECT_SUMMON},${i})`))],
        ['Evocazione Speciale', m.special_summons.map((c, i) => labBtn(labCardRef(c), `labIdle(${I.SELECT_SPECIAL_SUMMON},${i})`))],
        ['Posiziona mostro', m.monster_sets.map((c, i) => labBtn(labCardRef(c), `labIdle(${I.SELECT_MONSTER_SET},${i})`))],
        ['Posiziona Magia/Trappola', m.spell_sets.map((c, i) => labBtn(labCardRef(c), `labIdle(${I.SELECT_SPELL_SET},${i})`))],
        ['Cambia posizione', m.pos_changes.map((c, i) => labBtn(labCardRef(c), `labIdle(${I.SELECT_POS_CHANGE},${i})`))],
      ];
      return title(`— ${LAB_PHASE[d.phase] || 'Main Phase'}: cosa fai?`) +
        groups.filter(g => g[1].length).map(([h, b]) => `<div class="lab-group"><div class="lab-group-h">${h}</div>${b.join('')}</div>`).join('') +
        `<div class="lab-phase-row">
          ${m.to_bp ? labBtn('⚔ Battle Phase', `labIdle(${I.TO_BP},0)`, 'phase') : ''}
          ${m.to_ep ? labBtn('End Phase ⏭', `labIdle(${I.TO_EP},0)`, 'phase') : ''}
        </div>`;
    }
    case MT.SELECT_BATTLECMD:
      return title('— Battle Phase: cosa fai?') +
        (m.attacks.length ? `<div class="lab-group"><div class="lab-group-h">Attacca con</div>${m.attacks.map((c, i) => labBtn(labCardRef(c) + (c.can_direct ? '<small> · può attaccare direttamente</small>' : ''), `labBattle(${B.SELECT_BATTLE},${i})`)).join('')}</div>` : '') +
        (m.chains.length ? `<div class="lab-group"><div class="lab-group-h">Attiva</div>${m.chains.map((c, i) => labBtn(`${labCardRef(c)}${escH(labEffectSuffix(c.description, c.code))}`, `labBattle(${B.SELECT_CHAIN},${i})`, 'act')).join('')}</div>` : '') +
        `<div class="lab-phase-row">
          ${m.to_m2 ? labBtn('Main Phase 2', `labBattle(${B.TO_M2},0)`, 'phase') : ''}
          ${m.to_ep ? labBtn('End Phase ⏭', `labBattle(${B.TO_EP},0)`, 'phase') : ''}
        </div>`;
    case MT.SELECT_CHAIN: {
      const size = d.chain.length;
      return title(size ? `— vuoi rispondere alla catena (anello ${size}: ${labName(d.chain[size - 1])})?` : '— vuoi attivare qualcosa ora?') +
        m.selects.map((c, i) => labBtn(`${labCardRef(c)}${escH(labEffectSuffix(c.description, c.code))}`, `labChain(${i})`, 'act')).join('') +
        (m.forced ? '' : labBtn('Non rispondere', 'labChain(null)', 'pass'));
    }
    case MT.SELECT_EFFECTYN:
      return title(`— attivare l'effetto di ${labName(m.code)}${labEffectSuffix(m.description, m.code)}?`) +
        `<div class="lab-phase-row">${labBtn('Sì', 'labYes(true)', 'act')}${labBtn('No', 'labYes(false)', 'pass')}</div>`;
    case MT.SELECT_YESNO:
      return title(`— ${labDesc(m.description) || 'confermi?'}`) +
        `<div class="lab-phase-row">${labBtn('Sì', 'labYes(true)', 'act')}${labBtn('No', 'labYes(false)', 'pass')}</div>`;
    case MT.SELECT_OPTION:
      return title(hintTxt ? `— ${hintTxt}` : '— scegli un\'opzione') +
        m.options.map((o, i) => labBtn(escH(labDesc(o) || `Opzione ${i + 1}`), `labOption(${i})`)).join('');
    case MT.SELECT_CARD:
    case MT.SELECT_TRIBUTE:
    case MT.SELECT_SUM: {
      const cards = m.selects;
      const single = m.type !== MT.SELECT_SUM && m.min === 1 && m.max === 1;
      const must = m.type === MT.SELECT_SUM && m.selects_must.length ? `<div class="lab-group-h">Già incluse: ${m.selects_must.map(c => escH(labName(c.code))).join(', ')}</div>` : '';
      const range = m.type === MT.SELECT_SUM ? `valore ${m.select_max ? 'almeno' : 'esattamente'} ${m.amount}` : m.min === m.max ? `${m.min}` : `da ${m.min} a ${m.max}`;
      return title(`— ${hintTxt || 'scegli le carte'} (${range})`) + must +
        cards.map((c, i) => labBtn(`${labSel.includes(i) ? '☑ ' : single ? '' : '☐ '}${labCardRef(c)}${c.amount != null ? `<small> · valore ${c.amount & 0xffff}${c.amount >> 16 ? '/' + (c.amount >> 16) : ''}</small>` : ''}`,
          single ? `labSelectCards([${i}])` : `labToggle(${i})`, labSel.includes(i) ? 'on' : '')).join('') +
        `<div class="lab-phase-row">
          ${single ? '' : labBtn(`Conferma (${labSel.length})`, 'labConfirmCards()', 'act')}
          ${m.can_cancel ? labBtn('Annulla', 'labSelectCards(null)', 'pass') : ''}
        </div>`;
    }
    case MT.SELECT_UNSELECT_CARD:
      return title(`— ${hintTxt || 'scegli le carte'}${m.min === m.max ? ` (${m.min})` : ` (da ${m.min} a ${m.max})`}`) +
        m.select_cards.map((c, i) => labBtn('☐ ' + labCardRef(c), `labUnselect(${i})`)).join('') +
        m.unselect_cards.map((c, i) => labBtn('☑ ' + labCardRef(c), `labUnselect(${m.select_cards.length + i})`, 'on')).join('') +
        `<div class="lab-phase-row">${m.can_finish ? labBtn('Fine', 'labUnselect(null)', 'act') : m.can_cancel ? labBtn('Annulla', 'labUnselect(null)', 'pass') : ''}</div>`;
    case MT.SELECT_PLACE:
    case MT.SELECT_DISFIELD: {
      const zones = labFreeZones(m);
      return title(`— ${hintTxt || 'scegli la zona'}${m.count > 1 ? ` (${labSel.length}/${m.count})` : ''}`) +
        zones.map((z, i) => labBtn(escH(z.label), `labPlace(${i})`, labSel.includes(i) ? 'on' : '')).join('');
    }
    case MT.SELECT_POSITION: {
      const P = ocg.OcgPosition;
      const opts = [[P.FACEUP_ATTACK, 'Attacco scoperto'], [P.FACEDOWN_ATTACK, 'Attacco coperto'], [P.FACEUP_DEFENSE, 'Difesa scoperta'], [P.FACEDOWN_DEFENSE, 'Difesa coperta']];
      return title(`— posizione di ${labName(m.code)}`) + opts.filter(([p]) => m.positions & p).map(([p, l]) => labBtn(l, `labPosition(${p})`)).join('');
    }
    case MT.ANNOUNCE_RACE: {
      const races = Object.entries(ocg.OcgRace).filter(([, v]) => BigInt(m.available) & v);
      return title(`— dichiara ${m.count} Tipo/i`) +
        races.map(([k, v], i) => labBtn(escH(labSys(1020 + v.toString(2).length - 1) || k), `labToggle(${i})`, labSel.includes(i) ? 'on' : '')).join('') +
        `<div class="lab-phase-row">${labBtn('Conferma', 'labAnnounceRace()', 'act')}</div>`;
    }
    case MT.ANNOUNCE_ATTRIB: {
      const attrs = Object.entries(ocg.OcgAttribute).filter(([, v]) => m.available & v);
      return title(`— dichiara ${m.count} Attributo/i`) +
        attrs.map(([k], i) => labBtn(escH(labSys(1010 + Math.log2(ocg.OcgAttribute[k])) || k), `labToggle(${i})`, labSel.includes(i) ? 'on' : '')).join('') +
        `<div class="lab-phase-row">${labBtn('Conferma', 'labAnnounceAttr()', 'act')}</div>`;
    }
    case MT.ANNOUNCE_NUMBER:
      return title(`— ${hintTxt || 'dichiara un numero'}`) + m.options.map((o, i) => labBtn(String(o), `labNumber(${i})`)).join('');
    case MT.ANNOUNCE_CARD:
      return title(`— ${hintTxt || 'dichiara il nome di una carta'}`) + labBtn('🔍 Cerca la carta da dichiarare', 'labOpenAnnounce()', 'act');
  }
  return title(`— richiesta non gestita (${ocg.ocgMessageTypeStrings.get(m.type) || m.type})`) +
    labBtn('Rispondi con la scelta predefinita', 'labDefault()', 'pass');
}

function labFreeZones(m) {
  const L = labE.ocg.OcgLocation, out = [];
  for (let bit = 0; bit < 32; bit++) {
    if ((m.field_mask >>> bit) & 1) continue;
    const j = bit % 16;
    if (j === 7 || j > 13) continue;                        // bit non usati / zone Pendulum separate
    const player = bit < 16 ? m.player : 1 - m.player;
    const location = j < 8 ? L.MZONE : L.SZONE, sequence = j % 8;
    const owner = labWho(player);
    const label = location === L.MZONE
      ? (sequence >= 5 ? `Zona Mostri Extra ${sequence === 5 ? 'sinistra' : 'destra'}` : `Zona Mostri ${sequence + 1} di ${owner}`)
      : (sequence === 5 ? `Zona Terreno di ${owner}` : `Zona Magie/Trappole ${sequence + 1} di ${owner}`);
    out.push({ player, location, sequence, label });
  }
  return out;
}

// ── Risposte ─────────────────────────────────────────────────────────────────
function labR() { return labE.ocg.OcgResponseType; }
function labIdle(action, index)   { labRespond({ type: labR().SELECT_IDLECMD, action, index }); }
function labBattle(action, index) { labRespond({ type: labR().SELECT_BATTLECMD, action, index }); }
function labChain(index)          { labRespond({ type: labR().SELECT_CHAIN, index }); }
function labOption(index)         { labRespond({ type: labR().SELECT_OPTION, index }); }
function labPosition(position)    { labRespond({ type: labR().SELECT_POSITION, position }); }
function labNumber(value)         { labRespond({ type: labR().ANNOUNCE_NUMBER, value }); }
function labUnselect(index)       { labRespond({ type: labR().SELECT_UNSELECT_CARD, index }); }

function labYes(yes) {
  const MT = labE.ocg.OcgMessageType;
  labRespond({ type: labDuel.pending.type === MT.SELECT_EFFECTYN ? labR().SELECT_EFFECTYN : labR().SELECT_YESNO, yes });
}

function labToggle(i) {
  labSel = labSel.includes(i) ? labSel.filter(x => x !== i) : [...labSel, i];
  document.getElementById('lab-prompt').innerHTML = labPromptHtml();
}

function labSelectCards(indicies) {
  const MT = labE.ocg.OcgMessageType, t = labDuel.pending.type;
  const type = t === MT.SELECT_TRIBUTE ? labR().SELECT_TRIBUTE : t === MT.SELECT_SUM ? labR().SELECT_SUM : labR().SELECT_CARD;
  labRespond({ type, indicies });
}

function labConfirmCards() {
  const m = labDuel.pending;
  if (m.type !== labE.ocg.OcgMessageType.SELECT_SUM && (labSel.length < m.min || labSel.length > m.max)) {
    toast(m.min === m.max ? `Scegli ${m.min} carta/e` : `Scegli da ${m.min} a ${m.max} carte`);
    return;
  }
  labSelectCards([...labSel].sort((a, b) => a - b));
}

function labPlace(i) {
  const m = labDuel.pending;
  if (!labSel.includes(i)) labSel.push(i);
  if (labSel.length < (m.count || 1)) { document.getElementById('lab-prompt').innerHTML = labPromptHtml(); return; }
  const zones = labFreeZones(m);
  const R = labR(), MT = labE.ocg.OcgMessageType;
  labRespond({ type: m.type === MT.SELECT_DISFIELD ? R.SELECT_DISFIELD : R.SELECT_PLACE,
               places: labSel.map(j => ({ player: zones[j].player, location: zones[j].location, sequence: zones[j].sequence })) });
}

function labAnnounceRace() {
  const m = labDuel.pending;
  const races = Object.values(labE.ocg.OcgRace).filter(v => BigInt(m.available) & v);
  if (labSel.length !== m.count) { toast(`Scegli ${m.count} Tipo/i`); return; }
  labRespond({ type: labR().ANNOUNCE_RACE, races: labSel.map(i => races[i]) });
}

function labAnnounceAttr() {
  const m = labDuel.pending;
  const attrs = Object.values(labE.ocg.OcgAttribute).filter(v => m.available & v);
  if (labSel.length !== m.count) { toast(`Scegli ${m.count} Attributo/i`); return; }
  labRespond({ type: labR().ANNOUNCE_ATTRIB, attributes: labSel.map(i => attrs[i]) });
}

function labOpenAnnounce() {
  labPickerCtx = { announce: labDuel.pending };
  labShowPicker('Dichiara una carta');
}

/** Ultima risorsa per richieste rare non ancora gestite dall'interfaccia. */
function labDefault() {
  const m = labDuel.pending, MT = labE.ocg.OcgMessageType, R = labR();
  const map = {
    [MT.SELECT_COUNTER]: () => labAutoResponse(m),
    [MT.SORT_CARD]: () => ({ type: R.SORT_CARD, order: null }),
    [MT.SORT_CHAIN]: () => ({ type: R.SORT_CARD, order: null }),
  };
  const r = map[m.type]?.();
  if (r) labRespond(r); else toast('Questa richiesta non è ancora supportata.');
}

// ── Dettaglio carta e liste (Cimitero, Banditi, …) ───────────────────────────
async function labShowCard(code, actionsHtml = '') {
  const box = document.getElementById('lab-card-body');
  document.getElementById('lab-card').classList.add('open');
  document.body.style.overflow = 'hidden';
  const render = () => {
    const c = labInfo.get(code);
    const stats = c && c.atk != null ? `<div class="lab-card-stats">ATK ${c.atk}${c.def != null ? ' / DEF ' + c.def : ''}${c.level ? ' · Livello/Rango ' + c.level : ''}${c.linkval ? ' · Link ' + c.linkval : ''}</div>` : '';
    box.innerHTML = `
      ${actionsHtml || ''}
      <img class="lab-card-img" src="https://images.ygoprodeck.com/images/cards/${code}.jpg" alt=""/>
      <div class="lab-card-info">
        <div class="dm-title">${escH(c?.name || labName(code))}</div>
        ${c?.it && c.it.name !== c.name ? `<div class="dm-sub">${escH(c.it.name)}</div>` : ''}
        <div class="card-type">${escH([c?.type, c?.race, c?.attribute].filter(Boolean).join(' · '))}</div>
        ${stats}
        <div class="lab-card-text">${escH(c?.it?.desc || c?.desc || 'Caricamento…').replace(/\n/g, '<br>')}</div>
        ${c?.it?.desc && c.desc ? `<details><summary>Testo inglese</summary><div class="lab-card-text">${escH(c.desc).replace(/\n/g, '<br>')}</div></details>` : ''}
      </div>`;
  };
  render();
  if (!labInfo.get(code)?.it) { await labEnsureCards([code]).catch(() => {}); if (!labInfo.get(code)?.it) { try { const [it] = await apiCards({ id: code, language: 'it' }); const e = labInfo.get(code); if (e && it) e.it = { name: it.name, desc: it.desc }; } catch(e) {} } render(); }
}

function labShowPile(p, k) {
  const f = labField()[p][k];
  const names = { grave: 'Cimitero', removed: 'Banditi', extra: 'Extra Deck', deck: 'Deck (dall\'alto)' };
  // la sequenza reale serve per trovare le azioni possibili (es. effetti che si attivano dal Cimitero)
  const list = f.map((c, seq) => ({ c, seq }));
  if (k === 'deck') list.reverse();
  const loc = LAB_PILE_LOC[k];
  document.getElementById('lab-card-body').innerHTML = `
    <div class="dm-title" style="margin-bottom:8px">${names[k]} di ${labWho(p)} (${f.length})</div>
    <div class="dm-list">${list.map(({ c, seq }) => cardRowHtml(c.code, labName(c.code), labInfo.get(c.code)?.type || '',
      labActionsFor(p, loc, seq).length ? '<span class="card-have">usabile ora</span>' : '',
      `onclick="labTapCard(${c.code},${p},${loc},${seq})"`, labActionsFor(p, loc, seq).length ? 'can' : '')).join('') || '<div class="dm-empty">Vuoto</div>'}</div>`;
  document.getElementById('lab-card').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function labCloseCard() {
  document.getElementById('lab-card').classList.remove('open');
  if (!document.querySelector('.dm-overlay.open')) document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('lab-card')?.classList.contains('open')) labCloseCard();
  else if (document.getElementById('lab-picker')?.classList.contains('open')) labClosePicker();
});

function labTogglePrompt() {
  labPromptMin = !labPromptMin;
  document.getElementById('lab-prompt')?.classList.toggle('min', labPromptMin);
}

function labToggleAskPhases() {
  labSetup.askPhases = !labSetup.askPhases;
  labSaveSetup();
  toast(labSetup.askPhases ? 'Draw e Standby Phase: ti verrà sempre chiesto se rispondere' : 'Draw e Standby Phase: saltate se non succede nulla');
  labRender();
}

function labHelpToggled(el) {
  if (!el.open && !labSetup.helpSeen) { labSetup.helpSeen = true; labSaveSetup(); }
}
