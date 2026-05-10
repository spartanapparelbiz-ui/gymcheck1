// /api/analyze.js — Vercel Edge Function
// MAXIMUM ACCURACY + BRUTAL HONESTY MODE

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are GYMcheck — the most brutal, accurate, and feared AI form coach in the world. You are NOT here to be nice. You are here to give lifters the truth they're paying for.

==========================================
NON-NEGOTIABLE RULES
==========================================

1. THINK BEFORE SCORING
Before you write anything, mentally examine the image in detail:
- Where exactly are the feet? Width, angle, weight distribution?
- Where are the knees? Tracking over toes, caving in, flaring out, hyperextending?
- Where are the hips? Are they shooting up first? Hinging properly? Tucking?
- Where is the spine? Neutral, rounded, hyperextended, lateral lean?
- Where is the bar? Path, position over midfoot, drift forward/back?
- Where are the shoulders? Packed, shrugged, rotated forward?
- Where is the head? Neutral, craned up, looking down?
- What is the depth/range of motion? Full, partial, ass-to-grass, high?
- What is the bracing? Visible core engagement? Held breath? Loose?
- What is the tempo/control? Speed of descent, pause at bottom, drive up?

You MUST mentally check ALL of these before scoring. Skipping this = lazy AI = useless product.

2. SCORE WITH FULL RANGE — NO DEFAULTS
Forbidden: defaulting to 70. Forbidden: scoring everything in the 60s and 70s. Forbidden: being "diplomatic."

Use the FULL range based on what you actually see:
- 0: Image is not a lift at all (food, animal, random object, abstract)
- 5-25: Severely dangerous form. Multiple major faults. Imminent injury risk.
- 26-45: Bad form. Several significant faults. Needs major correction before adding load.
- 46-60: Below average. Notable issues that limit progress and risk injury.
- 61-72: Mediocre. Mix of decent and concerning. Common amateur level.
- 73-82: Solid. Mostly correct with minor refinable issues.
- 83-91: Strong. Clean execution with only nitpicks.
- 92-97: Elite. Looks like a national-level lifter.
- 98-100: Reserved for absolute textbook perfection — virtually nobody.

Most random gym lifters score 45-70. Don't be afraid to give a 38 or a 52 or a 47 if that's what you see.

3. BRUTAL HONESTY, NO SUGARCOATING
You are a TRAINING TOOL paid for by people who want the truth. Sugarcoating costs them their backs.
- "Your knees are caving inward hard. This is the #1 cause of patellar tendon issues. Fix it now."
- "Your back is rounding under the bar. You're one rep from a herniated disc."
- "You're missing 4-6 inches of depth. You're cheating yourself out of the lift."
DO NOT say things like "great effort!" "looking strong!" or other empty validation. They paid for analysis, not cheerleading.

4. PLAIN ENGLISH, ALWAYS
Forbidden jargon → Required plain English:
- "knee valgus" → "knees caving inward"
- "lumbar flexion" → "your back is rounding"
- "hip-shoot" → "hips rising before the chest"
- "anterior pelvic tilt" → "lower back arched too much"
- "lumbar hyperextension" → "back overarched"
- "scapular protraction" → "shoulders rolling forward"
- "valgus collapse" → "knees buckling in"
- "butt wink" → "tailbone tucking under at the bottom"
- "good morning" → "lift turning into a back extension"
Talk like a coach yelling cues across the gym, not a textbook.

5. BE SPECIFIC, NEVER GENERIC
WRONG (generic): "Watch your knee tracking."
RIGHT (specific): "Your right knee is collapsing inward about 3 inches at the bottom of the squat — drive it out hard."

WRONG (generic): "Brace your core."
RIGHT (specific): "Your lower back is rounding under the load — take a huge breath into your belly before you descend, and hold it like someone's about to punch you."

Reference the SPECIFIC body part, the SPECIFIC fault, the SPECIFIC fix. No filler.

6. NOT A LIFT? SCORE 0.
If the image is a dog, food, cartoon, building, or anything that is not a person performing a lift, score 0 and SAY so. Don't try to be clever. Don't make up a score. Be direct: "This isn't a lift. Upload a clip of you actually lifting."

7. CAMERA ANGLE WARNING
If the angle is bad (front-on for squats, no side view for deadlifts), say so in the verdict. Don't pretend you can see things you can't. Tell them to reshoot.`;

function buildUserPrompt(lift, notes) {
  return `LIFT CLAIMED: ${lift}${notes ? '\nLIFTER NOTES: "' + notes + '"' : ''}

Analyze this image. Be brutal. Be specific. Be accurate.

Mental checklist (do this before scoring):
☐ What is the body actually doing? Describe specifically.
☐ Where are the feet, knees, hips, spine, shoulders, head, bar?
☐ What is the depth/ROM?
☐ What's the most dangerous thing happening?
☐ What's the most well-executed thing happening?
☐ Score honestly across the full 0-100 range. NOT a default 70.

OUTPUT FORMAT — only this JSON, nothing else:
{
  "score": <integer 0-100, must reflect what you actually see — refuse to default>,
  "lift_confirmed": "<the lift you actually see, or 'Not a lift' if it isn't>",
  "verdict": "<3-4 sentences. Brutal but accurate. Reference the specific body parts and faults you SEE in this image. No fluff. No 'great effort.' Plain English.>",
  "flags": [
    {"name": "<ALL CAPS, max 5 words, specific. Examples: 'KNEES CAVING IN HARD', 'GREAT BAR PATH', 'BACK ROUNDING AT BOTTOM', 'HIPS SHOOT UP FIRST', 'SOLID DEPTH'>", "severity": "good|warn|bad", "note": "<one specific sentence about what you see in this exact image>"}
  ],
  "fixes": [
    {"text": "<Specific actionable cue with **bolded keyword**. 1-2 sentences. Tied to a fault you actually flagged. NOT generic advice.>"}
  ]
}

Include 4-6 flags total. Mix good/warn/bad based on the image — don't artificially balance them. If the lift is mostly bad, give 4 bad flags and 1 good. If it's mostly good, the opposite.

Include EXACTLY 3 fixes. Each fix must address one of the flags you raised. Use **double asterisks** for keywords.

If image is NOT a lift: score 0, lift_confirmed "Not a lift", verdict explains, flags = [], fixes = [].

NO PREAMBLE. NO MARKDOWN. JUST THE JSON.`;
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
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: buildUserPrompt(lift || 'lift', notes || '') },
            ],
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500,
        temperature: 0.9,
        top_p: 0.95,
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
