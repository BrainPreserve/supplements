// netlify/functions/coach_llm.js
// Supports TWO modes:
//   • mode: "single"  -> per-supplement coaching paragraphs
//   • mode: "group"   -> bottom-of-page synthesis for the selected goal
//
// Strict guards:
//  - Grounded ONLY in CSV fields + clinician-approved AUGMENT bullets.
//  - Adds MUST_INCLUDE for Creatine -> muscle mass with resistance/strength training.
//  - Outputs plain text with blank lines between paragraphs for readable <p> rendering on the client.

export default async (req, context) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, reason: "NO_API_KEY", text: "" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const body = await req.json().catch(() => ({}));
    const mode = (body && body.mode) || "single";

    // ------------------------------------------------------------
    // Clinician-approved augmentation (safe extra facts; never invent)
    // ------------------------------------------------------------
    const AUGMENT_RULES = {
      "creatine": [
        "Creatine consistently supports maintenance and accrual of lean muscle mass when combined with progressive resistance/strength training.",
        "Preserving muscle mass reduces frailty risk and supports glucose handling and physical activity, which indirectly benefits brain health."
      ],
      "protein": [
        "Adequate daily protein (distributed across meals) preserves and builds muscle, supporting strength, function, and metabolic health.",
        "Protein intake complements resistance training and may indirectly protect cognition by reducing sarcopenia and metabolic stress."
      ],
      "whey_protein": [
        "Whey is rapidly absorbed and leucine-rich, useful post-exercise to stimulate muscle protein synthesis.",
        "Consider lactose tolerance and overall daily protein targets."
      ],
      "omega_3": [
        "EPA/DHA support cardiometabolic health and recovery perception; they are not a substitute for sufficient protein or training.",
        "Improved cardiometabolic health indirectly benefits brain function."
      ],
      "magnesium": [
        "Magnesium participates in neuromuscular excitability and may aid sleep quality, especially if intake is suboptimal.",
        "Correcting deficiency can improve energy metabolism and reduce cramps or sleep fragmentation."
      ],
      "zinc": [
        "Zinc is essential for immune function and protein synthesis; deficiency impairs taste, wound healing, and immune defense.",
        "Avoid high chronic doses that can reduce copper status."
      ],
      "glycine": [
        "Glycine may support sleep onset and sleep quality in some contexts and contributes to collagen formation.",
        "It can be paired with magnesium in sleep-focused protocols; monitor next-day alertness."
      ]
    };

    // ------------------------------------------------------------
    // MUST_INCLUDE: statements whose meaning must appear in the output (paraphrase allowed)
    // ------------------------------------------------------------
    const MUST_INCLUDE_RULES = {
      "creatine": "There is robust, replicated evidence that creatine supplementation, when combined with progressive resistance/strength training, supports increases or maintenance of lean muscle mass and strength."
    };

    // Normalize and map common aliases to augmentation keys
    function norm(s){
      return String(s||"").toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
    }
    function mapAugKey(key){
      var k = norm(key);
      if (k.indexOf("creatine") > -1) return "creatine";
      if (k.indexOf("whey") > -1) return "whey_protein";
      if (k === "protein") return "protein";
      if (k.indexOf("omega_3") > -1 || k.indexOf("omega-3") > -1 || k.indexOf("epa") > -1 || k.indexOf("dha") > -1 || k.indexOf("fish_oil") > -1 || k.indexOf("fish-oil") > -1) return "omega_3";
      if (k.indexOf("magnesium") > -1) return "magnesium";
      if (k.indexOf("zinc") > -1) return "zinc";
      if (k.indexOf("glycine") > -1) return "glycine";
      return k;
    }

    // --------------------------- SINGLE MODE ---------------------------
    if (mode === "single") {
      const supplement_name = body && body.supplement_name;
      const fields = body && body.fields;
      const selected_goals = (body && body.selected_goals) || [];

      if (!supplement_name || !fields) {
        return new Response(JSON.stringify({ ok: false, reason: "BAD_INPUT", text: "" }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }

      const augKey = mapAugKey(fields.supplement_key || supplement_name);
      const augment = AUGMENT_RULES[augKey] || [];
      const must_include = MUST_INCLUDE_RULES[augKey] || "";

      const level_of_evidence = fields.level_of_evidence || "";
      const mechanisms = fields.mechanisms || "";
      const direct_cognitive_benefits = fields.direct_cognitive_benefits || "";
      const indirect_cognitive_benefits = fields.indirect_cognitive_benefits || "";
      const suggested_dosage = fields.suggested_dosage || "";
      const potential_risks = fields.potential_risks || "";
      const why_top_choice = fields.why_top_choice || "";

      const GOAL_MAP = { sleep:"Sleep", metabolic:"Metabolic", cardiovascular:"Cardiovascular", immune:"Immune", anti_inflammatory:"Inflammation" };
      const goals = (Array.isArray(selected_goals) ? selected_goals : [])
        .map(function(g){ return String(g||"").toLowerCase(); })
        .map(function(g){ return GOAL_MAP[g] || null; })
        .filter(function(x){ return !!x; });

      const system =
        "You are a conservative clinical summarizer for brain-health supplements.\n"
      + "Use ONLY the provided CSV fields and clinician-approved AUGMENT bullets.\n"
      + "Do not invent claims, dosages, risks, or mechanisms beyond those sources.\n"
      + "Paraphrase; avoid repeating CSV sentences verbatim.\n"
      + "Write ~120–160 words as EXACTLY 3 paragraphs, separated by a blank line.\n"
      + "Para 1: Evidence confidence (from level_of_evidence) + one sentence tailored to selected goals if any.\n"
      + "Para 2: Mechanistic rationale and expected pathway; mention dose only if provided.\n"
      + "Para 3: Monitoring focus tied to goals + one practical coaching tip from why_top_choice or AUGMENT.\n"
      + "If AUGMENT exists, include at least one augmentation fact not merely restating the CSV.\n"
      + "If MUST_INCLUDE is provided, you MUST incorporate its meaning explicitly (paraphrasing allowed).";

      const user = JSON.stringify({
        supplement_name: supplement_name,
        goals: goals,
        fields: {
          level_of_evidence: level_of_evidence,
          mechanisms: mechanisms,
          direct_cognitive_benefits: direct_cognitive_benefits,
          indirect_cognitive_benefits: indirect_cognitive_benefits,
          suggested_dosage: suggested_dosage,
          potential_risks: potential_risks,
          why_top_choice: why_top_choice
        },
        AUGMENT: augment,
        MUST_INCLUDE: must_include
      });

      const payload = {
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      };

      const ctrl = new AbortController();
      const t = setTimeout(function(){ ctrl.abort(); }, 8000);

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "authorization": "Bearer " + OPENAI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      }).catch(function(){ return null; });
      clearTimeout(t);

      if (!resp || !resp.ok) {
        return new Response(JSON.stringify({ ok: false, reason: "API_ERROR", text: "" }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      const data = await resp.json().catch(function(){ return {}; });
      const outText = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        ? String(data.choices[0].message.content).trim()
        : "";
      if (!outText || outText.length < 60) {
        return new Response(JSON.stringify({ ok: false, reason: "EMPTY", text: "" }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: true, text: outText }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }

    // --------------------------- GROUP MODE ---------------------------
    if (mode === "group") {
      const group = body && body.group;
      if (!group || !Array.isArray(group.items)) {
        return new Response(JSON.stringify({ ok: false, reason: "BAD_GROUP", text: "" }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }

      // Identify present items and collect their AUGMENT + MUST_INCLUDE (e.g., creatine)
      var presentSet = {};
      var augList = [];
      var mustIncludeForPresent = [];
      for (var i=0;i<group.items.length;i++){
        var nm = String(group.items[i].supplement_name||"");
        var k = mapAugKey(nm);
        presentSet[k] = true;
      }
      for (var key in presentSet){
        if (AUGMENT_RULES[key]) augList.push({ key:key, bullets:AUGMENT_RULES[key] });
        if (MUST_INCLUDE_RULES[key]) mustIncludeForPresent.push({ key:key, text:MUST_INCLUDE_RULES[key] });
      }

      const system =
        "You are a conservative clinical coach. Provide a short, motivating synthesis for the selected goal based on the visible supplements.\n"
      + "Use ONLY the item fields provided and any matching AUGMENT bullets for items that are present.\n"
      + "Do NOT invent new claims or dosing; paraphrase and avoid repeating CSV lines verbatim.\n"
      + "Write 2–3 paragraphs (total ~120–160 words), separated by a blank line.\n"
      + "Para 1: For the selected goal, identify the top 2–3 candidates by evidence confidence and practical fit.\n"
      + "Para 2 (optional 3): Monitoring foci linked to the goal and one practical coaching tip (you may use AUGMENT).\n"
      + "If a MUST_INCLUDE statement is provided for a present item (e.g., creatine -> lean mass with resistance training), incorporate its meaning explicitly if it is clinically relevant to the goal.";

      const user = JSON.stringify({
        selected_goal: String(group.goal||""),
        items: group.items,
        AUGMENT_FOR_PRESENT_ITEMS: augList,
        MUST_INCLUDE_FOR_PRESENT_ITEMS: mustIncludeForPresent
      });

      const payload = {
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      };

      const ctrl = new AbortController();
      const t = setTimeout(function(){ ctrl.abort(); }, 8000);

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "authorization": "Bearer " + OPENAI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      }).catch(function(){ return null; });
      clearTimeout(t);

      if (!resp || !resp.ok) {
        return new Response(JSON.stringify({ ok: false, reason: "API_ERROR", text: "" }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      const data = await resp.json().catch(function(){ return {}; });
      const outText = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        ? String(data.choices[0].message.content).trim()
        : "";
      if (!outText || outText.length < 60) {
        return new Response(JSON.stringify({ ok: false, reason: "EMPTY", text: "" }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: true, text: outText }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }

    // Unknown mode
    return new Response(JSON.stringify({ ok: false, reason: "UNKNOWN_MODE", text: "" }), {
      status: 200, headers: { "content-type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: "EXCEPTION", text: "" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }
};
