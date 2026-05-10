// /api/analyze.js — OpenAI GPT-4o-mini with bulletproof JSON parsing

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — a brutal, accurate AI form coach for lifters.

Score lifts honestly across the FULL 0-100 range:
- 0: Not a lift (food, animal, random photo)
- 5-25: Severely dangerous form
- 26-45: Bad form, multiple faults
- 46-60: Below average
- 61-72: Mediocre
- 73-82: Solid
- 83-91: Strong
- 92-97: Elite
- 98-100: Textbook perfection

NEVER default to 70 or any single number. Different images get different scores.

BE BRUTAL. No "great effort!" no empty validation. If form is bad, say so directly. Reference specific body parts and faults you actually see.

USE PLAIN ENGLISH:
- "knees caving in" not "knee valgus"
- "back rounding" not "lumbar flexion"
- "hips shooting up first" not "hip-shoot"
- "shoulders rolling forward" not "scapular protraction"

If image is NOT a person performing a lift, score 0 with lift_confirmed "Not a lift".

Respond with ONLY a valid JSON object, no markdown, no preamble. Use this exact structure:
{
  "score": 75,
  "lift_confirmed": "Back Squat",
  "verdict": "3-4 brutal sentences specific to this image. Plain English. Reference actual body parts you see.",
  "flags": [
    {"name": "GOOD DEPTH", "severity": "good", "note": "specific observation"},
    {"name": "KNEES CAVING IN", "severity": "bad", "note": "specific observation"}
  ],
  "fixes": [
    {"text": "actionable cue with **bolded keyword**, 1-2 sentences"},
    {"text": "second cue"},
    {"text": "third cue"}
  ]
}

4-6 flags total (mix of good/warn/bad based on what you see). Severity must be lowercase: "good", "warn", or "bad". EXACTLY 3 fixes. ALL CAPS for flag names, max 5 words. Use **double asterisks** for bold.

If not a lift: score 0, empty flags array, empty fixes array.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  let cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/```[\s\S]*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const extracted = text.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(extracted); } catch {}
    const fixed = extracted
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try { return JSON.parse(fixed); } catch {}
  }
  return null;
}

function normalizeResult(parsed, fallbackLift) {
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    score: Math.max(0, Math.min(100, parseInt(parsed.score) || 0)),
    lift_confirmed: String(parsed.lift_confirmed || fallbackLift || 'Unknown'),
    verdict: String(parsed.verdict || 'Analysis complete.'),
    flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 6).map(f => ({
      name: String(f.name || 'OBSERVATION').toUpperCase().slice(0, 50),
      severity: ['good', 'warn', 'bad'].includes(f.severity) ? f.severity : 'warn',
      note: String(f.note || ''),
    })) : [],
    fixes: Array.isArray(parsed.fixes) ? parsed.fixes.slice(0, 3).map(f => ({
      text: String(f.text || ''),
    })) : [],
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return jsonResponse({ error: 'OPENAI_API_KEY not configured' }, 500);

    const body = await req.json();
    const { image, lift, notes } = body;

    if (!image?.data || !image?.media_type) {
      return jsonResponse({ error: 'Missing image data' }, 400);
    }

    let mediaType = image.media_type;
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';

    const dataUrl = `data:${mediaType};base64,${image.data}`;
    const userText = `LIFT TYPE: ${lift || 'unknown'}${notes ? '\nUSER NOTES: "' + notes + '"' : ''}\n\nAnalyze this image. Be brutal, specific, accurate. Use the full 0-100 range. Output only the JSON object.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500,
        temperature: 0.85,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return jsonResponse({
        error: 'OpenAI API failed',
        debug_status: response.status,
        debug_response: errText.slice(0, 400),
      }, 502);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    if (!text) {
      return jsonResponse({ error: 'OpenAI returned empty response' }, 502);
    }

    const parsed = extractJSON(text);
    if (!parsed) {
      return jsonResponse({
        score: 50,
        lift_confirmed: lift || 'Unknown',
        verdict: 'The AI returned an unusual response. Try again with a clearer photo.',
        flags: [{ name: 'ANALYSIS INCOMPLETE', severity: 'warn', note: 'Try a clearer side-angle photo.' }],
        fixes: [
          { text: 'Try a **side-angle photo** for squats and deadlifts.' },
          { text: 'Make sure the **whole body** is in frame.' },
          { text: 'Use **good lighting** so joint positions are visible.' },
        ],
      });
    }

    const normalized = normalizeResult(parsed, lift);
    return jsonResponse(normalized);

  } catch (err) {
    return jsonResponse({
      error: 'Server error',
      debug_message: String(err.message || err),
    }, 500);
  }
}
