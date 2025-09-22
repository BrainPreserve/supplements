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
  return String(s).split(/[;,]/).map(t => t.trim()).filter(Boolean);
}
// Make supplement_key user friendly (snake_case → Title Case; Vitamin Bn; Dn; Kn; CoQ10)
function prettifyKey(key) {
  if (!key) return '';
  let s = String(key).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(vitamin)\s*b\s*([0-9]+)$/i, (_, vit, num) => `${cap(vit)} B${num}`);
  s = s.replace(/^(vitamin)\s*d\s*([0-9])$/i, (_, vit, num) => `${cap(vit)} D${num}`);
  s = s.replace(/^(vitamin)\s*k\s*([0-9])$/i, (_, vit, num) => `${cap(vit)} K${num}`);
  s = s.replace(/\bcoq\s*10\b/i, 'CoQ10');
  s = s.split(' ').map(w => /^[bdk]\d+$/i.test(w) ? w.toUpperCase()
                            : /^\d+$/.test(w) ? w
                            : w.toLowerCase()==='and' ? 'and'
                            : w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  return s;
}
function vitaminRegexFromQuery(q) {
  const m = String(q).trim().match(/^(?:vitamin\s*)?([bdk])[-\s]?(\d{1,2})$/i);
  if (!m) return null;
  const letter = m[1]; const num = m[2];
  return new RegExp(`\\b(?:vitamin\\s*)?${letter}[-\\s]?${num}\\b`, 'i');
}
function isVitaminLetterMatch(text, letter) {
  const t = String(text || '').toLowerCase();
  const L = letter.toLowerCase();
  if (L === 'b') return /\bvitamin\s*b(\b|[-\s]?\d{1,2}\b)/i.test(t) || /\bb[-\s]?\d{1,2}\b/i.test(t);
  if (L === 'c') return /\bvitamin\s*c\b/i.test(t);
  if (L === 'd') return /\bvitamin\s*d(\b|[-\s]?\d\b)/i.test(t) || /\bd[-\s]?\d\b/i.test(t);
  if (L === 'e') return /\bvitamin\s*e\b/i.test(t);
  if (L === 'k') return /\bvitamin\s*k(\b|[-\s]?\d\b)/i.test(t) || /\bk[-\s]?\d\b/i.test(t);
  return false;
}
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
function cap(s){ s=String(s||''); return s.charAt(0).toUpperCase()+s.slice(1); }

// Evidence tiering + score
function evidenceTier(val) {
  const s = String(val || '').toLowerCase();
  if (!s) return {tier:'preliminary', score:0, label:'Preliminary'};
  if (/meta[-\s]?analysis|systematic/.test(s)) return {tier:'strong', score:3, label:'Strong'};
  if (/strong|high|grade\s*a/.test(s)) return {tier:'strong', score:3, label:'Strong'};
  if (/moderate|grade\s*b/.test(s)) return {tier:'moderate', score:2, label:'Moderate'};
  if (/limited|mixed|low|grade\s*c/.test(s)) return {tier:'preliminary', score:1, label:'Preliminary'};
  return {tier:'preliminary', score:1, label:'Preliminary'};
}
function evidenceChipClass(tier){
  return tier==='strong' ? 'chip-strong' : tier==='moderate' ? 'chip-moderate' : 'chip-prelim';
}
// Cost banding
function costBand(val){
  const s = String(val||'').trim();
  if (!s) return {band:'', label:''};
  if (/\${2,3}/.test(s)) return {band: s.includes('$$$')?'$$$':'$$', label: s.includes('$$$')?'$$$':'$$'};
  const m = s.replace(/[, ]/g,'').match(/(\d+(\.\d+)?)/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!isNaN(n)) return {band: n<20?'$':(n<=50?'$$':'$$$'), label: n<20?'$':(n<=50?'$$':'$$$')};
  }
  return {band:'$', label:'$'};
}

