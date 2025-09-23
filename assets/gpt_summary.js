// assets/gpt_summary.js
// AI panel add-on (non-destructive):
// - Inserts a separate collapsible panel “AI-Generated Coaching Insights” into each card
// - Formats into real <p> paragraphs (no “bunched” text)
// - Clears ALL AI panels on Reset and suppresses immediate reinjection during Reset
// - ES5-compatible; never modifies your app.js handlers or CSV logic

(function(){
  // ===== Small helpers =====
  function qs(s, r){ return (r||document).querySelector(s); }
  function qsa(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function text(el){ return el && el.textContent ? el.textContent.trim() : ''; }

  // Inject minimal CSS for better readability (no edits to style.css needed)
  ;(function injectCSS(){
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

  // Collect key-value rows within a given box
  function collectKVMap(container){
    var map = {};
    var rows = qsa('.kv', container);
    for (var i=0;i<rows.length;i++){
      var lab = qs('.label', rows[i]);
      var val = qs('.val', rows[i]);
      var k = text(lab).toLowerCase();
      var v = text(val);
      if (k) map[k] = v;
    }
    return map;
  }

  // Collect KV from anywhere in the card (fallback when “Details” box is absent/renamed)
  function collectKVMapAnywhere(card){
    var map = {};
    var rows = qsa('.kv', card);
    for (var i=0;i<rows.length;i++){
      var lab = qs('.label', rows[i]);
      var val = qs('.val', rows[i]);
      var k = text(lab).toLowerCase();
      var v = text(val);
      if (k && map[k] == null) map[k] = v;
    }
    return map;
  }

  // Find a <details class="box"> by its summary title (regex, case-insensitive)
  function findBox(card, titleRegex){
    var boxes = qsa('.box', card);
    for (var i=0;i<boxes.length;i++){
      var sum = qs('summary', boxes[i]);
      if (!sum) continue;
      var t = text(sum);
      if (titleRegex.test(t)) return boxes[i];
    }
    return null;
  }

  // Build payload for the function call (NEVER returns null now)
  function payloadFromCard(card){
    var h3 = qs('h3', card);
    var name = text(h3) || 'Unknown supplement';

    // Prefer the “Details” box; otherwise collect from anywhere
    var details = findBox(card, /details/i);
    var kv  = details ? collectKVMap(details) : collectKVMapAnywhere(card);

    var brands  = findBox(card, /recommended brands/i);
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

    // Selected goals from indication checkboxes
    var prefer = (window.__LLM_GOAL_KEYS || ["sleep","metabolic","cardiovascular","immune","anti_inflammatory"]);
    var cbs = qsa('#indication-boxes input[type=checkbox]:checked');
    var selectedGoals = [];
    for (var i=0;i<cbs.length;i++){
      var v = String(cbs[i].value||'').toLowerCase().replace('_flag','');
      if (prefer.indexOf(v) !== -1) selectedGoals.push(v);
    }
    return { supplement_name: name, fields: fields, selected_goals: selectedGoals };
  }

  // Insert the AI panel into a card (after “Coach Summary” if present)
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

  // Render plain text into clean paragraphs
  function toParagraphs(plain){
    var blocks = String(plain||'').trim().split(/\n\s*\n/);
    var html = '';
    for (var i=0;i<blocks.length;i++){
      var b = blocks[i].trim();
      if (!b) continue;
      b = b.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += '<p>'+ b +'</p>';
    }
    if (!html) html = '<p class="muted">Add-on unavailable; using CSV summaries only.</p>';
    return html;
  }

  // Call the Netlify function
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

  // Suppress flag to block auto-injection during Reset re-render
  var SUPPRESS_UNTIL = 0;

  // Enhance one card
  function enhanceCard(card){
    if (!card || card.getAttribute('data-llmCoach') === '1') return;
    if (Date.now() < SUPPRESS_UNTIL) return; // do not inject during/just after Reset

    var payload = payloadFromCard(card);
    var panel = insertPanel(card);
    if (!panel) return;

    card.setAttribute('data-llmCoach','1');
    var container = qs('.ai-insights', panel);

    fetchLLMText(payload).then(function(out){
      container.innerHTML = toParagraphs(out);
    });
  }

  // Run on visible cards (throttled)
  function run(limit){
    if (Date.now() < SUPPRESS_UNTIL) return; // still suppressing post-Reset
    var cards = qsa('.card');
    var n = Math.min(limit||5, cards.length);
    for (var i=0;i<n;i++) enhanceCard(cards[i]);
  }

  // Remove every AI panel and allow re-injection later
  function clearAllAIPanels(){
    var results = qs('#results');
    if (!results) return;
    var panels = qsa('.ai-insights-panel', results);
    for (var i=0;i<panels.length;i++){
      var card = panels[i].closest ? panels[i].closest('.card') : null;
      if (card) card.removeAttribute('data-llmCoach');
      if (panels[i].parentNode) panels[i].parentNode.removeChild(panels[i]);
    }
  }

  // Initialize hooks (non-destructive)
  function init(){
    if (!window.__ENABLE_LLM_COACH) return;

    // Wrap renderResults if available
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

    // Reset button: clear AI panels and suppress reinjection briefly
    var reset = qs('#resetBtn');
    if (reset){
      reset.addEventListener('click', function(){
        // 1) Clear panels immediately
        clearAllAIPanels();
        // 2) Suppress any auto-injection caused by app's re-render after Reset
        SUPPRESS_UNTIL = Date.now() + 400; // 400ms window
        // 3) After the app finishes its reset cycle, clear again just in case
        setTimeout(clearAllAIPanels, 0);
        setTimeout(clearAllAIPanels, 350);
      });
    }

    // If search is empty AND no indications are checked, keep the page clean (no AI panels)
    var controls = qs('.controls');
    if (controls){
      var tidy = function(){
        var search = qs('#search');
        var val = search ? String(search.value||'').trim() : '';
        var any = qsa('#indication-boxes input[type=checkbox]:checked').length > 0;
        if (!val && !any){
          SUPPRESS_UNTIL = Date.now() + 400;
          clearAllAIPanels();
        }
      };
      controls.addEventListener('input', function(){ setTimeout(tidy, 0); });
      controls.addEventListener('change', function(){ setTimeout(tidy, 0); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
