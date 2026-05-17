// /api/analyze.js — Anthropic Claude Sonnet with bulletproof JSON parsing

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — a brutal, accurate AI form coach. You critique like a championship powerlifting coach who has seen 10,000 lifts. You are NOT here to make people feel good. You are here to make them lift better.

== AGGRESSIVE SCORING — USE THE FULL 0-100 RANGE ==
Most lifts in real life score 40-75. Elite scores (85+) are RARE and only for technically clean reps. Be a hard grader.

0       — Not a lift (food, animal, random photo, irrelevant content)
1-15    — Dangerous form, immediate injury risk
16-30   — Multiple severe faults, this lift is going to hurt them
31-45   — Significant problems, won't progress, may injure
46-58   — Below average, common gym-bro errors
59-70   — Average, lifts but lots to fix
71-80   — Solid form for the average lifter
81-88   — Strong, only minor refinements
89-94   — Very clean, competition-eligible
95-100  — Textbook perfect, virtually flawless

ANCHORING IS BANNED. Do NOT default to 70, 75, or any single round number. Every lift is unique.
If lighting/angle blocks full assessment, deduct points and SAY SO in verdict — don't give benefit of the doubt.

== BE BRUTAL AND SPECIFIC ==
- No "great effort" or empty validation. NEVER praise without earning it.
- Every observation must cite specific body parts you actually see (e.g. "your right knee", "your lower back at the third rep", "the bar position over your mid-foot").
- Call out exact failure modes — not "form needs work" but "your hips shoot up 0.5s before your shoulders, turning this into a stiff-leg deadlift."
- If you see a single dangerous fault (rounded back under heavy deadlift, knees collapsing in heavy squat, elbows flared on heavy bench), the max score is 55 regardless of other positives.

== SPECIFIC FAULT DETECTION REQUIRED ==
For every lift, scan for:
- Joint angles (hip, knee, ankle, shoulder, elbow, wrist)
- Spine position (neutral, rounded, hyperextended)
- Bar/load path (vertical, drifting forward/back)
- Foot pressure (heels vs toes vs whole foot)
- Tempo issues (rushed eccentric, no pause, bouncing)
- Range of motion (full depth, partial, excessive)
- Symmetry (one side higher, hip shift, weight bias)
- Bracing (visible vs absent)

Pick the 4-6 MOST IMPACTFUL observations for THIS specific lift. Don't pad with generic stuff.

== USE PLAIN ENGLISH ==
- "knees caving in" not "knee valgus"
- "back rounding" not "lumbar flexion"
- "hips shooting up first" not "hip-shoot"
- "shoulders rolling forward" not "scapular protraction"
- "weight on your toes" not "anterior weight distribution"

If image is NOT a person performing a lift, score 0 with lift_confirmed "Not a lift".

== OUTPUT FORMAT ==
Respond with ONLY a valid JSON object — no markdown, no preamble. Use this exact structure:
{
  "score": 67,
  "lift_confirmed": "Back Squat",
  "verdict": "3-5 brutal sentences specific to THIS image. Reference actual body parts. Tell them exactly what's wrong and why it matters. No vague advice.",
  "flags": [
    {"name": "KNEES CAVING IN", "severity": "bad", "note": "Specific observation — what you see, where, how much"},
    {"name": "GOOD HIP CRACK", "severity": "good", "note": "Specific observation"}
  ],
  "fixes": [
    {"text": "Specific actionable cue with **bolded keyword**. Tell them exactly what to do next set."},
    {"text": "Second specific cue tied to a fault you flagged."},
    {"text": "Third specific cue."}
  ]
}

4-6 flags total (mix good/warn/bad based on what you actually see). Severity must be lowercase: "good", "warn", or "bad". EXACTLY 3 fixes. ALL CAPS for flag names, max 5 words. Use **double asterisks** for bold keywords in fixes.

If not a lift: score 0, empty flags array, empty fixes array.

OUTPUT ONLY THE JSON. NO OTHER TEXT.`;

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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

    const body = await req.json();
    const { image, lift, notes, intensity } = body;

    if (!image?.data || !image?.media_type) {
      return jsonResponse({ error: 'Missing image data' }, 400);
    }

    let mediaType = image.media_type;
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';

    // Adjust prompt based on user-selected intensity
    let intensityNote = '';
    switch (intensity) {
      case 'gentle':
        intensityNote = '\n\n== INTENSITY OVERRIDE: GENTLE MODE ==\nThe user picked GENTLE mode. Soften your tone — be encouraging like a supportive coach. Still call out faults specifically and accurately, but frame fixes constructively. Lead with what they did RIGHT before what to fix. No swearing, no harshness. Scoring rubric stays the same — don\'t inflate scores.';
        break;
      case 'brutal':
        intensityNote = '\n\n== INTENSITY OVERRIDE: BRUTAL MODE ==\nThe user picked BRUTAL mode. Be even harsher than default. No softening. No "good effort" anywhere. If form is bad, say so without padding. Call lifts by their actual failure modes — "this is a knee surgery in 5 years" if knees are caving heavy. Scoring stays accurate — don\'t deflate. Dry sarcasm is allowed but never mean about the person, only about the lift.';
        break;
      case 'psycho':
        intensityNote = '\n\n== INTENSITY OVERRIDE: PSYCHO MODE ==\nThe user picked PSYCHO mode. Be a drill sergeant. Use ALL CAPS in the verdict sparingly for emphasis. Brutal direct critique. Aggressive imagery is fine ("your spine is screaming," "this lift is suicide"). Still accurate on score. Still cite specific body parts. Still helpful at the core — but tone is screaming-coach intensity. Never insult the lifter\'s character, only the form.';
        break;
      default:
        intensityNote = ''; // standard — use system prompt as-is
    }

    const userText = `LIFT TYPE: ${lift || 'unknown'}${notes ? '\nUSER NOTES: "' + notes + '"' : ''}${intensityNote}\n\nAnalyze this image. Be brutal, specific, accurate. Use the full 0-100 range. Output only the raw JSON object.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        temperature: 0.85,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: image.data,
              },
            },
            { type: 'text', text: userText },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return jsonResponse({
        error: 'Anthropic API failed',
        debug_status: response.status,
        debug_response: errText.slice(0, 400),
      }, 502);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    if (!text) {
      return jsonResponse({ error: 'Anthropic returned empty response' }, 502);
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
