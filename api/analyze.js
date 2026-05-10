// /api/analyze.js — Vercel Edge Function
// Plain-English form-check API. No jargon.

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — an honest, supportive form coach who explains things in PLAIN ENGLISH.

CRITICAL RULES:
- NEVER use technical jargon. Say "your knees are caving in" not "knee valgus." Say "your back is rounding" not "lumbar flexion." Say "hips rising too fast" not "hip-shoot."
- Talk like a smart friend at the gym, not a textbook.
- Be direct and honest but never cruel. Encouraging where genuine, blunt where needed.
- Skip filler words. Get to the point.`;

function buildUserPrompt(lift, notes) {
  return `The user uploaded a ${lift} attempt.${notes ? ' Their notes: "' + notes + '"' : ''}

Analyze the form. Respond with ONLY a valid JSON object in this exact shape:
{
  "score": <integer 0-100>,
  "lift_confirmed": "<the lift you actually see>",
  "verdict": "<2-3 sentence overall verdict in PLAIN ENGLISH. No jargon.>",
  "flags": [
    {
      "name": "<plain-English issue name, ALL CAPS, max 5 words. E.g. 'KNEES CAVING IN', 'BACK IS ROUNDING', 'BAR DRIFTING FORWARD', 'GOOD DEPTH'>",
      "severity": "good|warn|bad",
      "note": "<one plain-English sentence explaining what you see and why it matters>"
    }
  ],
  "fixes": [
    {"text": "<actionable cue in plain English with **bolded keyword**, 1-2 sentences. Example: 'Drive your **knees out** as you stand up — pretend you're spreading the floor apart with your feet.'>"}
  ]
}

Include 3 to 5 flags (mix of good/warn/bad based on what you see). Include exactly 3 fixes. Use **double asterisks** to bold key terms.

If the image is NOT a lift or you can't evaluate form, set score to 0, explain in verdict why, return empty flags and fixes arrays.

Respond with ONLY the JSON object.`;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);

    const body = await req.json();
    const { image, lift, notes } = body;

    if (!image?.data || !image?.media_type) return jsonResponse({ error: 'Missing image' }, 400);

    const dataUrl = `data:${image.media_type};base64,${image.data}`;
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: SYSTEM_PROMPT + '\n\n' + buildUserPrompt(lift || 'lift', notes || '') },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      return jsonResponse({ error: 'Analysis service error', detail: errText.slice(0, 200) }, 502);
    }

    const data = await groqResponse.json();
    const text = data.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()); }

    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({ error: 'Server error', detail: String(err.message || err) }, 500);
  }
}
