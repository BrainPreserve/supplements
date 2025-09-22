// ===== CSV parsing (RFC4180-ish) =====
function parseCSV(text) {
  const rows = [];
  let i=0, field='', row=[], inQuotes=false;
  const pushField = () => { row.push(field); field=''; };
  const pushRow = () => { rows.push(row); row=[]; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') pushField();
      else if (c === '\r') { /* ignore */ }
      else if (c === '\n') { pushField(); pushRow(); }
      else { field += c; }
    }
    i++;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return rows;
}

// ===== Helpers =====
function asBool(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ['1','true','yes','y','x','✓'].includes(s);
}

function splitAliases(s) {
  if (!s) return [];
  return String(s)
    .split(/[;,]/)
    .map(t => t.trim())
    .filter(Boolean);
}

// Make supplement_key user friendly (snake_case → Title Case; Vitamin Bn; CoQ10)
function prettifyKey(key) {
  if (!key) return '';
  let s = String(key).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  // Vitamin Bn canonicalization
  s = s.replace(/^(vitamin)\s*b\s*([0-9]+)$/i, (_, vit, num) =>
    `${vit[0].toUpperCase() + vit.slice(1).toLowerCase()} B${num}`
  );

  // Dn/Kn (e.g., d3, k2) canonicalization if present as key tokens
  s = s.replace(/^(vitamin)\s*d\s*([0-9])$/i, (_, vit, num) =>
    `${vit[0].toUpperCase() + vit.slice(1).toLowerCase()} D${num}`
  );
  s = s.replace(/^(vitamin)\s*k\s*([0-9])$/i, (_, vit, num) =>
    `${vit[0].toUpperCase() + vit.slice(1).toLowerCase()} K${num}`
  );

  // CoQ10 normalization
  s = s.replace(/\bcoq\s*10\b/i, 'CoQ10');

  // Title case words; keep B12/D3/K2 tokens uppercase
  s = s.split(' ').map(w => {
    if (/^[bdk]\d+$/i.test(w)) return w.toUpperCase();
    if (/^\d+$/.test(w)) return w;
    if (w.toLowerCase() === 'and') return 'and';
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');

  return s;
}

// Vitamin code like "B12","D3","K2" from a query
function vitaminRegexFromQuery(q) {
  const m = String(q).trim().match(/^(?:vitamin\s*)?([bdk])[-\s]?(\d{1,2})$/i);
  if (!m) return null;
  const letter = m[1];
  const num = m[2];
  return new RegExp(`\\b(?:vitamin\\s*)?${letter}[-\\s]?${num}\\b`, 'i');
}

// Single-letter vitamin filters: "B", "C", "D", "E", "K"
function isVitaminLetterMatch(text, letter) {
  const t = String(text || '').toLowerCase();
  const L = letter.toLowerCase();
  if (L === 'b') {
    // vitamin b, vitamin b1..b12, b1..b12
    return /\bvitamin\s*b(\b|[-\s]?\d{1,2}\b)/i.test(t) || /\bb[-\s]?\d{1,2}\b/i.test(t);
  }
  if (L === 'c') {
    return /\bvitamin\s*c\b/i.test(t);
  }
  if (L === 'd') {
    return /\bvitamin\s*d(\b|[-\s]?\d\b)/i.test(t) || /\bd[-\s]?\d\b/i.test(t);
  }
  if (L === 'e') {
    return /\bvitamin\s*e\b/i.test(t);
  }
  if (L === 'k') {
    return /\bvitamin\s*k(\b|[-\s]?\d\b)/i.test(t) || /\bk[-\s]?\d\b/i.test(t);
  }
  return false;
}

// Safe prefix (prevents "b1" from matching "b12")
function startsWithSafe(candidate, q) {
  if (!candidate || !q) return false;
  if (!candidate.startsWith(q)) return false;
  const last = q[q.length - 1];
  if (/\d/.test(last)) {
    const nextChar = candidate[q.length] || '';
    if (/\d/.test(nextChar)) return false;
  }
  return true;
}

const CONFIG = window.__APP_CONFIG__;
let DATA = [];
let FILTERED = [];

const els = {
  search: document.getElementById('search'),
  results: document.getElementById('results'),
  status: document.getElementById('status'),
  reset: document.getElementById('resetBtn'),
  boxes: document.getElementById('indication-boxes')
};

// ===== Load CSV =====
fetch('data/master.csv')
  .then(r => r.text())
  .then(text => {
    const rows = parseCSV(text);
    const headers = rows.shift();
    DATA = rows
      .filter(r => r.length === headers.length)
      .map(r => {
        const obj = {};
        headers.forEach((h,i)=> obj[h] = r[i] ?? '');
        return obj;
      });
    els.status.textContent = 'Ready. Type or choose indications to filter.';
  })
  .catch(err => {
    console.error(err);
    els.status.textContent = 'Error loading CSV. Ensure data/master.csv is present.';
  });

// ===== Events =====
els.search.addEventListener('input', applyFilters);
els.reset.addEventListener('click', () => {
  els.search.value='';
  els.boxes.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  els.results.innerHTML = '';
  els.status.textContent = 'Cleared. Type or choose indications to begin.';
});
els.boxes.addEventListener('change', applyFilters);

// ===== Filtering & Rendering =====
function applyFilters() {
  const qraw = els.search.value || '';
  const q = qraw.trim().toLowerCase();

  const activeFlags = Array.from(els.boxes.querySelectorAll('input[type=checkbox]'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const isSingleLetter = q.length === 1;
  const vitaminLetters = new Set(['b','c','d','e','k']);
  const isVitaminLetterQuery = isSingleLetter && vitaminLetters.has(q);
  const vitRx = vitaminRegexFromQuery(q);

  if (!q && activeFlags.length === 0) {
    els.results.innerHTML = '';
    els.status.textContent = 'Type at least 1 letter or choose an indication to begin.';
    return;
  }

  FILTERED = DATA.filter(row => {
    // ----- Build search fields -----
    const key = String(row[CONFIG.keyCol] || '');
    const name = String(row[CONFIG.nameCol] || '');
    const prettyKey = prettifyKey(key);
    const aliases = splitAliases(row[CONFIG.aliasCol]);

    const keyL = key.toLowerCase();
    const nameL = name.toLowerCase();
    const prettyL = prettyKey.toLowerCase();
    const aliasL = aliases.map(a => a.toLowerCase());

    // ----- Text match -----
    let textMatch = true;

    if (q) {
      if (isVitaminLetterQuery) {
        // Only vitamins for that letter; exclude non-vitamin items that merely start with the letter
        const combined = [keyL, nameL, prettyL, ...aliasL].join(' | ');
        textMatch = isVitaminLetterMatch(combined, q);
      } else if (isSingleLetter) {
        // Single non-vitamin letter is too broad; require flags or >=2 chars
        // If flags are selected, we allow this to pass (filtering by flags only)
        textMatch = activeFlags.length > 0 ? true : false;
      } else {
        // Standard prefix match across multiple fields
        textMatch =
          startsWithSafe(nameL, q) ||
          startsWithSafe(keyL, q) ||
          startsWithSafe(prettyL, q) ||
          aliasL.some(a => startsWithSafe(a, q));

        // Vitamin code like "B12", "D3", "K2"
        if (!textMatch && vitRx) {
          const combined = [keyL, nameL, prettyL, ...aliasL].join(' | ');
          textMatch = vitRx.test(combined);
        }
      }
    }

    // ----- Flags: all selected must be true -----
    let flagsOK = true;
    if (activeFlags.length) {
      flagsOK = activeFlags.every(flag => asBool(row[flag]));
    }

    return textMatch && flagsOK;
  });

  renderResults();
}

function renderResults() {
  els.results.innerHTML = '';
  if (!FILTERED.length) {
    els.status.textContent = 'No matches. Adjust your search or indications.';
    return;
  }
  els.status.textContent = FILTERED.length + ' match' + (FILTERED.length===1?'':'es') + '.';

  const flagCols = CONFIG.flagCols;

  FILTERED.forEach(row => {
    const key = String(row[CONFIG.keyCol] || '');
    const name = String(row[CONFIG.nameCol] || '');
    const prettyKey = prettifyKey(key);
    const aliases = splitAliases(row[CONFIG.aliasCol]);

    const badges = flagCols.filter(fc => asBool(row[fc]))
      .map(fc => (fc.replace('_flag','').replaceAll('_',' ')))
      .map(s => s[0].toUpperCase()+s.slice(1));

    const detailKVs = CONFIG.detailCols.map(k => kv(k, row[k]));
    const brandKVs  = CONFIG.brandCols.map(k => kv(k, row[k]));

    let indText = '';
    if (window.__APP_CONFIG__.indicationsDisplayCol && row[window.__APP_CONFIG__.indicationsDisplayCol]) {
      indText = String(row[window.__APP_CONFIG__.indicationsDisplayCol]);
    } else {
      indText = badges.join(', ') || 'None flagged';
    }

    const subtitleParts = [];
    if (name && name.toLowerCase() !== prettyKey.toLowerCase()) subtitleParts.push(name);
    if (aliases.length) subtitleParts.push(`Aliases: ${aliases.join(', ')}`);
    const subtitleHTML = subtitleParts.length
      ? `<div class="subhead" style="color:var(--muted);font-size:13px;">${escapeHTML(subtitleParts.join(' • '))}</div>`
      : '';

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>${escapeHTML(prettyKey)}</h3>
      ${subtitleHTML}
      <div class="badges">${badges.map(b => `<span class="badge">${escapeHTML(b)}</span>`).join('')} </div>
      <div class="sections">
        ${box('Details', detailKVs, true)}
        ${box('Recommended brands', brandKVs, true)}
        ${box('Indications', `<div class="kv"><div class="label">For:</div><div class="val">${escapeHTML(indText)}</div></div>`)}
      </div>
    `;
    els.results.appendChild(card);
  });
}

function kv(label, value) {
  if (!label) return '';
  const pretty = label.replaceAll('_',' ').replace(/\b\w/g, m=>m.toUpperCase());
  let val = (value ?? '').toString().trim();
  if (/^https?:\/\//i.test(val)) {
    val = `<a class="source-link" href="${val}" target="_blank" rel="noopener">Source link</a>`;
  } else if (!val) {
    val = '<span class="muted">—</span>';
  } else {
    val = escapeHTML(val);
  }
  return `<div class="kv"><div class="label">${escapeHTML(pretty)}</div><div class="val">${val}</div></div>`;
}

function box(title, inner, compact) {
  const content = Array.isArray(inner) ? inner.join('\n') : inner;
  return `<details class="box"${compact?'':' open'}>
    <summary><span>${escapeHTML(title)}</span><span class="chev">▸</span></summary>
    <div class="content">${content}</div>
  </details>`;
}

function escapeHTML(s){
  return String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'})[c]);
}
