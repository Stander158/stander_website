// Yu-Gi-Oh! deck builder. Runs entirely in the browser; decks are saved in localStorage.
(() => {
  const app = document.getElementById('yd');
  const $ = (sel) => app.querySelector(sel);
  const IMG = app.dataset.img; // "/ygo/img/" + "small|big/<id>.jpg"

  const FORMATS = {
    tcg: { label: 'TCG', bit: 1, ban: 0 },
    ocg: { label: 'OCG', bit: 2, ban: 1 },
    md: { label: 'Master Duel', bit: 4, ban: 2 },
  };
  const LIMIT = { F: 0, L: 1, S: 2 };
  const BAN_NAME = { F: 'Forbidden', L: 'Limited', S: 'Semi-Limited' };
  const ZONES = ['main', 'extra', 'side'];
  const ZONE_NAME = { main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' };
  const SIZE = { main: [40, 60], extra: [0, 15], side: [0, 15] };
  const EXTRA_FRAMES = new Set(['fusion', 'synchro', 'xyz', 'link', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum']);
  const SUBTYPES = {
    monster: ['Normal', 'Effect', 'Tuner', 'Pendulum', 'Ritual', 'Fusion', 'Synchro', 'Xyz', 'Link', 'Flip', 'Gemini', 'Spirit', 'Toon', 'Union'],
    spell: ['Normal', 'Quick-Play', 'Continuous', 'Equip', 'Field', 'Ritual'],
    trap: ['Normal', 'Continuous', 'Counter'],
  };
  SUBTYPES.main = SUBTYPES.monster.filter((s) => !['Fusion', 'Synchro', 'Xyz', 'Link'].includes(s));
  SUBTYPES.extra = ['Fusion', 'Synchro', 'Xyz', 'Link', 'Pendulum', 'Effect', 'Tuner'];
  const ATTRIBUTES = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
  const PAGE = 90;
  const LS = { decks: 'ygo.decks', current: 'ygo.current' };
  const TOUCH = matchMedia('(hover: none)').matches;

  const S = {
    cards: [], byId: new Map(), alias: {},
    decks: [], deck: null,
    results: [], shown: 0,
    detail: null, // { id, zone, index }
  };

  // ---------- helpers ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: decks just won't persist */ } },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const fmt = () => FORMATS[S.deck.format] || FORMATS.tcg;
  const img = (size, id) => `${IMG}${size}/${id}.jpg`;

  let toastTimer;
  function toast(msg) {
    const el = $('#ydToast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      window.prompt('Copy this:', text);
    }
  }

  // ---------- card rules ----------
  const banOf = (c, format = S.deck.format) => c.ban[FORMATS[format].ban];
  const limitOf = (c) => LIMIT[banOf(c)] ?? 3;
  const inFormat = (c) => (c.formats & fmt().bit) !== 0;
  const zoneFor = (c, zone) => (zone === 'side' ? 'side' : c.extra ? 'extra' : 'main');

  function copies(id) {
    let n = 0;
    for (const z of ZONES) for (const x of S.deck[z]) if (x === id) n++;
    return n;
  }

  function levelLabel(c) {
    if (c.kind !== 'monster' || c.level == null) return '';
    if (c.frame === 'link') return `LINK-${c.level}`;
    return `${c.frame.startsWith('xyz') ? 'Rank' : 'Level'} ${c.level}`;
  }
  const stat = (v) => (v == null ? '' : v === -1 ? '?' : v);

  // ---------- decks ----------
  function newDeck(name = 'Untitled deck', format = 'tcg') {
    return { id: uid(), name, format, main: [], extra: [], side: [], updated: Date.now() };
  }

  let saveTimer;
  function save() {
    S.deck.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.set(LS.decks, JSON.stringify(S.decks));
      store.set(LS.current, S.deck.id);
    }, 150);
  }

  function loadDecks() {
    let decks = [];
    try { decks = JSON.parse(store.get(LS.decks) || '[]'); } catch { decks = []; }
    S.decks = decks.filter((d) => d && d.id && Array.isArray(d.main)).map((d) => {
      for (const z of ZONES) d[z] = (d[z] || []).filter((id) => S.byId.has(id));
      if (!FORMATS[d.format]) d.format = 'tcg';
      return d;
    });
    if (!S.decks.length) S.decks.push(newDeck('My first deck'));
    S.deck = S.decks.find((d) => d.id === store.get(LS.current)) || S.decks[0];
  }

  function selectDeck(deck) {
    S.deck = deck;
    S.detail = null;
    save();
    renderDeckList();
    renderFormat();
    renderDeck();
    runSearch();
    renderDetail();
  }

  function changed() {
    save();
    renderDeck();
    refreshResultQty();
    renderDetail();
  }

  function add(id, zone = 'main', index) {
    const c = S.byId.get(id);
    if (!c) return;
    const z = zoneFor(c, zone);
    if (S.deck[z].length >= SIZE[z][1]) return toast(`The ${ZONE_NAME[z]} is full (${SIZE[z][1]} cards).`);
    const lim = limitOf(c);
    if (copies(id) >= lim) {
      if (lim === 0) return toast(`${c.name} is Forbidden in ${fmt().label}.`);
      const why = lim < 3 ? ` (${BAN_NAME[banOf(c)]} in ${fmt().label})` : '';
      return toast(`You can only use ${plural(lim, 'copy', 'copies')} of ${c.name}${why}.`);
    }
    const list = S.deck[z];
    list.splice(index == null || index > list.length ? list.length : index, 0, id);
    changed();
  }

  function removeAt(zone, index) {
    S.deck[zone].splice(index, 1);
    if (S.detail && S.detail.zone === zone) S.detail = { id: S.detail.id };
    changed();
  }

  // Remove one copy of a card, from the Side Deck last.
  function removeOne(id) {
    for (const z of ['main', 'extra', 'side']) {
      const i = S.deck[z].lastIndexOf(id);
      if (i >= 0) return removeAt(z, i);
    }
  }

  function move(from, index, to, toIndex) {
    const id = S.deck[from][index];
    const c = S.byId.get(id);
    const z = zoneFor(c, to);
    if (z !== from && S.deck[z].length >= SIZE[z][1]) return toast(`The ${ZONE_NAME[z]} is full (${SIZE[z][1]} cards).`);
    S.deck[from].splice(index, 1);
    let at = toIndex == null ? S.deck[z].length : toIndex;
    if (z === from && toIndex != null && index < toIndex) at--;
    S.deck[z].splice(Math.min(at, S.deck[z].length), 0, id);
    if (S.detail) S.detail = { id: S.detail.id };
    changed();
  }

  const KIND_ORDER = { monster: 0, spell: 1, trap: 2 };
  const EXTRA_ORDER = (c) => ['fusion', 'synchro', 'xyz', 'link'].findIndex((f) => c.frame.startsWith(f));
  function sortDeck() {
    const key = (id) => {
      const c = S.byId.get(id);
      return [c.extra ? EXTRA_ORDER(c) : KIND_ORDER[c.kind], c.kind === 'monster' ? -(c.level || 0) : 0, c.name];
    };
    const cmp = (a, b) => {
      const ka = key(a), kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    };
    for (const z of ZONES) S.deck[z].sort(cmp);
    changed();
  }

  function problems() {
    const d = S.deck, f = fmt(), out = [];
    const n = d.main.length;
    if (n < SIZE.main[0]) out.push(`Main Deck has ${n} cards; it needs at least 40.`);
    if (n > SIZE.main[1]) out.push(`Main Deck has ${n} cards; the maximum is 60.`);
    for (const z of ['extra', 'side']) if (d[z].length > 15) out.push(`${ZONE_NAME[z]} has ${d[z].length} cards; the maximum is 15.`);
    const counts = new Map();
    for (const z of ZONES) for (const id of d[z]) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, count] of counts) {
      const c = S.byId.get(id), lim = limitOf(c);
      if (count > lim) out.push(lim === 0 ? `${c.name} is Forbidden in ${f.label}.` : `${c.name}: ${count} copies, ${f.label} allows ${lim}.`);
      if (!inFormat(c)) out.push(`${c.name} isn't available in ${f.label}.`);
    }
    return out;
  }

  // ---------- import / export ----------
  function parseYdk(text) {
    const d = { main: [], extra: [], side: [] };
    let z = 'main';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === '#main') z = 'main';
      else if (line === '#extra') z = 'extra';
      else if (line === '!side') z = 'side';
      else if (/^\d+$/.test(line)) d[z].push(Number(line));
    }
    return d;
  }

  function idsToB64(ids) {
    const view = new DataView(new ArrayBuffer(ids.length * 4));
    ids.forEach((id, i) => view.setUint32(i * 4, id, true));
    let s = '';
    for (const b of new Uint8Array(view.buffer)) s += String.fromCharCode(b);
    return btoa(s);
  }
  function b64ToIds(b64) {
    const s = atob(b64);
    const view = new DataView(Uint8Array.from(s, (ch) => ch.charCodeAt(0)).buffer);
    const ids = [];
    for (let i = 0; i + 4 <= s.length; i += 4) ids.push(view.getUint32(i, true));
    return ids;
  }
  const toYdke = (d) => `ydke://${idsToB64(d.main)}!${idsToB64(d.extra)}!${idsToB64(d.side)}!`;
  function parseYdke(text) {
    const m = text.trim().match(/^ydke:\/\/([^!]*)!([^!]*)!([^!]*)!?$/);
    if (!m) return null;
    return { main: b64ToIds(m[1]), extra: b64ToIds(m[2]), side: b64ToIds(m[3]) };
  }

  // Map alternate-art passcodes, drop unknown cards and put each card in the right deck.
  function cleanImport(raw) {
    const out = { main: [], extra: [], side: [] };
    let unknown = 0;
    for (const z of ZONES) {
      for (let id of raw[z]) {
        id = S.alias[id] || id;
        const c = S.byId.get(id);
        if (!c) { unknown++; continue; }
        out[zoneFor(c, z)].push(id);
      }
    }
    return { cards: out, unknown };
  }

  function importDeck(raw, name, format) {
    const { cards, unknown } = cleanImport(raw);
    const total = cards.main.length + cards.extra.length + cards.side.length;
    if (!total) return toast(unknown ? `None of those ${plural(unknown, 'card')} are in the database.` : 'That deck is empty.');
    const deck = Object.assign(newDeck(name || 'Imported deck', FORMATS[format] ? format : S.deck.format), cards);
    S.decks.push(deck);
    selectDeck(deck);
    toast(`Imported ${plural(total, 'card')}${unknown ? `; skipped ${unknown} unknown` : ''}.`);
  }

  function toYdk(d) {
    return ['#created by ' + location.host, '#main', ...d.main, '#extra', ...d.extra, '!side', ...d.side, ''].join('\n');
  }

  function download(href, filename) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  const fileName = (ext) => `${(S.deck.name || 'deck').replace(/[\\/:*?"<>|]+/g, '').trim() || 'deck'}.${ext}`;

  function shareLink() {
    const p = new URLSearchParams({ deck: toYdke(S.deck), f: S.deck.format, n: S.deck.name });
    return `${location.origin}${location.pathname}#${p}`;
  }

  function readHash() {
    if (!location.hash.startsWith('#deck=')) return;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    let raw = null;
    try { raw = parseYdke(p.get('deck') || ''); } catch { raw = null; }
    if (raw) importDeck(raw, p.get('n') || 'Shared deck', p.get('f'));
    else toast('That share link is broken.');
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
  }

  async function exportImage() {
    const d = S.deck;
    const sections = ZONES.filter((z) => d[z].length);
    if (!sections.length) return toast('Add some cards first.');
    toast('Drawing the image…');
    const W = 1240, pad = 32, gap = 8, cols = 10;
    const cw = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols), ch = Math.round((cw * 246) / 168);
    let H = pad + 70;
    for (const z of sections) H += 40 + Math.ceil(d[z].length / cols) * (ch + gap) + 12;
    H += pad;
    const ids = [...new Set(ZONES.flatMap((z) => d[z]))];
    const pics = new Map(await Promise.all(ids.map(async (id) => [id, await loadImage(img('small', id))])));

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const font = (w, px) => `${w} ${px}px -apple-system, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#0b1627'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f1f5fb'; ctx.font = font(700, 32);
    ctx.fillText(d.name || 'Untitled deck', pad, pad + 30);
    ctx.fillStyle = '#8193ab'; ctx.font = font(400, 17);
    ctx.fillText(`${fmt().label} · Main ${d.main.length} · Extra ${d.extra.length} · Side ${d.side.length}`, pad, pad + 58);
    ctx.textAlign = 'right';
    ctx.fillText(location.host, W - pad, pad + 58);
    ctx.textAlign = 'left';

    let y = pad + 70;
    for (const z of sections) {
      y += 30;
      ctx.fillStyle = '#d5deea'; ctx.font = font(600, 19);
      ctx.fillText(`${ZONE_NAME[z]} (${d[z].length})`, pad, y);
      y += 10;
      d[z].forEach((id, i) => {
        const x = pad + (i % cols) * (cw + gap), cy = y + Math.floor(i / cols) * (ch + gap);
        const c = S.byId.get(id), pic = pics.get(id);
        if (pic) ctx.drawImage(pic, x, cy, cw, ch);
        else {
          ctx.fillStyle = '#1f3350'; ctx.fillRect(x, cy, cw, ch);
          ctx.fillStyle = '#d5deea'; ctx.font = font(400, 11);
          ctx.fillText(c.name.slice(0, 18), x + 4, cy + 16);
        }
        const b = banOf(c);
        if (b in LIMIT) {
          ctx.beginPath(); ctx.arc(x + 14, cy + 14, 11, 0, Math.PI * 2);
          ctx.fillStyle = b === 'S' ? '#e8890c' : '#d62f2f'; ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = font(700, 13); ctx.textAlign = 'center';
          ctx.fillText(b === 'F' ? '✕' : String(LIMIT[b]), x + 14, cy + 19);
          ctx.textAlign = 'left';
        }
      });
      y += Math.ceil(d[z].length / cols) * (ch + gap) + 2;
    }
    cv.toBlob((blob) => {
      if (!blob) return toast('Couldn’t draw the image.');
      const url = URL.createObjectURL(blob);
      download(url, fileName('png'));
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, 'image/png');
  }

  // ---------- rendering ----------
  function badge(c) {
    const b = banOf(c);
    return b in LIMIT ? `<span class="yd-ban yd-ban-${b}" title="${BAN_NAME[b]} in ${fmt().label}">${b === 'F' ? '' : LIMIT[b]}</span>` : '';
  }

  function tile(c, attrs, extraClass = '', inner = '') {
    const off = inFormat(c) ? '' : ' yd-off';
    return `<button type="button" class="yd-card${off}${extraClass}" draggable="true" data-id="${c.id}" ${attrs} title="${esc(c.name)}">`
      + `<img src="${img('small', c.id)}" alt="${esc(c.name)}" loading="lazy" decoding="async" width="168" height="246">`
      + `<span class="yd-ph">${esc(c.name)}</span>${badge(c)}${inner}</button>`;
  }

  function renderFormat() {
    for (const b of app.querySelectorAll('[data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === S.deck.format));
    for (const el of app.querySelectorAll('[data-format-label]')) el.textContent = fmt().label;
  }

  function renderDeckList() {
    $('#ydDecks').innerHTML = S.decks.map((d) => `<option value="${d.id}"${d === S.deck ? ' selected' : ''}>${esc(d.name || 'Untitled deck')}</option>`).join('');
    $('#ydName').value = S.deck.name;
  }

  function zoneStats(z, ids) {
    const cards = ids.map((id) => S.byId.get(id));
    if (z === 'extra') {
      const n = (f) => cards.filter((c) => c.frame.startsWith(f)).length;
      return [['Fusion', n('fusion')], ['Synchro', n('synchro')], ['Xyz', n('xyz')], ['Link', n('link')]]
        .filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(' · ');
    }
    const n = (k) => cards.filter((c) => c.kind === k).length;
    return [[n('monster'), 'Monster'], [n('spell'), 'Spell'], [n('trap'), 'Trap']]
      .filter(([v]) => v).map(([v, k]) => plural(v, k)).join(' · ');
  }

  function renderDeck() {
    const counts = new Map();
    for (const z of ZONES) for (const id of S.deck[z]) counts.set(id, (counts.get(id) || 0) + 1);
    for (const z of ZONES) {
      const zone = $(`.yd-zone[data-zone="${z}"]`);
      const ids = S.deck[z];
      zone.querySelector('[data-count]').textContent = ids.length;
      zone.querySelector('[data-count]').classList.toggle('bad', ids.length > SIZE[z][1] || (z === 'main' && ids.length < SIZE.main[0]));
      zone.querySelector('[data-stats]').textContent = zoneStats(z, ids);
      zone.querySelector('[data-grid]').innerHTML = ids.map((id, i) => {
        const c = S.byId.get(id);
        const over = counts.get(id) > limitOf(c) ? ' yd-over' : '';
        return tile(c, `data-zone="${z}" data-index="${i}"`, over);
      }).join('') || `<p class="yd-empty">${z === 'main' ? 'Click or drag cards here from the search results.' : 'Empty'}</p>`;
    }
    const total = S.deck.main.length + S.deck.extra.length + S.deck.side.length;
    $('#ydTabCount').textContent = S.deck.main.length;
    const list = problems();
    const status = $('#ydStatus');
    if (!total) {
      status.className = 'yd-status';
      status.innerHTML = 'Empty deck. Search for cards on the right to start.';
    } else if (!list.length) {
      status.className = 'yd-status ok';
      status.innerHTML = `Legal for ${esc(fmt().label)}.`;
    } else {
      status.className = 'yd-status warn';
      status.innerHTML = `<details><summary>${plural(list.length, 'problem')} for ${esc(fmt().label)}</summary><ul>${list.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>`;
    }
  }

  function renderDetail() {
    const panel = $('#ydDetail');
    const c = S.detail && S.byId.get(S.detail.id);
    if (!c) {
      panel.classList.remove('has-card', 'open');
      return;
    }
    panel.classList.add('has-card');
    const isMonster = c.kind === 'monster';
    const kindLine = isMonster
      ? [`[${c.typeline.replace(/\//g, ' / ')}]`, c.attribute, levelLabel(c), c.scale != null ? `Scale ${c.scale}` : '']
      : [`${c.race} ${c.kind === 'spell' ? 'Spell' : 'Trap'}`];
    const atkDef = isMonster ? `ATK ${stat(c.atk)}${c.frame === 'link' ? '' : ` / DEF ${stat(c.def)}`}` : '';
    const arrows = c.links ? `Link Arrows: ${c.links}` : '';
    const bans = Object.entries(FORMATS).map(([k, f]) => {
      const b = banOf(c, k);
      const legal = (c.formats & f.bit) !== 0;
      const label = !legal ? 'Not released' : BAN_NAME[b] || 'Unlimited';
      return `<li class="${k === S.deck.format ? 'cur' : ''} b-${legal ? b : 'x'}"><span>${f.label}</span> ${label}</li>`;
    }).join('');
    const have = copies(c.id), lim = limitOf(c);
    const mainLabel = c.extra ? 'Extra' : 'Main';
    panel.innerHTML = `
      <button type="button" class="yd-close" data-act="close-detail" aria-label="Close">×</button>
      <div class="yd-detail-body">
        <img class="yd-detail-img" src="${img('big', c.id)}" alt="" width="421" height="614">
        <div class="yd-detail-text">
          <h2>${esc(c.name)}</h2>
          <p class="yd-meta">${kindLine.filter(Boolean).map(esc).join(' · ')}</p>
          ${atkDef || arrows ? `<p class="yd-meta">${esc([atkDef, arrows].filter(Boolean).join(' · '))}</p>` : ''}
          ${c.archetype ? `<p class="yd-meta">Archetype: <button type="button" class="yd-link" data-act="archetype">${esc(c.archetype)}</button></p>` : ''}
          <ul class="yd-bans">${bans}</ul>
          <p class="yd-desc">${esc(c.desc)}</p>
        </div>
      </div>
      <div class="yd-actions">
        <button type="button" class="yd-btn yd-primary" data-act="add-main">+ ${mainLabel}</button>
        <button type="button" class="yd-btn" data-act="add-side">+ Side</button>
        <button type="button" class="yd-btn" data-act="remove-one"${have ? '' : ' disabled'}>− Remove</button>
        <span class="yd-have">In deck: ${have} / ${lim}</span>
      </div>`;
  }

  function showDetail(id, zone, index) {
    if (S.detail && S.detail.id === id && S.detail.zone === zone && S.detail.index === index && !TOUCH) return;
    S.detail = { id, zone, index };
    renderDetail();
    if (TOUCH) $('#ydDetail').classList.add('open');
  }

  // ---------- search ----------
  const F = {};
  function readFilters() {
    Object.assign(F, {
      q: $('#ydQ').value, type: $('#ydType').value, sub: $('#ydSub').value, attr: $('#ydAttr').value,
      race: $('#ydRace').value, level: $('#ydLevel').value, ban: $('#ydBan').value, sort: $('#ydSort').value,
      text: $('#ydText').checked, all: $('#ydAll').checked,
    });
  }

  function matchType(c) {
    switch (F.type) {
      case 'monster': return c.kind === 'monster';
      case 'main': return c.kind === 'monster' && !c.extra;
      case 'extra': return c.extra;
      case 'spell': case 'trap': return c.kind === F.type;
      default: return true;
    }
  }

  const SORTS = {
    popular: (a, b) => b.views - a.views,
    new: (a, b) => b.date - a.date || b.views - a.views,
    name: (a, b) => a.name.localeCompare(b.name),
    atk: (a, b) => (b.atk ?? -2) - (a.atk ?? -2) || b.views - a.views,
    def: (a, b) => (b.def ?? -2) - (a.def ?? -2) || b.views - a.views,
    level: (a, b) => (b.level ?? -1) - (a.level ?? -1) || b.views - a.views,
  };

  function runSearch() {
    if (!S.cards.length) return;
    readFilters();
    const tokens = norm(F.q).split(' ').filter(Boolean);
    const exactId = /^\d{5,}$/.test(F.q.trim()) ? Number(F.q.trim()) : null;
    const bit = fmt().bit, bi = fmt().ban, level = F.level === '' ? null : Number(F.level);
    const isMonsterFilter = F.attr || F.race || level != null;
    S.results = S.cards.filter((c) => {
      if (exactId != null) return c.id === exactId || S.alias[exactId] === c.id;
      if (!F.all && !(c.formats & bit)) return false;
      if (!matchType(c)) return false;
      if (F.sub && !(c.kind === 'monster' ? c.typeline.split('/').includes(F.sub) : c.race === F.sub)) return false;
      if (isMonsterFilter && c.kind !== 'monster') return false;
      if (F.attr && c.attribute !== F.attr) return false;
      if (F.race && c.race !== F.race) return false;
      if (level != null && c.level !== level) return false;
      if (F.ban && c.ban[bi] !== F.ban) return false;
      if (tokens.length) {
        let hay = c.hay;
        if (F.text) hay += ' ' + (c.d ??= norm(c.desc));
        for (const t of tokens) if (!hay.includes(t)) return false;
      }
      return true;
    });
    // Exact name matches first, then the chosen order.
    const q = norm(F.q);
    S.results.sort((a, b) => (b.n === q) - (a.n === q) || SORTS[F.sort](a, b) || a.name.localeCompare(b.name));
    $('#ydResults').scrollTop = 0;
    $('#ydResultGrid').innerHTML = '';
    S.shown = 0;
    renderMore();
    $('#ydCount').textContent = S.results.length
      ? `${S.results.length.toLocaleString()} ${S.results.length === 1 ? 'card' : 'cards'}`
      : 'No cards match. Try fewer filters, or tick “Include cards not in ' + fmt().label + '”.';
  }

  function renderMore() {
    const next = S.results.slice(S.shown, S.shown + PAGE);
    $('#ydResultGrid').insertAdjacentHTML('beforeend', next.map((c) => tile(c, 'data-src="results"', '', qty(c.id))).join(''));
    S.shown += next.length;
    $('#ydMore').hidden = S.shown >= S.results.length;
  }

  const qty = (id) => {
    const n = copies(id);
    return `<span class="yd-qty"${n ? '' : ' hidden'}>×${n}</span>`;
  };

  function refreshResultQty() {
    for (const el of $('#ydResultGrid').children) {
      const n = copies(Number(el.dataset.id));
      const q = el.querySelector('.yd-qty');
      q.hidden = !n;
      q.textContent = `×${n}`;
    }
  }

  function fillSubtypes() {
    const list = SUBTYPES[$('#ydType').value] || [];
    const sel = $('#ydSub');
    sel.innerHTML = '<option value="">Any subtype</option>' + list.map((s) => `<option value="${s}">${s}</option>`).join('');
    sel.disabled = !list.length;
  }

  function fillFilters() {
    $('#ydAttr').insertAdjacentHTML('beforeend', ATTRIBUTES.map((a) => `<option value="${a}">${a[0] + a.slice(1).toLowerCase()}</option>`).join(''));
    const races = [...new Set(S.cards.filter((c) => c.kind === 'monster' && c.race).map((c) => c.race))].sort();
    $('#ydRace').insertAdjacentHTML('beforeend', races.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join(''));
    const levels = Array.from({ length: 14 }, (_, i) => i);
    $('#ydLevel').insertAdjacentHTML('beforeend', levels.map((l) => `<option value="${l}">${l}</option>`).join(''));
  }

  function resetFilters() {
    for (const id of ['#ydQ', '#ydType', '#ydAttr', '#ydRace', '#ydLevel', '#ydBan']) $(id).value = '';
    $('#ydSort').value = 'popular';
    $('#ydText').checked = false;
    $('#ydAll').checked = false;
    fillSubtypes();
    runSearch();
  }

  // ---------- events ----------
  function cardFrom(e) {
    const el = e.target.closest('.yd-card');
    if (!el || !app.contains(el)) return null;
    return { el, id: Number(el.dataset.id), zone: el.dataset.zone, index: el.dataset.index == null ? null : Number(el.dataset.index) };
  }

  function bind() {
    // Image fallback: show the card name when the picture can't load.
    app.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG' && e.target.parentElement.classList.contains('yd-card')) e.target.parentElement.classList.add('noimg');
    }, true);

    app.addEventListener('click', (e) => {
      const hit = cardFrom(e);
      if (hit) {
        if (TOUCH) return showDetail(hit.id, hit.zone, hit.index);
        if (hit.zone) return removeAt(hit.zone, hit.index);
        return add(hit.id, e.shiftKey ? 'side' : 'main');
      }
      const act = e.target.closest('[data-act]');
      if (act) onAction(act.dataset.act, act);
      const fmtBtn = e.target.closest('[data-format]');
      if (fmtBtn && fmtBtn.dataset.format !== S.deck.format) {
        S.deck.format = fmtBtn.dataset.format;
        save();
        renderFormat();
        renderDeck();
        runSearch();
        renderDetail();
      }
      const view = e.target.closest('.yd-tabs [data-view]');
      if (view) {
        app.dataset.view = view.dataset.view;
        for (const b of app.querySelectorAll('.yd-tabs [data-view]')) b.setAttribute('aria-pressed', String(b === view));
      }
    });

    app.addEventListener('contextmenu', (e) => {
      const hit = cardFrom(e);
      if (!hit || TOUCH) return;
      e.preventDefault();
      if (!hit.zone) add(hit.id, 'side');
      else move(hit.zone, hit.index, hit.zone === 'side' ? 'main' : 'side');
    });

    if (!TOUCH) {
      app.addEventListener('mouseover', (e) => {
        const hit = cardFrom(e);
        if (hit) showDetail(hit.id, hit.zone, hit.index);
      });
    }

    // Drag and drop: results -> deck, between deck zones, deck -> results (removes).
    let drag = null;
    app.addEventListener('dragstart', (e) => {
      const hit = cardFrom(e);
      if (!hit) return;
      drag = hit;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(hit.id));
    });
    app.addEventListener('dragend', () => {
      drag = null;
      for (const el of app.querySelectorAll('.drop')) el.classList.remove('drop');
    });
    const dropTarget = (e) => e.target.closest('.yd-zone, .yd-search');
    app.addEventListener('dragover', (e) => {
      const t = drag && dropTarget(e);
      if (!t) return;
      e.preventDefault();
      for (const el of app.querySelectorAll('.drop')) if (el !== t) el.classList.remove('drop');
      t.classList.add('drop');
    });
    app.addEventListener('drop', (e) => {
      const t = drag && dropTarget(e);
      if (!t) return;
      e.preventDefault();
      t.classList.remove('drop');
      const src = drag;
      drag = null;
      if (t.classList.contains('yd-search')) {
        if (src.zone) removeAt(src.zone, src.index);
        return;
      }
      const to = t.dataset.zone;
      const over = cardFrom(e);
      const at = over && over.zone ? over.index : null;
      if (src.zone) move(src.zone, src.index, to, at);
      else add(src.id, to, at);
    });

    let searchTimer;
    $('#ydQ').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 140); });
    $('#ydType').addEventListener('change', () => { fillSubtypes(); runSearch(); });
    for (const id of ['#ydSub', '#ydAttr', '#ydRace', '#ydLevel', '#ydBan', '#ydSort', '#ydText', '#ydAll']) $(id).addEventListener('change', runSearch);

    const more = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) renderMore();
    }, { rootMargin: '400px' });
    more.observe($('#ydMore'));

    $('#ydDecks').addEventListener('change', (e) => selectDeck(S.decks.find((d) => d.id === e.target.value)));
    $('#ydName').addEventListener('input', (e) => {
      S.deck.name = e.target.value;
      save();
      const opt = $('#ydDecks').selectedOptions[0];
      if (opt) opt.textContent = S.deck.name || 'Untitled deck';
    });

    $('#ydFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) $('#ydPaste').value = await file.text();
    });
    $('#ydImport form').addEventListener('submit', (e) => {
      const text = $('#ydPaste').value.trim();
      const file = $('#ydFile').files[0];
      if (e.submitter && e.submitter.value === 'import' && text) {
        let raw = null;
        try { raw = text.startsWith('ydke://') ? parseYdke(text) : parseYdk(text); } catch { raw = null; }
        if (raw) importDeck(raw, file ? file.name.replace(/\.ydk$/i, '') : 'Imported deck');
        else toast('That doesn’t look like a .ydk file or ydke:// code.');
      }
      $('#ydPaste').value = '';
      $('#ydFile').value = '';
    });

    document.addEventListener('click', (e) => {
      const menu = app.querySelector('.yd-menu[open]');
      if (menu && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $('#ydDetail').classList.remove('open');
    });
  }

  function onAction(act, el) {
    const menu = el.closest('.yd-menu');
    if (menu) menu.open = false;
    const d = S.deck;
    switch (act) {
      case 'new': {
        const deck = newDeck('Untitled deck', d.format);
        S.decks.push(deck);
        selectDeck(deck);
        $('#ydName').select();
        break;
      }
      case 'duplicate': {
        const deck = Object.assign(newDeck(`${d.name} (copy)`, d.format), { main: [...d.main], extra: [...d.extra], side: [...d.side] });
        S.decks.push(deck);
        selectDeck(deck);
        break;
      }
      case 'delete':
        if (!confirm(`Delete “${d.name || 'Untitled deck'}”?`)) break;
        S.decks = S.decks.filter((x) => x !== d);
        if (!S.decks.length) S.decks.push(newDeck('Untitled deck', d.format));
        selectDeck(S.decks[0]);
        break;
      case 'clear':
        if (!d.main.length && !d.extra.length && !d.side.length) break;
        if (!confirm('Remove every card from this deck?')) break;
        d.main = []; d.extra = []; d.side = [];
        changed();
        break;
      case 'sort': sortDeck(); break;
      case 'import': $('#ydImport').showModal(); break;
      case 'ydk': {
        const url = URL.createObjectURL(new Blob([toYdk(d)], { type: 'text/plain' }));
        download(url, fileName('ydk'));
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        break;
      }
      case 'ydke': copy(toYdke(d), 'Copied the ydke:// code. Paste it into EDOPro or Duelingbook.'); break;
      case 'share': copy(shareLink(), 'Copied a link to this deck.'); break;
      case 'image': exportImage(); break;
      case 'reset': resetFilters(); break;
      case 'close-detail': $('#ydDetail').classList.remove('open'); break;
      case 'add-main': add(S.detail.id, 'main'); break;
      case 'add-side': add(S.detail.id, 'side'); break;
      case 'remove-one':
        if (S.detail.zone != null && S.deck[S.detail.zone][S.detail.index] === S.detail.id) removeAt(S.detail.zone, S.detail.index);
        else removeOne(S.detail.id);
        break;
      case 'archetype': {
        const c = S.byId.get(S.detail.id);
        $('#ydQ').value = c.archetype;
        $('#ydDetail').classList.remove('open');
        app.dataset.view = 'search';
        for (const b of app.querySelectorAll('.yd-tabs [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === 'search'));
        runSearch();
        break;
      }
      default: break;
    }
  }

  // ---------- start ----------
  async function init() {
    bind();
    try {
      const res = await fetch(app.dataset.cards);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const at = Object.fromEntries(data.fields.map((f, i) => [f, i]));
      S.alias = data.alias || {};
      S.cards = data.cards.map((r) => {
        const c = {};
        for (const f of data.fields) c[f] = r[at[f]];
        c.kind = c.frame === 'spell' || c.frame === 'trap' ? c.frame : 'monster';
        c.extra = EXTRA_FRAMES.has(c.frame);
        c.n = norm(c.name);
        c.hay = c.archetype ? `${c.n} ${norm(c.archetype)}` : c.n;
        return c;
      });
      S.byId = new Map(S.cards.map((c) => [c.id, c]));
    } catch {
      $('#ydCount').textContent = 'Couldn’t load the card database. Refresh to try again.';
      return;
    }
    loadDecks();
    fillFilters();
    fillSubtypes();
    renderDeckList();
    renderFormat();
    renderDeck();
    runSearch();
    readHash();
    window.addEventListener('hashchange', readHash);
  }

  init();
})();
