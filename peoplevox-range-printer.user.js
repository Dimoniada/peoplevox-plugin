// ==UserScript==
// @name         Peoplevox Range Label Printer
// @namespace    https://github.com/Dimoniada/peoplevox-plugin
// @version      0.1.1
// @description  Print location labels for a barcode range on Peoplevox Manage locations.
// @match        https://wms.peoplevox.net/rkb4952/ui/*
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/Dimoniada/peoplevox-plugin/main/peoplevox-range-printer.user.js
// @downloadURL  https://raw.githubusercontent.com/Dimoniada/peoplevox-plugin/main/peoplevox-range-printer.user.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

'use strict';

// ---------- Range syntax ----------

// Inclusive sequence from..to (either direction), each value formatted by fmt.
function seq(from, to, fmt) {
  const out = [];
  const step = from <= to ? 1 : -1;
  for (let n = from; ; n += step) {
    out.push(fmt(n));
    if (n === to) return out;
  }
}

function rangeValues(content) {
  const bad = new Error(`Bad range [${content}]`);
  const bounds = content.split('-').map((s) => s.trim());
  if (bounds.length !== 2) throw bad;
  const [a, b] = bounds;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    // Pad only when a bound is typed with a leading zero; the longer such bound sets the width.
    const width = Math.max(0, ...[a, b].filter((s) => s.length > 1 && s[0] === '0').map((s) => s.length));
    return seq(Number(a), Number(b), (n) => String(n).padStart(width, '0'));
  }
  const isUpper = (s) => s === s.toUpperCase();
  if (/^[A-Za-z]$/.test(a) && /^[A-Za-z]$/.test(b) && isUpper(a) === isUpper(b)) {
    return seq(a.charCodeAt(0), b.charCodeAt(0), (c) => String.fromCharCode(c));
  }
  throw bad;
}

// 'HB6.B[1-2].L[3-4]' -> ['HB6.B', ['1','2'], '.L', ['3','4'], '']
function parseRange(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Empty input');
  const parts = [];
  let literal = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ']') throw new Error('Missing [');
    if (ch !== '[') {
      literal += ch;
      continue;
    }
    const end = text.indexOf(']', i + 1);
    if (end < 0) throw new Error('Missing ]');
    parts.push(literal, rangeValues(text.slice(i + 1, end)));
    literal = '';
    i = end;
  }
  parts.push(literal);
  return parts;
}

// Cartesian product, leftmost range outermost.
function expandParts(parts) {
  let out = [parts[0]];
  for (let i = 1; i < parts.length; i += 2) {
    const next = [];
    for (const head of out) for (const v of parts[i]) next.push(head + v + parts[i + 1]);
    out = next;
  }
  return out;
}

// ---------- Location lookup ----------

// Search the literal prefix once; narrow by range values only where the response was cut off
// at pageSize and wanted barcodes are still missing.
async function findLocations(parts, search, pageSize = 1000) {
  const rangeCount = (parts.length - 1) / 2;
  const wanted = expandParts(parts);
  const wantedKeys = new Set(wanted.map((b) => b.toUpperCase()));
  const found = new Map(); // uppercased barcode -> Map(Id -> row)

  const record = (row) => {
    const key = String(row.Barcode ?? '').toUpperCase();
    if (!wantedKeys.has(key)) return;
    if (!found.has(key)) found.set(key, new Map());
    found.get(key).set(row.Id, row);
  };
  // Wanted barcodes with ranges 0..fixed.length-1 pinned to the given values.
  const wantedUnder = (fixed) =>
    expandParts(parts.map((p, i) => (i % 2 === 1 && (i - 1) / 2 < fixed.length ? [fixed[(i - 1) / 2]] : p)));

  async function collect(fixed) {
    const k = fixed.length;
    const prefix = parts[0] + fixed.map((v, i) => v + parts[2 * i + 2]).join('');
    let capped = true; // an empty prefix is never searched
    if (prefix !== '') {
      const rows = await search(prefix);
      rows.forEach(record);
      capped = rows.length >= pageSize;
    }
    // shortcut: a capped full-depth search counts as final; only a >1000-hit exact barcode could slip
    if (!capped || k === rangeCount) return;
    for (const v of parts[2 * k + 1]) {
      if (wantedUnder([...fixed, v]).some((b) => !found.has(b.toUpperCase()))) await collect([...fixed, v]);
    }
  }
  await collect([]);

  const locations = [];
  const missing = [];
  const duplicates = [];
  for (const b of wanted) {
    const hits = found.get(b.toUpperCase());
    if (!hits) missing.push(b);
    else if (hits.size > 1) duplicates.push(b);
    else locations.push(hits.values().next().value);
  }
  return { locations, missing, duplicates };
}

