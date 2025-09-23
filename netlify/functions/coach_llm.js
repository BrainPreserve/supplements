// netlify/functions/coach_llm.js
// Purpose: Generate tightly constrained, CSV-anchored coaching text.
// Fails safe: returns {ok:false} if key or API is unavailable.

export default async (req, context) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, reason: "NO_API_KEY", text: "" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const { supplement_name, fields, selected_goals = [] } = body || {};
    if (!supplement_name || !fields) {
      return new Response(
        JSON.stringify({ ok: false, reason: "BAD_INPUT", text: "" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    // === Clinician-approved augmentation (non-CSV) ===
    // You control this whitelist. The model may reference ONLY these extras, not invent new claims.
    const AUGMENT_RULES = {
      "creatine": [
        "Supports maintenance and accrual of lean mass when paired with progressive resistance training.",
        "May increase high-energy phosphate availability; some contexts show cognitive benefits."
      ],
      "protein": [
        "Adequate daily protein helps preserve and build muscle; distribute across meals.",
        "Pair with resistance training to support strength, function, and metabolic health."
      ],
      "whey_protein": [
        "Rapidly absorbed, leucine-rich; supports muscle protein synthesis post-exercise.",
        "Consider lactose tolerance and overall protein targets."
      ],
      "omega_3": [
        "EPA/DHA may aid recovery perception; supports cardiometabolic health that indirectly benefits cognition.",
        "Not a substitute for protein intake or resistance training."
      ],
      "magnesium": [
        "May support sleep quality and muscle relaxation; correct deficiency where relevant."
      ]
      // Add more items here as you approve them.
    };

    const norm = (s) => String(s||"").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const keyGuess = norm(fields.supplement_key || supplement_name);
    const augment = AUGMENT_RULES[keyGuess] || [];

    const {
      level_of_evidence = "",
      mechanisms = "",
      direct_cognitive_benefits = "",
      indirect_cognitive_benefits = "",
      suggested_dosage = "",
      potential_risks = "",
      why_top_choice = "",
    } = fields;

    // Map selected goals to a small, fixed vocabulary
    const GOAL_MAP = {
      sleep: "Sleep",
      metabolic: "Metabolic",
      cardiovascular: "Cardiovascular",
      immune: "Immune",
      anti_inflammatory: "Inflammation"
    };
    const goals = (Array.isArray(selected_goals) ? selected_goals : [])
      .map(g => String(g||"").toLowerCase())
      .map(g => GOAL_MAP[g] || null)
      .filter(Boolean);

    const system = [
      "Role: You are a conservative clinical summarizer for brain-health supplements.",
      "Constraints:",
      "- Use ONLY the user-provided CSV fields and the clinician-approved AUGMENT bullets.",
      "- Do NOT invent or add medical claims, mechanisms, dosages, or risks beyond those sources.",
      "- If a field is missing, omit it without speculation.",
      "- Keep tone clinical yet empowering; ~120–180 words.",
      "- Organize as 3 compact paragraphs:",
      "  1) Evidence tier and what it implies; add one sentence tailored to the user's selected goals if provided.",
      "  2) Mechanistic rationale and expected cognitive pathway; mention dose only if provided.",
      "  3) Monitoring focus tailored to goals; 1 coaching tip (from why_top_choice or AUGMENT).",
      "- Never provide medical directives or diagnoses."
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
    const t = setTimeout(() => ctrl.abort(), 8000); // 8s timeout

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    }).catch(() => null);
    clearTimeout(t);

    if (!resp || !resp.ok) {
      return new Response(
        JSON.stringify({ ok: false, reason: "API_ERROR", text: "" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    const data = await resp.json().catch(() => ({}));
    const text = data?.choices?.[0]?.message?.content?.trim() || "";

    if (!text || text.length < 40) {
      return new Response(
        JSON.stringify({ ok: false, reason: "EMPTY", text: "" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, text }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, reason: "EXCEPTION", text: "" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};