// Monitoring plan mapping
function monitoringFromFlags(row, selectedFlags) {
  const f = new Set(selectedFlags && selectedFlags.length ? selectedFlags : Object.keys(row).filter(k=>/_flag$/.test(k)&&asBool(row[k])));
  const items = [];
  if (f.has('sleep_flag')) items.push('Sleep diary; latency; awakenings; wearable sleep efficiency.');
  if (f.has('metabolic_flag')) items.push('CGM mean & variability; post-prandial peaks.');
  if (f.has('cardiovascular_flag')) items.push('Home/ABPM BP variability; morning BP trend; resting HR.');
  if (f.has('anti_inflammatory_flag')) items.push('Symptom logs (pain/stiffness); hs-CRP if available.');
  // Cognition not a flag column; infer from direct/indirect benefits mentioning cognition
  const dir = String(row['direct_cognitive_benefits']||'').toLowerCase();
  const indir = String(row['indirect_cognitive_benefits']||'').toLowerCase();
  if (dir.includes('cognit') || indir.includes('cognit')) {
    items.push('Subjective clarity; simple recall task; caregiver feedback (as applicable).');
  }
  if (!items.length) items.push('Track primary symptom(s) and general well-being weekly.');
  return items;
}

// Safety line via keyword triggers
function safetyLine(risks) {
  const s = String(risks||'').toLowerCase();
  if (!s) return '';
  const triggers = [];
  if (/(anticoagulant|warfarin|bleed)/.test(s)) triggers.push('anticoagulants/bleeding risk');
  if (/(arrhythm|qt|tachy|brady)/.test(s)) triggers.push('cardiac rhythm concerns');
  if (/(pregnan|lactat)/.test(s)) triggers.push('pregnancy/lactation');
  if (/(ssri|snri|maoi|bipolar)/.test(s)) triggers.push('psychiatric meds/conditions');
  if (/(sedat|insomni|stimul)/.test(s)) triggers.push('sedation/insomnia effects');
  if (!triggers.length) return '';
  return `Seek clinician input if ${triggers.join(', ')} present.`;
}

// Compose mechanism sentence (brief)
function mechanismSentence(mech) {
  const s = String(mech||'').trim();
  if (!s) return '';
  // take first clause up to ~140 chars
  const cut = s.split(/[\.\;]/)[0].slice(0,140).trim();
  return cut ? `${cut.endsWith('.')?cut:cut+'.'}` : '';
}

const CONFIG = window.__APP_CONFIG__;
let DATA = [];
let FILTERED = [];

const els = {
  search: document.getElementById('search'),
  results: document.getElementById('results'),
  status: document.getElementById('status'),
  reset: document.getElementById('resetBtn'),
  boxes: document.getElementById('indication-boxes'),
  evidenceFilter: document.getElementById('evidenceFilter'),
  sortBy: document.getElementById('sortBy'),
  coach: document.getElementById('coach')
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
['input','change'].forEach(ev => els.search.addEventListener(ev, applyFilters));
els.reset.addEventListener('click', () => {
  els.search.value='';
  els.boxes.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  els.evidenceFilter.value = 'all';
  els.sortBy.value = 'evidence';
  els.results.innerHTML = '';
  els.coach.innerHTML = ''; els.coach.style.display='none';
  els.status.textContent = 'Cleared. Type or choose indications to begin.';
});
els.boxes.addEventListener('change', applyFilters);
els.evidenceFilter.addEventListener('change', applyFilters);
els.sortBy.addEventListener('change', applyFilters);

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

  const mechCol = CONFIG.mechanismCol;

  // Stage 1: text + flags
  let rows = DATA.filter(row => {
    const key = String(row[CONFIG.keyCol] || '');
    const name = String(row[CONFIG.nameCol] || '');
    const prettyKey = prettifyKey(key);
    const aliases = splitAliases(row[CONFIG.aliasCol]);
    const mech = String(row[mechCol] || '');

    const keyL = key.toLowerCase();
    const nameL = name.toLowerCase();
    const prettyL = prettyKey.toLowerCase();
    const aliasL = aliases.map(a => a.toLowerCase());
    const mechL = mech.toLowerCase();

    // Text match
    let textMatch = true;
    if (q) {
      if (isVitaminLetterQuery) {
        const combined = [keyL, nameL, prettyL, ...aliasL].join(' | ');
        textMatch = isVitaminLetterMatch(combined, q);
      } else if (isSingleLetter) {
        textMatch = activeFlags.length > 0 ? true : false;
      } else {
        textMatch =
          startsWithSafe(nameL, q) ||
          startsWithSafe(keyL, q) ||
          startsWithSafe(prettyL, q) ||
          aliasL.some(a => startsWithSafe(a, q)) ||
          (q.length >= 2 && mechL.includes(q)); // mechanism substring for ≥2 chars

        if (!textMatch && vitRx) {
          const combined = [keyL, nameL, prettyL, ...aliasL].join(' | ');
          textMatch = vitRx.test(combined);
        }
      }
    }

    // Indication flags (all selected must be true)
    let flagsOK = true;
    if (activeFlags.length) {
      flagsOK = activeFlags.every(flag => asBool(row[flag]));
    }

    return textMatch && flagsOK;
  });

  // Stage 2: evidence filter
  const evFilter = els.evidenceFilter.value; // all|strong|moderate|preliminary
  if (evFilter !== 'all') {
    rows = rows.filter(r => evidenceTier(r['level_of_evidence']).tier === evFilter);
  }

  // Stage 3: sort
  const sortMode = els.sortBy.value; // evidence|az
  rows.sort((a,b) => {
    if (sortMode === 'az') {
      const A = prettifyKey(a[CONFIG.keyCol]||'').toLowerCase();
      const B = prettifyKey(b[CONFIG.keyCol]||'').toLowerCase();
      return A.localeCompare(B);
    } else {
      const ea = evidenceTier(a['level_of_evidence']).score;
      const eb = evidenceTier(b['level_of_evidence']).score;
      if (eb !== ea) return eb - ea; // high → low
      const A = prettifyKey(a[CONFIG.keyCol]||'').toLowerCase();
      const B = prettifyKey(b[CONFIG.keyCol]||'').toLowerCase();
      return A.localeCompare(B);
    }
  });

  FILTERED = rows;
  renderResults(q, activeFlags);
}

