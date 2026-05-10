# GYMcheck — 15-Minute Launch

3 files. Free everything. Live in 15 min.

## STEP 1 — Free Groq API key (2 min)
1. Go to **console.groq.com** → sign up (Google/GitHub login is fastest)
2. Click **"API Keys"** → **"Create API Key"** → name it `gymcheck`
3. Copy the `gsk_...` string somewhere safe

## STEP 2 — Push to GitHub (5 min)
1. Go to **github.com** → click **+** top right → **New repository**
2. Name it `gymcheck`, Public, no init boxes → **Create**
3. On the empty repo page, click **"uploading an existing file"**
4. Drag in: `index.html`, `vercel.json`, AND the entire `api` folder
5. Scroll down → **Commit changes**

## STEP 3 — Deploy on Vercel (3 min)
1. Go to **vercel.com** → Sign Up → **Continue with GitHub**
2. **Add New** → **Project** → find `gymcheck` → **Import**
3. Don't change any settings → click **Deploy**
4. Wait for confetti. Click your URL.

## STEP 4 — Add the Groq key (2 min)
1. Vercel project → **Settings** → **Environment Variables**
2. Name: `GROQ_API_KEY`, Value: paste your `gsk_...`, all 3 environments checked → **Save**
3. **Deployments** tab → ⋯ on latest → **Redeploy**

## STEP 5 — Test (1 min)
1. Open your Vercel URL
2. Upload any squat photo → click **ANALYZE FORM**
3. Get a real plain-English form report

## STEP 6 — Add Stripe (when ready)
1. **stripe.com** → activate account → create 2 Products: Pro $12/mo, Pro+ $29/mo
2. For each: create a **Payment Link**, copy the URL
3. Edit your `index.html` on GitHub, paste this near the top of `<body>`:
```html
<script>
window.STRIPE_LINK_PRO = 'https://buy.stripe.com/your-pro-link';
window.STRIPE_LINK_PROPLUS = 'https://buy.stripe.com/your-proplus-link';
</script>
```
4. Commit. Vercel auto-redeploys.

## What's already working
- Free first check (no login)
- Plain-English form reports
- 10 lifts (squat, bench, deadlift, OHP, row, RDL, hip thrust, pull-up, dip, front squat)
- Account system (sign up / sign in)
- Pro upgrade simulation in TEST MODE (real Stripe slots in via Step 6)
- Shareable PNG report cards
- Mobile-responsive
- Local usage tracking that resets monthly

## Troubleshooting
- **"Analysis failed"** → key not set on Vercel; check Step 4, redeploy
- **404 on /api/analyze** → `api` folder didn't upload; check GitHub
- **Permission denied on Vercel** → Adjust GitHub App Permissions, grant repo access
