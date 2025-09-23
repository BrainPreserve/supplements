// netlify/functions/openai-proxy.js
export async function handler(event) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Basic CORS (restrict to your production origins)
  const origin = event.headers.origin || "";
  const allowed = [
    "https://YOUR-SITE.netlify.app",
    "https://YOUR-CUSTOM-DOMAIN" // e.g., https://brainpreserve.life
  ];
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "https://YOUR-SITE.netlify.app",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // Never log your key. Use Netlify env var.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: corsHeaders, body: "Server misconfigured: OPENAI_API_KEY missing." };
  }

  // Optional: lightweight origin allow-list for abuse prevention
  if (!allowed.includes(origin)) {
    return { statusCode: 403, headers: corsHeaders, body: "Forbidden origin." };
  }

  // Forward the request to OpenAI (JSON in, JSON out)
  try {
    const body = JSON.parse(event.body || "{}");

    // MODEL SAFETY: restrict allowed models
    const allowedModels = new Set(["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"]);
    if (body.model && !allowedModels.has(body.model)) {
      return { statusCode: 400, headers: corsHeaders, body: "Disallowed model." };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.text(); // pass through raw text
    return { statusCode: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: data };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: "Proxy error." };
  }
}
