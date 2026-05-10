// /api/analyze.js — Gemini with bulletproof JSON parsing

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — a brutal, accurate AI form coach for lifters.

CRITICAL: You MUST respond with ONLY a single valid JSON object. No markdown. No code blocks. No preamble. No commentary. Just raw JSON.

Score lifts honestly across the FULL 0-100 range. Bad form = 20-45. Mediocre = 50-65. Solid = 70-82. Strong = 83-91. Elite = 92+. NEVER default to 70.

Use plain English: "knees caving in" not "knee valgus"; "back rounding" not "lumbar flexion". Be specific to the actual image.

If the image is NOT a person performing a lift (food, animal, random photo), set score to 0 and lift_confirmed to "Not a lift".

REQUIRED JSON SHAPE (output exactly this structure, no other format):
{
  "score": 75,
  "lift_confirmed": "Back Squat",
  "verdict": "Three to four brutal sentences specific to the image, plain English.",
  "flags": [
    {"name": "GOOD DEPTH", "severity": "good", "note": "One specific sentence about what you observe."},
    {"name": "KNEES CAVING IN", "severity": "bad", "note": "One specific sentence."}
  ],
  "fixes": [
    {"text": "Specific actionable cue with **bolded keyword**, one to two sentences."},
    {"text": "Second cue."},
    {"text": "Third cue."}
  ]
}

Rules:
- 4 to 6 flag objects total. Mix severities based on what you actually see.
- Severity values: only "good", "warn", or "bad" (lowercase strings).
- Exactly 3 fix objects.
- Use ALL CAPS for flag names, max 5 words each.
- Use **double asterisks** to bold keywords in fix text.
- If not a lift: empty arrays for flags and fixes.

OUTPUT ONLY THE JSON OBJECT. NOTHING ELSE.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Bulletproof JSON extraction from any text response
function extractJSON(text) {
  if (!text) return null;

  // Try 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Try 2: strip markdown code fences
  let cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/```[\s\S]*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}

  // Try 3: find first { and last } and extract
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const extracted = text.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(extracted); } catch {}

    // Try 4: clean up common issues in the extraction
    const fixed = extracted
      .replace(/,(\s*[}\]])/g, '$1')           // remove trailing commas
      .replace(/[\u201C\u201D]/g, '"')          // smart quotes -> straight
      .replace(/[\u2018\u2019]/g, "'")          // smart apostrophes
      .replace(/\n/g, ' ')                      // newlines to spaces inside JSON
      .replace(/\s+/g, ' ');                    // collapse whitespace
    try { return JSON.parse(fixed); } catch {}
  }

  return null;
}

// Validate and normalize the parsed response
function normalizeResult(parsed, fallbackLift) {
  if (!parsed || typeof parsed !== 'object') return null;

  const result = {
    score: Math.max(0, Math.min(100, parseInt(parsed.score) || 0)),
    lift_confirmed: String(parsed.lift_confirmed || fallbackLift || 'Unknown lift'),
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

  return result;
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

    let mediaType = image.media_type;
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';

    const userText = `LIFT TYPE: ${lift || 'unknown'}${notes ? '\nUSER NOTES: "' + notes + '"' : ''}\n\nAnalyze this image. Output ONLY the raw JSON object — no markdown, no code fences, no commentary.`;

    const models = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];
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
              temperature: 0.85,
              topP: 0.95,
              maxOutputTokens: 2000,
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
        lastError = { model, status: response.status, text: (await response.text()).slice(0, 300) };
      } catch (err) {
        lastError = { model, error: String(err.message) };
      }
    }

    if (!geminiData) {
      return jsonResponse({ error: 'Gemini API failed', debug: lastError }, 502);
    }

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      return jsonResponse({
        error: 'Gemini returned empty',
        debug_finish: geminiData.candidates?.[0]?.finishReason,
      }, 502);
    }

    const parsed = extractJSON(text);
    if (!parsed) {
      // Last resort: return a fallback response so user sees SOMETHING
      return jsonResponse({
        score: 50,
        lift_confirmed: lift || 'Unknown',
        verdict: 'The AI returned an unusual response. Try again with a different photo or angle.',
        flags: [{ name: 'ANALYSIS INCOMPLETE', severity: 'warn', note: 'The AI had trouble reading this specific image. A clearer side-angle photo usually works best.' }],
        fixes: [
          { text: 'Try a **side-angle photo** instead of front-on for squats and deadlifts.' },
          { text: 'Make sure the **whole body** is visible in frame.' },
          { text: 'Use **good lighting** so the AI can see joint positions clearly.' },
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
