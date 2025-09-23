// assets/gpt_summary.js
// Inserts a separate collapsible panel “AI-Generated Coaching Insights” into each card,
// formats into real <p> paragraphs, and CLEARS all AI panels on Reset.
// ES5-compatible and isolated: does not touch your app.js handlers.

(function(){
  function qs(s, r){ return (r||document).querySelector(s); }
  function qsa(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function text(el){ return el && el.textContent ? el.textContent.trim() : ''; }

  // Inject minimal CSS for better readability (no edit to style.css needed).
  (function injectCSS(){
    if (qs('#ai-insights-css')) return;
    var css = document.createElement('style');
    css.id = 'ai-insights-css';
    css.textContent =
      '.ai-insights p{margin:8px 0;line-height:1.6;}'
    + ' .ai-insights .muted{opacity:.82;}'
    + ' .ai-insights .kv{display:block;}'
    + ' .ai-insights .kv .label{min-width:0;}';
    document.head.appendChild(css);
  })();

  function collectKVMap(detailsBox){
    var map = {};
    var rows = qsa('.kv', detailsBox);
    for (var i=0;i<rows.length;i++){
      var row = rows[i];
      var lab = qs('.label', row);
      var valEl = qs('.val', row);
      var label = text(lab).toLowerCase();
      var val = text(valEl);
      if (label) map[label] = val;
    }
    return map;
  }

  function findBox(card, titleRegex){
    var boxes = qsa('.box', card);
    for (var i=0;i<boxes.length;i++){
      var sum = qs('summary', boxes[i]);
      if (!sum) continue;
      var title = text(sum);
      if (titleRegex.test(title)) return boxes[i];
    }
    return null;
  }

  function payloadFromCard(card){
    var h3 = qs('h3', card);
    var name = text(h3);
    if (!name) return null;

    var details = findBox(card, /details/i);
    var brands  = findBox(card, /recommended brands/i);
    if (!details) return null;

    var kv  = collectKVMap(details);
    var kvb = brands ? collectKVMap(brands) : {};

    var fields = {
      supplement_key: name.toLowerCase().replace(/\s+/g,'_'),
      supplement_name: name,
      level_of_evidence: kv['level of evidence'] || '',
      mechanisms: kv['mechanisms'] || '',
      direct_cognitive_benefits: kv['direct cognitive benefits'] || '',
      indirect_cognitive_benefits: kv['indirect cognitive benefits'] || '',
      suggested_dosage: kv['suggested dosage'] || '',
      potential_risks: kv['potential risks'] || '',
      why_top_choice: kvb['why top choice'] || ''
    };

    var prefer = (window.__LLM_GOAL_KEYS || ["sleep","metabolic","cardiovascular","immune","anti_inflammatory"]);
    var cbs = qsa('#indication-boxes input[type=checkbox]:checked');
    var selectedGoals = [];
    for (var i=0;i<cbs.length;i++){
      var v = String(cbs[i].value||'').toLowerCase().replace('_flag','');
      if (prefer.indexOf(v) !== -1) selectedGoals.push(v);
    }

    return { supplement_name: name, fields: fields, selected_goals: selectedGoals };
  }

  function insertPanel(card){
    var sections = qs('.sections', card);
    if (!sections) return null;

    var panel = document.createElement('details');
    panel.className = 'box ai-insights-panel';
    panel.innerHTML =
      '<summary><span>AI-Generated Coaching Insights</span><span class="chev">▸</span></summary>'
      + '<div class="content ai-insights">'
      + '  <p class="muted">Generating…</p>'
      + '</div>';

    // Place after “Coach Summary” if present; else before everything.
    var boxes = qsa('.box', sections);
    var inserted = false;
    for (var i=0;i<boxes.length;i++){
      var title = text(qs('summary', boxes[i]));
      if (/coach summary/i.test(title)){
        if (boxes[i].nextSibling) boxes[i].parentNode.insertBefore(panel, boxes[i].nextSibling);
        else boxes[i].parentNode.appendChild(panel);
        inserted = true;
        break;
      }
    }
    if (!inserted) sections.insertBefore(panel, sections.firstChild);
    return panel;
  }

  function toParagraphs(plain){
    // Split on double newlines and wrap in <p>.
    var blocks = String(plain||'').trim().split(/\n\s*\n/);
    var html = '';
    for (var i=0;i<blocks.length;i++){
      var b = blocks[i].trim();
      if (!b) continue;
      // Escape minimal angle brackets to avoid accidental HTML
      b = b.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += '<p>'+ b +'</p>';
    }
    if (!html) html = '<p class="muted">Add-on unavailable; using CSV summaries only.</p>';
    return html;
    }

  function fetchLLMText(payload){
    return fetch('/.netlify/functions/coach_llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res){ return res.json().catch(function(){ return {}; }); })
    .then(function(data){ return (data && data.ok && data.text) ? data.text : ''; })
    .catch(function(){ return ''; });
  }

  function enhanceCard(card){
    if (!card || card.getAttribute('data-llmCoach') === '1') return;
    var payload = payloadFromCard(card);
    if (!payload) return;

    var panel = insertPanel(card);
    if (!panel) return;
    card.setAttribute('data-llmCoach','1');

    var container = qs('.ai-insights', panel);
    fetchLLMText(payload).then(function(out){
      container.innerHTML = toParagraphs(out);
    });
  }

  function run(limit){
    var cards = qsa('.card');
    var n = Math.min(limit||5, cards.length);
    for (var i=0;i<n;i++) enhanceCard(cards[i]);
  }

  // === NEW: Clear all AI panels on Reset ===
  function clearAllAIPanels(){
    var panels = qsa('.ai-insights-panel', qs('#results'));
    for (var i=0;i<panels.length;i++){
      var card = panels[i].closest('.card');
      if (card) card.removeAttribute('data-llmCoach'); // allow reinjection on next render
      if (panels[i].parentNode) panels[i].parentNode.removeChild(panels[i]);
    }
  }

  function init(){
    if (!window.__ENABLE_LLM_COACH) return;

    // Hook renderResults if defined
    if (typeof window.renderResults === 'function'){
      var orig = window.renderResults;
      window.renderResults = function(){
        try { orig.apply(this, arguments); } catch(e){ /* ignore */ }
        setTimeout(function(){ run(5); }, 0);
      };
    } else {
      // Fallback observer
      var results = qs('#results');
      if (results) {
        var obs = new MutationObserver(function(){ setTimeout(function(){ run(5); }, 0); });
        obs.observe(results, { childList:true });
      }
    }

    // Bind Reset button to clear AI panels explicitly
    var reset = qs('#resetBtn');
    if (reset) {
      reset.addEventListener('click', function(){
        // Delay slightly to let app.js clear search/filters, then remove AI panels
        setTimeout(clearAllAIPanels, 0);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
