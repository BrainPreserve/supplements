// netlify/functions/chat.js  (duplicate this in netlify/functions/openai.js as well)
export async function handler(event) {
  // Allow only POST/OPTIONS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin"
      },
      body: ""
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: "Server misconfigured: OPENAI_API_KEY missing." };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Pass-through to OpenAI Chat Completions (safe default)
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    return {
      statusCode: resp.status,
      headers: {
        "Content-Type": "application/json",
        // CORS open so your current site keeps working (we can tighten later)
        "Access-Control-Allow-Origin": "*",
        "Vary": "Origin"
      },
      body: text
    };
  } catch {
    return { statusCode: 500, body: "Proxy error." };
  }
}
