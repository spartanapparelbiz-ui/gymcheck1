// /api/analyze.js — Gemini 2.5 Flash, current API format

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — a brutal, accurate AI form coach for lifters. Score lifts honestly across the FULL 0-100 range. Bad form = 20-45. Mediocre = 50-65. Solid = 70-82. Strong = 83-91. Elite = 92+. Never default to 70. Always vary scores based on what you actually see.

Use plain English ("knees caving in" not "knee valgus"; "back rounding" not "lumbar flexion"). Be specific to what you see in this exact image. Reference body parts and faults you observe.

If the image is NOT a lift (food, animal, random object), score 0 and lift_confirmed "Not a lift".

Output ONLY this JSON, no markdown, no preamble:
{
  "score": <0-100 integer>,
  "lift_confirmed": "<lift you see, or 'Not a lift'>",
  "verdict": "<3-4 brutal sentences specific to image, plain English>",
  "flags": [{"name":"<ALL CAPS, max 5 words>","severity":"good|warn|bad","note":"<one sentence>"}],
  "fixes": [{"text":"<actionable cue with **bold keyword**>"}]
}
4-6 flags. Exactly 3 fixes. If not a lift: empty flags + fixes arrays.`;

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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY not configured' }, 500);

    const body = await req.json();
    const { image, lift, notes } = body;

    if (!image?.data || !image?.media_type) {
      return jsonResponse({ error: 'Missing image data' }, 400);
    }

    // Normalize media type — Gemini doesn't accept "image/jpg", needs "image/jpeg"
    let mediaType = image.media_type;
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';

    const userText = `LIFT: ${lift || 'unknown'}${notes ? '. NOTES: "' + notes + '"' : ''}\n\nAnalyze this ${lift || 'lift'} image. Output ONLY the JSON object.`;

    // Try gemini-2.5-flash first, fallback to gemini-1.5-flash if needed
    const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];
    let lastError = null;
    let geminiData = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{
              role: 'user',
              parts: [
                { text: userText },
                { inline_data: { mime_type: mediaType, data: image.data } },
              ],
            }],
            generationConfig: {
              temperature: 0.9,
              topP: 0.95,
              maxOutputTokens: 1500,
              responseMimeType: 'application/json',
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
          }),
        });

        if (response.ok) {
          geminiData = await response.json();
          break;
        }
        lastError = { model, status: response.status, text: (await response.text()).slice(0, 400) };
      } catch (err) {
        lastError = { model, error: String(err.message) };
      }
    }

    if (!geminiData) {
      return jsonResponse({
        error: 'Gemini API rejected all models',
        debug_last_error: lastError,
      }, 502);
    }

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      const finishReason = geminiData.candidates?.[0]?.finishReason;
      return jsonResponse({
        error: 'Gemini returned empty response',
        debug_finish_reason: finishReason,
        debug_data: JSON.stringify(geminiData).slice(0, 400),
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
      } catch {
        return jsonResponse({
          error: 'Failed to parse JSON',
          debug_raw: text.slice(0, 400),
        }, 502);
      }
    }

    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({
      error: 'Server error',
      debug_message: String(err.message || err),
    }, 500);
  }
}
