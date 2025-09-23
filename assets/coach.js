
// coach.js — Non-destructive add-on for GPT-like coaching summaries
// This script *does not* change how your CSV is loaded or how filtering works.
// It only *adds* summaries above each supplement panel and a group summary
// above the list, using the data already rendered from your master.csv.

(function(){
  // --- Helpers ---
  function qs(sel, root=document){ return root.querySelector(sel); }
  function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function text(el){ return (el && el.textContent || '').trim(); }
  function htmlEscape(s){ return String(s||'').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'})[c]); }

  function deriveTier(levelText){
    const s = String(levelText||'').toLowerCase();
    if (!s) return 'Unspecified';
    if (s.includes('meta') || s.includes('systematic')) return 'Strong';
    if (s.includes('multiple rct') || s.includes('large rct')) return 'Strong';
    if (s.includes('rct') || s.includes('randomized')) return 'Moderate';
    if (s.includes('pilot') || s.includes('open-label') || s.includes('case') || s.includes('animal') || s.includes('preliminary')) return 'Preliminary';
    if (s.includes('speculative') || s.includes('mechanistic')) return 'Speculative';
    return 'Preliminary';
  }

  function trialWindow(tier){
    switch (tier){
      case 'Strong': return '8–12 weeks';
      case 'Moderate': return '6–8 weeks';
      case 'Preliminary': return '4–6 weeks';
      case 'Speculative': return '2–4 weeks';
      default: return '4–6 weeks';
    }
  }

  function collectKVMap(detailsBox){
    // detailsBox contains .kv rows with two divs: .label and .val
    const map = {};
    qsa('.kv', detailsBox).forEach(row => {
      const label = text(qs('.label', row)).toLowerCase();
      const valHtml = qs('.val', row);
      // Accept links and rich text
      const val = valHtml ? valHtml.innerHTML.trim() : '';
      if (label) map[label] = val;
    });
    return map;
  }

  function buildCoachSummaryFromCard(card){
    const name = text(qs('h3', card));
    const boxes = qsa('.box', card);
    const details = boxes.find(b => /<span>Details<\/span>/.test(b.querySelector('summary')?.innerHTML||''));
    const brands  = boxes.find(b => /Recommended brands/i.test(b.querySelector('summary')?.textContent||''));

    if (!details) return ''; // fail safe

    const kv = collectKVMap(details);
    const levelText = kv['level of evidence'] || '';
    const tier = deriveTier(levelText);
    const dose = kv['suggested dosage'] || '';
    const mechanisms = kv['mechanisms'] || '';
    const dir = kv['direct cognitive benefits'] || '';
    const indir = kv['indirect cognitive benefits'] || '';
    const risks = kv['potential risks'] || '';

    // From recommended brands, try to pull "why_top_choice" and "recommended_brand"
    let why = '', brand = '';
    if (brands){
      const kvb = collectKVMap(brands);
      why = kvb['why top choice'] || '';
      brand = kvb['recommended brand'] || '';
    }

    const trial = trialWindow(tier);

    // Monitoring plan is inferred from badges on the card (which mirror *_flag columns)
    const badges = qsa('.badges .badge', card).map(b => text(b).toLowerCase());
    const monitor = [];
    if (badges.includes('sleep')) monitor.push('Sleep: sleep quality, latency, awakenings');
    if (badges.includes('metabolic')) monitor.push('Metabolic: CGM variability, fasting glucose, waist circumference');
    if (badges.includes('cardiovascular')) monitor.push('Cardiovascular: BP (home/ABPM), HRV, resting HR');
    if (badges.includes('immune')) monitor.push('Immune/Inflammation: symptoms, illness days');
    if (badges.includes('anti inflammatory') || badges.includes('anti-inflammatory')) monitor.push('Inflammation: hs-CRP (if available), joint pain, morning stiffness');

    // Compose block using existing box() renderer if present; else build minimal HTML
    const inner = `
      <div class="kv"><div class="label">Evidence tier</div><div class="val"><strong>${htmlEscape(tier)}</strong> <span class="muted">(${levelText||'n/a'})</span></div></div>
      <div class="kv"><div class="label">Mechanistic rationale</div><div class="val">${mechanisms||'<span class="muted">—</span>'}</div></div>
      <div class="kv"><div class="label">Trial protocol</div><div class="val">${dose?htmlEscape(dose)+' • ':''}Time-boxed trial: ${trial}</div></div>
      <div class="kv"><div class="label">Monitor</div><div class="val"><ul class="coach-points">${monitor.map(m=>'<li>'+htmlEscape(m)+'</li>').join('') || '<li>Track relevant symptoms and simple cognitive tasks.</li>'}</ul></div></div>
      <div class="kv"><div class="label">Benefits</div><div class="val">${dir || ''}${dir&&indir?'<br>':''}${indir || ''}</div></div>
      <div class="kv"><div class="label">Risks/Notes</div><div class="val">${risks||'<span class="muted">—</span>'}</div></div>
      ${why ? `<div class="kv"><div class="label">Coach tip</div><div class="val">${why}</div></div>` : ''}
    `;
    if (typeof window.box === 'function'){
      return window.box('Coach Summary', inner, true);
    }
    return `<details class="box"><summary><span>Coach Summary</span><span class="chev">▸</span></summary><div class="content">${inner}</div></details>`;
  }

  function injectCoachSummaries(){
    qsa('.card').forEach(card => {
      const sections = qs('.sections', card);
      if (!sections) return;
      if (sections.dataset.coachInjected === '1') return;

      const coachHTML = buildCoachSummaryFromCard(card);
      if (coachHTML){
        sections.insertAdjacentHTML('afterbegin', coachHTML);
        sections.dataset.coachInjected = '1';
      }
    });
  }

  // Group summary based on currently visible cards
  function rankTier(t){ return ({'Strong':1,'Moderate':2,'Preliminary':3,'Speculative':4,'Unspecified':5})[t] || 9; }

  function updateGroupSummary(){
    const wrap = qs('#group-summary');
    if (!wrap) return;

    const searchVal = (qs('#search')?.value||'').trim();
    const anyChecked = qsa('#indication-boxes input[type=checkbox]:checked').length > 0;

    const cards = qsa('.card');
    if (!cards.length){ wrap.hidden = true; wrap.innerHTML=''; return; }

    // Build items from top visible cards
    const items = cards.map(card => {
      const name = text(qs('h3', card));
      const details = qsa('.box', card).find(b => /<span>Details<\/span>/.test(b.querySelector('summary')?.innerHTML||''));
      const kv = details ? collectKVMap(details) : {};
      const levelText = kv['level of evidence'] || '';
      const tier = deriveTier(levelText);
      const why = (qsa('.box', card).find(b => /Recommended brands/i.test(b.querySelector('summary')?.textContent||'')) ? collectKVMap(qsa('.box', card).find(b => /Recommended brands/i.test(b.querySelector('summary')?.textContent||'')) )['why top choice'] : '') || kv['direct cognitive benefits'] || '';
      return {name, tier, levelText, why};
    });

    items.sort((a,b)=> rankTier(a.tier) - rankTier(b.tier) || a.name.localeCompare(b.name));

    const top = items.slice(0, Math.min(5, items.length));
    const bullets = top.map(it => `<li><strong>${htmlEscape(it.name)}</strong> — ${it.why ? htmlEscape(it.why) : '<span class="muted">'+htmlEscape(it.levelText||'')+'</span>'}</li>`).join('');

    const context = anyChecked ? 'selected indication(s)' : (searchVal ? 'current search' : 'current view');
    wrap.innerHTML = `
      <h2>Coach Group Summary</h2>
      <p class="muted">Top picks by evidence tier for your ${context}:</p>
      <ul class="coach-points">${bullets || '<li class="muted">No items to summarize.</li>'}</ul>
    `;
    wrap.hidden = false;
  }

  // Patch renderResults if available; otherwise use a MutationObserver
  function initHooks(){
    if (typeof window.renderResults === 'function'){
      const orig = window.renderResults;
      window.renderResults = function(){
        orig.apply(this, arguments);
        injectCoachSummaries();
        updateGroupSummary();
      };
    } else {
      const results = qs('#results');
      if (!results) return;
      const obs = new MutationObserver(()=>{ injectCoachSummaries(); updateGroupSummary(); });
      obs.observe(results, {childList:true});
    }

    // Also react to filter changes
    const controls = qs('.controls');
    if (controls){
      controls.addEventListener('input', ()=> { setTimeout(()=>{ injectCoachSummaries(); updateGroupSummary(); }, 0); });
      controls.addEventListener('change', ()=> { setTimeout(()=>{ injectCoachSummaries(); updateGroupSummary(); }, 0); });
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initHooks);
  } else {
    initHooks();
  }
})();
