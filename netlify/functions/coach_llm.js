// netlify/functions/coach_llm.js
// CSV-anchored, guard-railed AI coaching text that *adds* insights via a clinician-approved whitelist.
// Returns plain text with double-newline paragraph breaks so the client can render <p> blocks cleanly.

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
    const { supplement_name, fields, selected_goals = [] } = body || {};
    if (!supplement_name || !fields) {
      return new Response(JSON.stringify({ ok: false, reason: "BAD_INPUT", text: "" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }

    // ===== Clinician-approved augmentation (beyond CSV; never invent) =====
    // Add/curate these bullets over time.
    const AUGMENT_RULES = {
      "creatine": [
        "Creatine consistently supports maintenance and accrual of lean muscle mass when combined with progressive resistance training.",
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
      ]
    };

    const norm = (s) => String(s||"").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const key = norm(fields.supplement_key || supplement_name);
    const augment = AUGMENT_RULES[key] || [];

    const {
      level_of_evidence = "",
      mechanisms = "",
      direct_cognitive_benefits = "",
      indirect_cognitive_benefits = "",
      suggested_dosage = "",
      potential_risks = "",
      why_top_choice = ""
    } = fields;

    const GOAL_MAP = { sleep:"Sleep", metabolic:"Metabolic", cardiovascular:"Cardiovascular", immune:"Immune", anti_inflammatory:"Inflammation" };
    const goals = (Array.isArray(selected_goals) ? selected_goals : [])
      .map(g => String(g||"").toLowerCase())
      .map(g => GOAL_MAP[g] || null)
      .filter(Boolean);

    // — Prompt designed to avoid recapitulation and *require* at least one AUGMENT fact when available —
    const system = [
      "You are a conservative clinical summarizer for brain-health supplements.",
      "Use ONLY the provided CSV fields and clinician-approved AUGMENT bullets.",
      "Do not invent new claims, dosages, risks, or mechanisms beyond those sources.",
      "Paraphrase; avoid repeating CSV sentences verbatim.",
      "Write ~120–160 words total as exactly 3 short paragraphs separated by a blank line.",
      "Para 1: Evidence confidence (based on level_of_evidence) + one sentence tailored to selected goals if provided.",
      "Para 2: Mechanistic rationale and expected pathway; mention dose only if provided.",
      "Para 3: Monitoring focus tied to goals + one practical coaching tip from why_top_choice or AUGMENT.",
      "If AUGMENT exists for this supplement, you MUST include at least one augmentation fact that is not simply restating the CSV."
    ].join("\n");

    const user = JSON.stringify({
      supplement_name,
      goals,
      fields: {
        level_of_evidence,
        mechanisms,
        direct_cognitive_benefits,
        indirect_cognitive_benefits,
        suggested_dosage,
        potential_risks,
        why_top_choice
      },
      AUGMENT: augment
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
    const t = setTimeout(() => ctrl.abort(), 8000);

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    }).catch(() => null);
    clearTimeout(t);

    if (!resp || !resp.ok) {
      return new Response(JSON.stringify({ ok: false, reason: "API_ERROR", text: "" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }

    const data = await resp.json().catch(() => ({}));
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!text || text.length < 60) {
      return new Response(JSON.stringify({ ok: false, reason: "EMPTY", text: "" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true, text }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: "EXCEPTION", text: "" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }
};
