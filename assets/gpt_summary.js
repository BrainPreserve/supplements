// assets/gpt_summary.js
// Non-destructive AI add-on:
//  • Per-card panel “AI-Generated Coaching Insights” (for every visible card)
//  • Bottom-of-page “AI Group Coaching Insights” shown only when one goal is selected
//  • Real <p> paragraphs (no bunched text)
//  • Reset clears ALL AI content + Coach Group Summary and suppresses immediate re-injection
//  • Enforces single-selection behavior for indications (radio-like) without touching HTML
//  • ES5-compatible; does not modify your app.js handlers or CSV logic

(function(){
  // ---------- small helpers ----------
  function qs(s, r){ return (r||document).querySelector(s); }
  function qsa(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function text(el){ return el && el.textContent ? el.textContent.trim() : ''; }
  function has(el){ return !!(el && el.parentNode); }

  // ---------- minimal CSS injection for readability ----------
  (function injectCSS(){
    if (qs('#ai-insights-css')) return;
    var css = document.createElement('style');
    css.id = 'ai-insights-css';
    css.textContent =
      '.ai-insights p{margin:8px 0;line-height:1.6;}'
    + ' .ai-insights .muted{opacity:.82;}'
    + ' .ai-insights .kv{display:block;}'
    + ' .ai-insights .kv .label{min-width:0;}'
    + ' #ai-group-summary{margin:16px 0 32px; border:1px solid var(--border); border-radius:16px; box-shadow:var(--shadow); background:rgba(17,23,51,.7); padding:12px;}'
    + ' #ai-group-summary h2{margin:0 0 6px; font-size:20px;}'
    + ' #ai-group-summary[hidden]{display:none;}';
    document.head.appendChild(css);
  })();

  // ---------- collect key/values from a box or entire card ----------
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

  // ---------- payload builders ----------
  function payloadFromCard(card){
    var h3 = qs('h3', card);
    var name = text(h3) || 'Unknown supplement';

    // Prefer “Details”; otherwise collect from whole card (fixes Glycine / Zinc cases)
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

    // Single-selection goal (radio-like)
    var prefer = (window.__LLM_GOAL_KEYS || ["sleep","metabolic","cardiovascular","immune","anti_inflammatory"]);
    var checked = qsa('#indication-boxes input[type=checkbox]:checked');
    var selectedGoals = [];
    if (checked.length > 0){
      var v = String(checked[0].value||'').toLowerCase().replace('_flag','');
      if (prefer.indexOf(v) !== -1) selectedGoals.push(v);
    }

    return { supplement_name: name, fields: fields, selected_goals: selectedGoals };
  }

  function groupPayloadFromVisible(){
    var boxes = qsa('.card');
    var items = [];
    for (var i=0;i<boxes.length;i++){
      var card = boxes[i];
      var h3 = qs('h3', card);
      var name = text(h3);
      if (!name) continue;

      var details = findBox(card, /details/i);
      var kv  = details ? collectKVMap(details) : collectKVMapAnywhere(card);
      var brands  = findBox(card, /recommended brands/i);
      var kvb = brands ? collectKVMap(brands) : {};

      items.push({
        supplement_name: name,
        level_of_evidence: kv['level of evidence'] || '',
        mechanisms: kv['mechanisms'] || '',
        direct_cognitive_benefits: kv['direct cognitive benefits'] || '',
        indirect_cognitive_benefits: kv['indirect cognitive benefits'] || '',
        suggested_dosage: kv['suggested dosage'] || '',
        why_top_choice: kvb['why top choice'] || ''
      });
    }

    // Selected single goal value
    var checked = qsa('#indication-boxes input[type=checkbox]:checked');
    var goal = checked.length ? String(checked[0].value||'').toLowerCase().replace('_flag','') : '';

    return { goal: goal, items: items };
  }

  // ---------- HTML helpers ----------
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

  // ---------- network ----------
  function postJSON(path, payload){
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res){ return res.json().catch(function(){ return {}; }); })
      .catch(function(){ return {}; });
  }
  function fetchLLMText(payload){
    return postJSON('/.netlify/functions/coach_llm', payload)
      .then(function(data){ return (data && data.ok && data.text) ? data.text : ''; });
  }

  // ---------- per-card panel ----------
  function insertCardPanel(card){
    var sections = qs('.sections', card);
    if (!sections) return null;

    var panel = document.createElement('details');
    panel.className = 'box ai-insights-panel';
    panel.innerHTML =
      '<summary><span>AI-Generated Coaching Insights</span><span class="chev">▸</span></summary>'
      + '<div class="content ai-insights">'
      + '  <p class="muted">Generating…</p>'
      + '</div>';

    // place after Coach Summary if present
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

  function enhanceCard(card){
    if (!card || card.getAttribute('data-llmCoach') === '1') return;
    if (Date.now() < SUPPRESS_UNTIL) return;

    var payload = payloadFromCard(card);
    payload.mode = 'single';

    var panel = insertCardPanel(card);
    if (!panel) return;
    card.setAttribute('data-llmCoach','1');

    var container = qs('.ai-insights', panel);
    fetchLLMText(payload).then(function(out){
      container.innerHTML = toParagraphs(out);
    });
  }

  // ---------- group (bottom) panel ----------
  function ensureBottomContainer(){
    var el = qs('#ai-group-summary');
    if (el) return el;
    var results = qs('#results');
    if (!results || !results.parentNode) return null;

    el = document.createElement('section');
    el.id = 'ai-group-summary';
    el.setAttribute('hidden','');
    el.innerHTML = '<h2>AI Group Coaching Insights</h2><div class="ai-insights"><p class="muted">Generating…</p></div>';
    // insert AFTER results
    results.parentNode.insertBefore(el, results.nextSibling);
    return el;
  }

  function updateBottomGroup(){
    var checked = qsa('#indication-boxes input[type=checkbox]:checked');
    var container = ensureBottomContainer();
    if (!container) return;

    if (!checked.length){
      container.hidden = true;
      container.querySelector('.ai-insights').innerHTML = '';
      return;
    }

    container.hidden = false;
    container.querySelector('.ai-insights').innerHTML = '<p class="muted">Generating…</p>';

    var payload = { mode: 'group', group: groupPayloadFromVisible() };
    fetchLLMText(payload).then(function(out){
      container.querySelector('.ai-insights').innerHTML = toParagraphs(out);
    });
  }

  // ---------- run on all visible cards ----------
  function runAllCards(){
    if (Date.now() < SUPPRESS_UNTIL) return;
    var cards = qsa('.card');
    for (var i=0;i<cards.length;i++) enhanceCard(cards[i]);
  }

  // ---------- clear helpers (Reset) ----------
  function clearAllAIPanels(){
    var results = qs('#results');
    if (!results) return;
    var panels = qsa('.ai-insights-panel', results);
    for (var i=0;i<panels.length;i++){
      var card = panels[i].closest ? panels[i].closest('.card') : null;
      if (card) card.removeAttribute('data-llmCoach');
      if (has(panels[i])) panels[i].parentNode.removeChild(panels[i]);
    }
  }
  function clearTopCoachGroupSummary(){
    var top = qs('#group-summary');
    if (top){
      top.innerHTML = '';
      top.hidden = true;
    }
  }
  function clearBottomGroup(){
    var bottom = qs('#ai-group-summary');
    if (bottom){
      bottom.innerHTML = '<h2>AI Group Coaching Insights</h2><div class="ai-insights"></div>';
      bottom.hidden = true;
    }
  }

  // suppress re-injection briefly during Reset
  var SUPPRESS_UNTIL = 0;

  // ---------- enforce radio-like goal selection without HTML changes ----------
  function initRadioBehavior(){
    var box = qs('#indication-boxes');
    if (!box) return;
    box.addEventListener('change', function(ev){
      var t = ev.target;
      if (!t || t.type !== 'checkbox') return;
      // uncheck all others
      var all = qsa('input[type=checkbox]', box);
      for (var i=0;i<all.length;i++){
        if (all[i] !== t) all[i].checked = false;
      }
      // trigger group update after app rerender has happened
      setTimeout(updateBottomGroup, 0);
    });
  }

  // ---------- init ----------
  function init(){
    if (!window.__ENABLE_LLM_COACH) return;

    // wrap renderResults to inject panels after your app renders
    if (typeof window.renderResults === 'function'){
      var orig = window.renderResults;
      window.renderResults = function(){
        try { orig.apply(this, arguments); } catch(e){}
        setTimeout(function(){
          runAllCards();
          updateBottomGroup();
        }, 0);
      };
    } else {
      var results = qs('#results');
      if (results){
        var obs = new MutationObserver(function(){
          setTimeout(function(){
            runAllCards();
            updateBottomGroup();
          }, 0);
        });
        obs.observe(results, { childList:true });
      }
    }

    // bind Reset to clear ALL AI + coach group summaries and suppress reinjection briefly
    var reset = qs('#resetBtn');
    if (reset){
      reset.addEventListener('click', function(){
        clearAllAIPanels();
        clearTopCoachGroupSummary();
        clearBottomGroup();
        SUPPRESS_UNTIL = Date.now() + 600; // block reinjection during app reset render
        setTimeout(function(){
          clearAllAIPanels();
          clearTopCoachGroupSummary();
          clearBottomGroup();
        }, 550);
      });
    }

    // keep page tidy when nothing is selected / search cleared
    var controls = qs('.controls');
    if (controls){
      var tidy = function(){
        var s = qs('#search'); var val = s ? String(s.value||'').trim() : '';
        var any = qsa('#indication-boxes input[type=checkbox]:checked').length > 0;
        if (!val && !any){
          SUPPRESS_UNTIL = Date.now() + 400;
          clearAllAIPanels();
          clearTopCoachGroupSummary();
          clearBottomGroup();
        }
      };
      controls.addEventListener('input', function(){ setTimeout(tidy,0); });
      controls.addEventListener('change', function(){ setTimeout(tidy,0); });
    }

    initRadioBehavior(); // single-selection UX (radio-like)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