function renderResults(q, activeFlags) {
  els.results.innerHTML = '';
  els.coach.innerHTML = ''; els.coach.style.display='none';

  if (!FILTERED.length) {
    els.status.textContent = 'No matches. Adjust your search or indications.';
    return;
  }
  els.status.textContent = FILTERED.length + ' match' + (FILTERED.length===1?'':'es') + '.';

  // Top coaching summary for current selection
  els.coach.innerHTML = coachingPanelHTML(q, activeFlags, FILTERED);
  els.coach.style.display = 'block';

  const flagCols = CONFIG.flagCols;

  FILTERED.forEach(row => {
    const key = String(row[CONFIG.keyCol] || '');
    const name = String(row[CONFIG.nameCol] || '');
    const prettyKey = prettifyKey(key);
    const aliases = splitAliases(row[CONFIG.aliasCol]);

    const ev = evidenceTier(row['level_of_evidence']);
    const cost = costBand(row['approx_cost']);

    const badges = flagCols.filter(fc => asBool(row[fc]))
      .map(fc => (fc.replace('_flag','').replaceAll('_',' ')))
      .map(s => s[0].toUpperCase()+s.slice(1));

    const detailKVs = CONFIG.detailCols.map(k => kv(k, row[k]));
    const brandKVs  = CONFIG.brandCols.map(k => kv(k, row[k]));

    // Indication text
    let indText = '';
    if (window.__APP_CONFIG__.indicationsDisplayCol && row[window.__APP_CONFIG__.indicationsDisplayCol]) {
      indText = String(row[window.__APP_CONFIG__.indicationsDisplayCol]);
    } else {
      indText = badges.join(', ') || 'None flagged';
    }

    // Subtitle (name + aliases if present/different)
    const subtitleParts = [];
    if (name && name.toLowerCase() !== prettyKey.toLowerCase()) subtitleParts.push(name);
    if (aliases.length) subtitleParts.push(`Aliases: ${aliases.join(', ')}`);
    const subtitleHTML = subtitleParts.length
      ? `<div class="subhead">${escapeHTML(subtitleParts.join(' • '))}</div>`
      : '';

    // ===== Coach Summary (inside Details) =====
    const mechSentence = mechanismSentence(row['mechanisms']);
    const protocol = ev.tier==='strong' ? 'Plan a 8–12 week trial.'
                  : ev.tier==='moderate' ? 'Plan a 6–8 week trial.'
                  : 'Plan a 4–6 week trial (after foundational behaviors).';
    const monitorList = monitoringFromFlags(row, activeFlags)
      .map(x => `<li>${escapeHTML(x)}</li>`).join('');
    const doseLine = String(row['suggested_dosage']||'').trim()
      ? `Suggested dosage: ${escapeHTML(row['suggested_dosage'])}.`
      : 'Use label-directed dosing; escalate cautiously as tolerated.';
    const safety = safetyLine(row['potential_risks']);

    const evidenceSentence = ev.tier==='strong'
      ? 'Evidence signal: Strong (higher-quality studies and/or meta-analyses).'
      : ev.tier==='moderate'
        ? 'Evidence signal: Moderate (promising human evidence).'
        : 'Evidence signal: Preliminary (early/mixed evidence).';

    const coachSummaryHTML = `
      <ul class="tight">
        <li>${evidenceSentence}</li>
        ${mechSentence?`<li>Mechanistic rationale: ${escapeHTML(mechSentence)}</li>`:''}
        <li>${protocol}</li>
        <li>Monitoring plan:</li>
        <ul class="tight">${monitorList}</ul>
        <li>${doseLine}</li>
        ${safety?`<li><strong>Safety:</strong> ${escapeHTML(safety)}</li>`:''}
      </ul>
    `;

    // ===== “When it helps / When to pause” (inside Indications) =====
    const whenHelps = badges.length
      ? `Most relevant when the priority includes: ${badges.join(', ')}.`
      : 'Relevance depends on the primary objective selected.';
    const pauseLine = (ev.tier==='preliminary' ? 'Not a first-line choice when evidence is preliminary; optimize diet, sleep, and activity first. ' : '')
                    + (safety ? `Consider deferring or seeking clearance: ${safety}` : '');
    const helpsPauseHTML = `
      <div class="kv"><div class="label">When it helps</div><div class="val">${escapeHTML(whenHelps)}</div></div>
      ${pauseLine?`<div class="kv"><div class="label">When to pause</div><div class="val">${escapeHTML(pauseLine)}</div></div>`:''}
    `;

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>
        ${escapeHTML(prettyKey)}
        <span class="chip ${evidenceChipClass(ev.tier)}" title="Level of evidence">${ev.label}</span>
        ${cost.label?`<span class="chip chip-cost" title="Approx. cost">${escapeHTML(cost.label)}</span>`:''}
      </h3>
      ${subtitleHTML}
      <div class="badges">${badges.map(b => `<span class="badge">${escapeHTML(b)}</span>`).join('')} </div>
      <div class="sections">
        ${box('Details', [coachSummaryHTML, ...detailKVs], true)}
        ${box('Recommended brands', brandKVs, true)}
        ${box('Indications', `
            <div class="kv"><div class="label">For</div><div class="val">${escapeHTML(indText)}</div></div>
            ${helpsPauseHTML}
          `, false)}
      </div>
    `;
    els.results.appendChild(card);
  });
}

// ===== Coaching summary panel (top of page) =====
function coachingPanelHTML(q, flags, rows) {
  const hasQuery = !!(q && q.trim());
  const flagNames = flags.map(f => f.replace('_flag','').replaceAll('_',' ')).map(cap);
  const n = rows.length;

  const ranked = rows
    .map(r => ({ row:r, ev: evidenceTier(r['level_of_evidence']) }))
    .sort((a,b)=> b.ev.score - a.ev.score)
    .slice(0,3);
  const picks = ranked.map(o => prettifyKey(String(o.row[CONFIG.keyCol]||''))).filter(Boolean);

  const risky = rows.filter(r => String(r['potential_risks']||'').trim()).length;
  const dosage = rows.filter(r => String(r['suggested_dosage']||'').trim()).length;

  const bullets = [];
  bullets.push(`<li><strong>${n}</strong> option${n===1?'':'s'} match your current inputs${hasQuery || flags.length ? '' : ' (broad search)'}.</li>`);
  if (flagNames.length) bullets.push(`<li>Goal(s) selected: <strong>${escapeHTML(flagNames.join(', '))}</strong>.</li>`);
  if (picks.length) bullets.push(`<li>Top evidence: <strong>${escapeHTML(picks.join(', '))}</strong>.</li>`);
  if (dosage) bullets.push(`<li>${dosage} item${dosage===1?'':'s'} include dose guidance; titrate cautiously.</li>`);
  if (risky) bullets.push(`<li>${risky} item${risky===1?'':'s'} list potential risks—screen for interactions.</li>`);
  bullets.push(`<li>Introduce one agent at a time; reassess within 2–4 weeks for tolerability and signal.</li>`);

  return box('Coaching Summary', `<ul class="tight">${bullets.join('\n')}</ul>`, false);
}

// ===== UI primitives =====
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
function escapeHTML(s){ return String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'})[c]); }
