// /api/analyze.js — DEBUG VERSION
// Returns clear error messages to help diagnose what's breaking

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — a brutal, accurate AI form coach. Score lifts honestly across 0-100. Bad form = 20-45. Mediocre = 50-65. Good = 70-85. Elite = 90+. Never default to 70. Use plain English (say "knees caving in" not "knee valgus"). Be specific to what you see. If image is not a lift, score 0.

Output ONLY valid JSON:
{
  "score": <0-100 integer>,
  "lift_confirmed": "<lift you see, or 'Not a lift'>",
  "verdict": "<3-4 brutal honest sentences specific to image>",
  "flags": [{"name":"<ALL CAPS, max 5 words>","severity":"good|warn|bad","note":"<one sentence>"}],
  "fixes": [{"text":"<actionable cue with **bold keyword**>"}]
}
4-6 flags. Exactly 3 fixes. If not a lift: score 0, empty flags+fixes.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    // DEBUG: Check what env var exists
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const availableKeys = Object.keys(process.env).filter(k => k.includes('API') || k.includes('KEY') || k.includes('GEMINI'));
      return jsonResponse({
        error: 'GEMINI_API_KEY not found in environment',
        debug_available_env_keys: availableKeys,
        debug_hint: 'On Vercel, go to Settings > Environment Variables and add GEMINI_API_KEY'
      }, 500);
    }

    if (!apiKey.startsWith('AIza')) {
      return jsonResponse({
        error: 'GEMINI_API_KEY format wrong',
        debug_hint: 'Gemini keys start with "AIza". Yours starts with: ' + apiKey.slice(0, 4),
        debug_key_length: apiKey.length
      }, 500);
    }

    const body = await req.json();
    const { image, lift, notes } = body;

    if (!image?.data || !image?.media_type) {
      return jsonResponse({ error: 'Missing image data', debug_received: { hasImage: !!image, hasData: !!image?.data, hasMediaType: !!image?.media_type } }, 400);
    }

    const userText = `LIFT: ${lift || 'unknown'}${notes ? '. NOTES: "' + notes + '"' : ''}\n\nAnalyze this ${lift || 'lift'} image. Output only the JSON.`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{
            role: 'user',
            parts: [
              { text: userText },
              { inline_data: { mime_type: image.media_type, data: image.data } },
            ],
          }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 1500,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      return jsonResponse({
        error: 'Gemini API rejected the request',
        debug_status: geminiResponse.status,
        debug_response: errText.slice(0, 500),
      }, 502);
    }

    const data = await geminiResponse.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      return jsonResponse({
        error: 'Gemini returned empty response',
        debug_full_response: JSON.stringify(data).slice(0, 500),
      }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      try {
        parsed = JSON.parse(match ? match[0] : cleaned);
      } catch (parseErr) {
        return jsonResponse({
          error: 'Failed to parse Gemini JSON response',
          debug_raw_text: text.slice(0, 500),
        }, 502);
      }
    }

    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({
      error: 'Server error',
      debug_message: String(err.message || err),
      debug_stack: String(err.stack || '').slice(0, 500),
    }, 500);
  }
}
