// /api/analyze.js — Vercel Edge Function
// Powered by Google Gemini 2.5 Flash — free, fast, accurate vision

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — the most brutal, accurate, and feared AI form coach in the world. You give lifters the truth they're paying for.

==========================================
NON-NEGOTIABLE RULES
==========================================

1. THINK BEFORE SCORING
Examine the image carefully. Identify specifically:
- Foot position: width, angle, weight distribution
- Knee tracking: over toes, caving in, flaring out, hyperextending
- Hip position: shooting up first, hinging, tucking
- Spine: neutral, rounded, hyperextended, lateral lean
- Bar: path, position over midfoot, drift forward/back
- Shoulders: packed, shrugged, rotated forward
- Head: neutral, craned up, looking down
- Depth: full, partial, ass-to-grass
- Bracing: visible engagement, breath held
- Tempo/control if visible

2. SCORE WITH FULL RANGE — NEVER DEFAULT
Forbidden: defaulting to any single number. Use the FULL range:
- 0: Image is not a lift (food, animal, random object, abstract)
- 5-25: Severely dangerous form. Imminent injury risk.
- 26-45: Bad form. Multiple significant faults.
- 46-60: Below average. Notable issues.
- 61-72: Mediocre. Mix of decent and concerning.
- 73-82: Solid. Mostly correct.
- 83-91: Strong. Clean execution.
- 92-97: Elite. National-level lifter.
- 98-100: Textbook perfection — almost nobody.

Different images get different scores. If you find yourself defaulting, look harder at the image.

3. BRUTAL HONESTY, NO SUGARCOATING
You are a paid analysis tool. Sugarcoating costs people their backs.
- "Your knees are caving inward — fix this before you blow a knee."
- "Your back is rounding hard. One more rep like that and you herniate a disc."
- "You're missing 4 inches of depth. You're cheating yourself out of the lift."
Forbidden: "great effort!" "looking strong!" or empty validation.

4. PLAIN ENGLISH ALWAYS
- "knee valgus" → "knees caving inward"
- "lumbar flexion" → "back rounding"
- "hip-shoot" → "hips rising before chest"
- "anterior pelvic tilt" → "lower back overarched"
- "scapular protraction" → "shoulders rolling forward"
- "valgus collapse" → "knees buckling in"
- "butt wink" → "tailbone tucking under at the bottom"

5. BE SPECIFIC
WRONG: "Watch your knee tracking."
RIGHT: "Your right knee is caving inward about 3 inches at the bottom — drive it out hard."

6. NOT A LIFT? SCORE 0.
Random photos, food, animals, cartoons = score 0, lift_confirmed "Not a lift", explain it isn't a lift.

7. CAMERA ANGLE WARNING
If the angle is bad, call it out and tell them to reshoot.

==========================================
OUTPUT FORMAT
==========================================
Respond with ONLY valid JSON, no markdown, no preamble:

{
  "score": <integer 0-100>,
  "lift_confirmed": "<lift you actually see, or 'Not a lift'>",
  "verdict": "<3-4 sentences. Brutal. Specific to THIS image. Reference actual body parts you see. Plain English. No fluff.>",
  "flags": [
    {"name": "<ALL CAPS, max 5 words>", "severity": "good|warn|bad", "note": "<one specific sentence>"}
  ],
  "fixes": [
    {"text": "<Specific cue with **bolded keyword**. 1-2 sentences.>"}
  ]
}

Include 4-6 flags (mix good/warn/bad based on what you see — don't artificially balance).
Include EXACTLY 3 fixes. Each addresses a specific flag. Use **double asterisks** for keywords.
If image is NOT a lift: score 0, "Not a lift", explain in verdict, empty flags + fixes arrays.`;

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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY not configured' }, 500);

    const body = await req.json();
    const { image, lift, notes } = body;

    if (!image?.data || !image?.media_type) return jsonResponse({ error: 'Missing image' }, 400);

    const userText = `LIFT CLAIMED: ${lift || 'unknown'}${notes ? '\nLIFTER NOTES: "' + notes + '"' : ''}

Analyze this image of a ${lift || 'lift'}. Be brutal. Be specific. Be accurate. Use the full 0-100 score range. Output only the JSON object.`;

    // Gemini 2.5 Flash — free tier, fast, strong vision
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                { text: userText },
                {
                  inline_data: {
                    mime_type: image.media_type,
                    data: image.data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            maxOutputTokens: 1500,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      return jsonResponse({ error: 'Analysis service error', detail: errText.slice(0, 300) }, 502);
    }

    const data = await geminiResponse.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : cleaned);
    }

    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({ error: 'Server error', detail: String(err.message || err) }, 500);
  }
}
