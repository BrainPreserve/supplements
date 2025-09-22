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

function asBool(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ['1','true','yes','y','x','✓'].includes(s);
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

fetch('data/master.csv')
  .then(r => r.text())
  .then(text => {
    const rows = parseCSV(text);
    const headers = rows.shift();

    DATA = rows
      .filter(r => r.length === headers.length)
      .map(r => {
        const obj = {}
        headers.forEach((h,i)=> obj[h] = r[i] ?? '');
        return obj;
      });

    els.status.textContent = 'Ready. Type or choose indications to filter.';
  })
  .catch(err => {
    console.error(err);
    els.status.textContent = 'Error loading CSV. Ensure data/master.csv is present.';
  });

els.search.addEventListener('input', applyFilters);
els.reset.addEventListener('click', () => {
  els.search.value='';
  els.boxes.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  els.results.innerHTML = '';
  els.status.textContent = 'Cleared. Type or choose indications to begin.';
});
els.boxes.addEventListener('change', applyFilters);

function applyFilters() {
  const q = els.search.value.trim().toLowerCase();
  const activeFlags = Array.from(els.boxes.querySelectorAll('input[type=checkbox]'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  if (!q && activeFlags.length === 0) {
    els.results.innerHTML = '';
    els.status.textContent = 'Type at least 1 letter or choose an indication to begin.';
    return;
  }

  const nameCol = CONFIG.nameCol;
  const aliasCol = CONFIG.aliasCol;

  FILTERED = DATA.filter(row => {
    let matchesSearch = true;
    if (q) {
      const name = String(row[nameCol]||'').toLowerCase();
      const alias = aliasCol ? String(row[aliasCol]||'').toLowerCase() : '';
      matchesSearch = (name.startsWith(q)) || alias.split(/[;,]/).some(a => a.trim().startsWith(q));
    }

    let matchesFlags = true;
    if (activeFlags.length) {
      matchesFlags = activeFlags.every(flag => asBool(row[flag]));
    }

    return matchesSearch && matchesFlags;
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

  const nameCol = CONFIG.nameCol;
  const flagCols = CONFIG.flagCols;

  FILTERED.forEach(row => {
    const name = row[nameCol] || '(Unnamed)';

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

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>${escapeHTML(name)}</h3>
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