// ---------- Peoplevox client (the only two calls the script may make) ----------

const BASE = '/rkb4952/backend';
const OPTIONS_KEY = 'PVX_PrintingOptions_rkb4952_Location';

async function postJson(path, body, fetchFn) {
  let res;
  try {
    res = await fetchFn(BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Network error: ${e.message}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') throw new Error('Unexpected reply (signed out?)');
  if (data.IsSuccess === false) {
    const f = data.Faults?.[0];
    throw new Error(f?.ErrorMessage || f?.ErrorCode || 'Request failed');
  }
  return data;
}

async function searchLocations(prefix, fetchFn) {
  const data = await postJson('/warehouse/locations/search', { Barcode: prefix, Paging: { PageSize: 1000, PageNo: 1 } }, fetchFn);
  return data.Items || [];
}

async function printLocation(id, options, fetchFn) {
  const data = await postJson('/printing/print', { IdsToPrint: [id], PrintingOptions: options }, fetchFn);
  if (data.FailedPrints?.length) throw new Error('No matching print template');
  if (data.IsSuccess !== true || !data.SuccessfulPrints?.includes(id)) throw new Error('Print not confirmed');
}

function readPrintOptions(storage) {
  try {
    const o = JSON.parse(storage.getItem(OPTIONS_KEY));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

// Same rule Peoplevox uses before it prints without asking.
function isPrinterSet(o) {
  return !!o && o.TerminalId > 0 && o.TemplateId != null && o.TemplateId > -2 && o.NumberOfCopies > 0;
}

// ---------- Job: one check-then-print run, and what the window shows for it ----------

const STOP_GUARD_MS = 500; // ignore Stop right after Print, so a double-click doesn't cancel the run
const CLEAR_AFTER_MS = 5000; // how long "700/700" or "Stopped" stays before the status clears

function createJob({
  search, print, readOptions, getDelayMs,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  later = (ms, fn) => setTimeout(fn, ms),
  checkEnabled = async () => true,
  onChange = () => {},
}) {
  let s = { phase: 'idle', printerSet: isPrinterSet(readOptions()), done: 0, total: 0, message: '', list: [], startedAt: 0 };
  let stopRequested = false;
  let runs = 0;
  const set = (patch) => {
    s = { ...s, ...patch };
    onChange(s);
  };
  const running = () => s.phase === 'checking' || s.phase === 'printing';

  async function start(input) {
    if (running() || now() - s.startedAt < STOP_GUARD_MS) return; // also swallows a double-click after a quick run
    stopRequested = false;
    const run = ++runs;
    // done/stopped clear after a while, unless a newer run has started since
    const finish = (patch) => {
      set(patch);
      later(CLEAR_AFTER_MS, () => {
        if (run === runs && s.phase === patch.phase) set({ phase: 'idle', done: 0, total: 0 });
      });
    };
    set({ phase: 'checking', done: 0, total: 0, message: '', list: [], startedAt: now() });

    // Remote switch, read on every Print. If application.yaml can't be reached, keep working.
    let enabled = true;
    try {
      enabled = await checkEnabled();
    } catch {
      // config unreachable: fail open
    }
    if (!enabled) return set({ phase: 'disabled' });
    if (stopRequested) return finish({ phase: 'stopped' });

    const options = readOptions(); // snapshot: later changes don't affect this run
    if (!isPrinterSet(options)) return set({ phase: 'idle', printerSet: false });
    let parts;
    try {
      parts = parseRange(input);
    } catch (e) {
      return set({ phase: 'badRange', printerSet: true, message: e.message, list: [] });
    }
    set({ printerSet: true });

    // After Stop no new search is sent; the one in flight finishes.
    const guardedSearch = (prefix) => (stopRequested ? Promise.reject(new Error('Stopped')) : search(prefix));
    let found;
    try {
      found = await findLocations(parts, guardedSearch);
    } catch (e) {
      if (stopRequested) return finish({ phase: 'stopped' });
      return set({ phase: 'error', message: `Search failed: ${e.message}`, list: [] });
    }
    if (found.duplicates.length) return set({ phase: 'error', message: 'Duplicate barcodes', list: found.duplicates });
    if (found.missing.length) return set({ phase: 'missing', message: `${found.missing.length} not found`, list: found.missing });

    const locs = found.locations;
    if (stopRequested) return finish({ phase: 'stopped', total: locs.length });
    set({ phase: 'printing', total: locs.length });
    for (let i = 0; i < locs.length; i++) {
      if (i > 0) await sleep(getDelayMs());
      if (stopRequested) return finish({ phase: 'stopped' });
      try {
        await print(locs[i].Id, options);
      } catch (e) {
        return set({ phase: 'failed', message: `Failed at ${locs[i].Barcode} (${i + 1}/${locs.length})`, list: [e.message] });
      }
      set({ done: i + 1 });
    }
    finish({ phase: 'done' });
  }

  function stop(force = false) {
    if (!running()) return;
    if (!force && now() - s.startedAt < STOP_GUARD_MS) return;
    stopRequested = true;
  }

  function refreshPrinter() {
    const printerSet = isPrinterSet(readOptions());
    if (printerSet !== s.printerSet) set({ printerSet });
  }

  return { start, stop, refreshPrinter, state: () => s };
}

function viewFor(s) {
  const run = s.phase === 'checking' || s.phase === 'printing';
  const view = (status, statusError = true, list = []) =>
    ({ fieldDisabled: run, button: run ? 'Stop' : 'Print', status, statusError, list });
  if (s.phase === 'checking') return view('Checking…', false);
  if (s.phase === 'printing') return view(`${s.done}/${s.total}`);
  if (s.phase === 'disabled') return view('Plugin disabled');
  if (!s.printerSet) return view('Printer is not set');
  if (s.phase === 'idle') return view('', false);
  if (s.phase === 'done') return view(`${s.done}/${s.total}`, false);
  if (s.phase === 'stopped') return view(s.total ? `Stopped ${s.done}/${s.total}` : 'Stopped', false);
  return view(s.message, true, s.list); // badRange, missing, error, failed
}

// ---------- Remote switch (application.yaml in the plugin's GitHub repo) ----------

const REPO_RAW = 'https://raw.githubusercontent.com/Dimoniada/peoplevox-plugin/main';
const CONFIG_URL = `${REPO_RAW}/application.yaml`;

// A top-level `enabled: false` switches the plugin off; anything else leaves it on.
function isEnabledYaml(text) {
  return !/^enabled[ \t]*:[ \t]*["']?(false|no|off)["']?[ \t]*(#.*)?$/im.test(String(text));
}

// GET a text file via Tampermonkey's request API, which the page's CSP and CORS rules don't block.
function fetchText(url) {
  const fresh = `${url}?t=${Date.now()}`; // skip caches so a switch-off applies at the next Print
  if (typeof GM_xmlhttpRequest !== 'function') {
    return fetch(fresh, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))));
  }
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: fresh,
      nocache: true,
      timeout: 5000,
      onload: (r) => (r.status === 200 ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`))),
      onerror: () => reject(new Error('Network error')),
      ontimeout: () => reject(new Error('Timeout')),
    });
  });
}

// ---------- Settings ----------

const SETTINGS_KEY = 'PVX_RangePrinter_Settings';
const DEFAULT_SETTINGS = { opacity: 0.9, theme: 'auto', color: '#1e1e1e', delayMs: 500 };
const clamp = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

function loadSettings(storage) {
  let raw = {};
  try {
    raw = JSON.parse(storage.getItem(SETTINGS_KEY)) || {};
  } catch {
    // corrupt value: fall back to defaults
  }
  return {
    opacity: clamp(raw.opacity, 0.3, 1, DEFAULT_SETTINGS.opacity),
    theme: ['auto', 'light', 'dark', 'color'].includes(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_SETTINGS.color,
    delayMs: Math.round(clamp(raw.delayMs, 0, 10000, DEFAULT_SETTINGS.delayMs)),
  };
}

function saveSettings(storage, settings) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Black or white text, whichever contrasts more with the background (WCAG luminance crossover).
function textColorFor(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';
}

// Auto theme: the first mostly-opaque background colour, walking from an element up to <html>.
function pickPageBackground(colors) {
  for (const c of colors) {
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(String(c).trim());
    if (!m) continue;
    const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
    if (alpha >= 0.5) return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  }
  return '#ffffff';
}

// ---------- Floating window (browser only) ----------

const WINDOW_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.frame { position: relative; box-sizing: border-box; width: 300px; max-width: calc(100vw - 16px);
  padding: 16px 14px 12px; border: 1.5px solid var(--line); border-radius: 14px; background: var(--bg);
  color: var(--fg); font: 14px/1.3 Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .35); cursor: move; touch-action: none;
  user-select: none; -webkit-user-select: none; }
.icon { position: absolute; top: 2px; display: flex; align-items: center; justify-content: center; width: 26px;
  height: 26px; padding: 0; border: 0; background: none; color: var(--fg); cursor: pointer; }
.icon svg { width: 16px; height: 16px; }
.close { right: 6px; }
.gear { right: 34px; }
.row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
input, select, button { font: inherit; color: var(--fg); }
.field { flex: 1; min-width: 0; box-sizing: border-box; height: 34px; padding: 0 8px; border: 1.5px solid var(--line);
  border-radius: 3px; background: var(--field); font-size: 16px; cursor: text; user-select: text; -webkit-user-select: text; }
.field:disabled { opacity: .6; }
.status { flex: 1; min-width: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-variant-numeric: tabular-nums; }
.status.error { color: var(--err); }
.go { min-width: 76px; height: 28px; padding: 0 12px; border: 1.5px solid var(--line); border-radius: 6px;
  background: var(--field); cursor: pointer; }
.list { margin: 8px 0 0; padding: 6px 8px 6px 24px; max-height: 8em; overflow: auto; border-radius: 4px;
  background: var(--field); color: var(--err); cursor: auto; touch-action: pan-y; user-select: text; -webkit-user-select: text; }
.settings { display: grid; grid-template-columns: minmax(0, 1fr) 128px; gap: 10px; align-items: center; margin-top: 18px; }
.settings input, .settings select, .settings button { width: 100%; box-sizing: border-box; margin: 0; }
.settings select, .settings input[type=number], .settings input[type=color] { height: 30px; padding: 0 4px;
  border: 1.5px solid var(--line); border-radius: 3px; background: var(--field); }
.settings input:disabled { opacity: .35; cursor: not-allowed; }
option { background: var(--solid); color: var(--fg); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #4da3ff; outline-offset: 1px; }
`;

const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/>'
  + '<path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">'
  + '<path d="M6 6l12 12M18 6L6 18"/></svg>';

const WINDOW_HTML = `
<div class="frame">
  <button class="icon gear" type="button" title="Settings" aria-label="Settings">${ICON_GEAR}</button>
  <button class="icon close" type="button" title="Close" aria-label="Close">${ICON_CLOSE}</button>
  <div class="main">
    <div class="row"><label for="range">Range:</label><input id="range" class="field" type="text"
      autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="HB6.B[1-10].L[3-9]"></div>
    <ul class="list" hidden></ul>
    <div class="row"><span class="status" role="status" aria-live="polite"></span><button class="go" type="button">Print</button></div>
  </div>
  <form class="settings" hidden>
    <label for="s-transparency">Transparency</label><input id="s-transparency" name="transparency" type="range" min="0" max="0.7" step="0.05">
    <label for="s-theme">Theme</label><select id="s-theme" name="theme"><option value="auto">Match page</option>
      <option value="light">Light</option><option value="dark">Dark</option><option value="color">Solid colour</option></select>
    <label for="s-color">Colour</label><input id="s-color" name="color" type="color">
    <label for="s-delay">Delay between printing, ms</label><input id="s-delay" name="delayMs" type="number" min="0" max="10000" step="50">
    <span></span><button class="go" type="submit">Save</button>
  </form>
</div>`;

function createWindow({ settings, onPrint, onStop, onClose, onSettings }) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:72px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${WINDOW_CSS}</style>${WINDOW_HTML}`;
  const $ = (sel) => root.querySelector(sel);
  const frame = $('.frame');
  const main = $('.main');
  const form = $('.settings');
  const input = $('#range');
  const go = $('.main .go');
  const status = $('.main .status');
  const list = $('.list');
  let current = settings;
  let view = { button: 'Print' };

  // What the page shows in the middle of the screen (ignoring this window).
  function pageColor() {
    const el = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).find((e) => e !== host);
    const colors = [];
    for (let e = el; e; e = e.parentElement) colors.push(getComputedStyle(e).backgroundColor);
    return pickPageBackground(colors);
  }

  function applySettings(s) {
    current = s;
    const bg = { color: s.color, light: '#ffffff', dark: '#141414' }[s.theme] || pageColor();
    const fg = textColorFor(bg);
    const [r, g, b] = hexToRgb(bg);
    const [fr, fgr, fb] = hexToRgb(fg);
    frame.style.setProperty('--bg', `rgba(${r},${g},${b},${s.opacity})`); // see-through background, solid text
    frame.style.setProperty('--fg', fg);
    frame.style.setProperty('--line', `rgba(${fr},${fgr},${fb},.75)`);
    frame.style.setProperty('--field', `rgba(${fr},${fgr},${fb},.06)`);
    frame.style.setProperty('--err', fg === '#ffffff' ? '#ff6b6b' : '#c62828');
    frame.style.setProperty('--solid', bg); // opaque, for the dropdown's item list
    frame.style.colorScheme = fg === '#ffffff' ? 'dark' : 'light'; // native popups and spinners follow the window
  }

  function render(v) {
    view = v;
    input.disabled = v.fieldDisabled;
    go.textContent = v.button;
    status.textContent = v.status;
    status.title = v.status;
    status.classList.toggle('error', v.statusError);
    list.hidden = !v.list.length;
    list.replaceChildren(...v.list.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  }

  go.addEventListener('click', () => (view.button === 'Stop' ? onStop() : onPrint(input.value)));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go.click();
  });
  $('.close').addEventListener('click', () => onClose());
  $('.gear').addEventListener('click', () => {
    const opening = form.hidden;
    if (opening) {
      const f = form.elements;
      f.transparency.value = String(Math.round((1 - current.opacity) * 100) / 100);
      f.theme.value = current.theme;
      f.color.value = current.color;
      f.delayMs.value = String(current.delayMs);
      syncColorPicker();
    }
    form.hidden = !opening;
    main.hidden = opening;
  });
  // The colour only applies to "Solid colour".
  const syncColorPicker = () => {
    form.elements.color.disabled = form.elements.theme.value !== 'color';
  };
  form.elements.theme.addEventListener('change', syncColorPicker);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    onSettings({
      opacity: Math.round((1 - Number(f.transparency.value)) * 100) / 100,
      theme: f.theme.value,
      color: f.color.value,
      delayMs: Number(f.delayMs.value),
    });
    form.hidden = true;
    main.hidden = false;
  });

  // Drag by any part that isn't a control; mouse and touch via pointer events.
  function place(x, y) {
    const r = host.getBoundingClientRect();
    host.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width))}px`;
    host.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height))}px`;
    host.style.right = 'auto';
  }
  frame.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('input, button, select, textarea, .list')) return;
    const r = host.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    frame.setPointerCapture(e.pointerId);
    const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const end = () => {
      frame.removeEventListener('pointermove', move);
      frame.removeEventListener('pointerup', end);
      frame.removeEventListener('pointercancel', end);
    };
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', end);
    frame.addEventListener('pointercancel', end);
    e.preventDefault();
  });
  window.addEventListener('resize', () => {
    if (host.style.left) place(parseFloat(host.style.left), parseFloat(host.style.top));
  });

  applySettings(settings);
  document.body.appendChild(host);
  return {
    render,
    applySettings,
    show: () => { host.style.display = ''; },
    hide: () => { host.style.display = 'none'; },
    isShown: () => host.style.display !== 'none',
  };
}

// ---------- Wiring ----------

const isLocationsPage = (pathname) => /^\/rkb4952\/ui\/warehouse\/locations\/?$/.test(pathname);

function main() {
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  // The page's own fetch: same origin and session cookie, even inside Firefox's userscript sandbox,
  // where the options object must be cloned into the page before the page's fetch may read it.
  const pageFetch = (url, init) => pageWindow.fetch(url, typeof cloneInto === 'function' ? cloneInto(init, pageWindow) : init);
  let settings = loadSettings(localStorage);
  let closed = false; // × keeps the window hidden until a full reload or the menu command
  let win = null;

  const job = createJob({
    search: (prefix) => searchLocations(prefix, pageFetch),
    print: (id, options) => printLocation(id, options, pageFetch),
    readOptions: () => readPrintOptions(localStorage),
    getDelayMs: () => settings.delayMs,
    checkEnabled: async () => isEnabledYaml(await fetchText(CONFIG_URL)),
    onChange: (s) => win && win.render(viewFor(s)),
  });
  win = createWindow({
    settings,
    onPrint: (input) => job.start(input),
    onStop: () => job.stop(),
    onClose: () => {
      job.stop(true);
      win.hide();
      closed = true;
    },
    onSettings: (s) => {
      saveSettings(localStorage, s);
      settings = loadSettings(localStorage);
      win.applySettings(settings);
    },
  });
  win.render(viewFor(job.state()));

  // Peoplevox is a single-page app: follow URL changes and the saved printer by polling.
  const sync = () => {
    if (!isLocationsPage(location.pathname)) {
      job.stop(true);
      win.hide();
    } else if (!closed) {
      win.show();
    }
    job.refreshPrinter();
    if (settings.theme === 'auto' && win.isShown()) win.applySettings(settings); // follow the page's colours
  };
  sync();
  setInterval(sync, 1000);
  window.addEventListener('storage', (e) => {
    if (e.key === OPTIONS_KEY) job.refreshPrinter();
  });
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Show Range Printer', () => {
      closed = false;
      sync();
    });
  }
}

if (typeof window === 'undefined') {
  module.exports = {
    parseRange, expandParts, findLocations,
    searchLocations, printLocation, readPrintOptions, isPrinterSet, OPTIONS_KEY,
    createJob, viewFor,
    loadSettings, saveSettings, textColorFor, SETTINGS_KEY,
    isLocationsPage, WINDOW_CSS, WINDOW_HTML, pickPageBackground, isEnabledYaml,
  };
} else {
  main();
}
