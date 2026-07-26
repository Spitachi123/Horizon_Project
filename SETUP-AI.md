# Wiring up real AI (Gemini) — setup guide

This adds genuine AI-generated summaries, quiz questions, and milestone
ideas to the AI Study Desk (`h.html`) and AI Teaching Assistant
(`teacher-ai.html`), using Google's **free** Gemini API. The API key
is never exposed to the browser — it lives only in a small Cloudflare
Worker that also costs nothing on the free tier.

## 1. Get a free Gemini API key (2 minutes)

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with a Google account, click **Create API key**
3. Copy the key — you'll paste it into the Worker in step 3, not
   anywhere in your site's code.

No credit card is required for the free tier.

## 2. Deploy the Cloudflare Worker (5 minutes, dashboard-only)

1. Go to **https://dash.cloudflare.com** → sign up free if you don't
   have an account.
2. **Workers & Pages → Create → Create Worker**. Give it any name,
   e.g. `divedu-ai-proxy`. Click **Deploy** to create the placeholder.
3. Click **Edit code**. Delete the sample code and paste in the
   entire contents of `cloudflare-worker.js` (included in this
   package). Click **Deploy** again.
4. Go to **Settings → Variables and Secrets → Add**:
   - Name: `GEMINI_API_KEY`
   - Value: (paste the key from step 1)
   - Type: **Secret** (encrypted)
   - Save.
5. Back on the Worker's main page, copy its URL — it looks like
   `https://divedu-ai-proxy.YOUR-SUBDOMAIN.workers.dev`

That's your whole backend. Free tier covers 100,000 requests/day.

## 3. Point the site at your Worker

Open `llm-engine.js` and change this line near the top:

```js
const WORKER_URL = 'https://REPLACE-ME.workers.dev'; // <-- set this
```

to your actual Worker URL from step 2, e.g.:

```js
const WORKER_URL = 'https://divedu-ai-proxy.johndoe.workers.dev';
```

**Important:** it must include the `https://` scheme. A URL pasted
without it (e.g. `divedu-ai-proxy.johndoe.workers.dev`) will make the
browser treat it as a relative path on your own site instead of a
request to Cloudflare — every call will silently fail and the page
will just show "Offline mode" forever, with no visible error.

Upload the updated `llm-engine.js`, `h.html`, and `teacher-ai.html` to
your site (replacing the old ones). `ai-engine.js` and
`cloudinary-config.js` / `firebase-config.js` don't need to change.

## 4. Test it

Open the AI Study Desk, paste in a paragraph, click **Summarize**.
You should see an **"AI-generated"** badge next to the Summary
heading and a genuinely written summary (not just extracted
sentences). Same for quiz questions and milestone ideas on the
Teaching Assistant page.

If the Worker is unreachable, misconfigured, or the free quota is hit,
everything **automatically falls back** to the original local
TextRank engine and shows an **"Offline mode"** badge instead of
breaking — nothing on the page ever goes blank.

## Notes

- `WORKER_URL` and `firebaseConfig`/`cloudinaryConfig` are all safe to
  be public — only `GEMINI_API_KEY` (stored as a Worker secret) is
  sensitive, and it never leaves Cloudflare's servers.
- The free Gemini tier has rate limits (per-minute and per-day). If
  your class is large and hits them often, the automatic local
  fallback keeps things usable, or you can upgrade the Gemini key to
  a paid tier later without changing any code — just the same key,
  same Worker.
- If you'd rather use Groq (Llama models) instead of Gemini, the same
  Worker pattern works — only the `fetch()` URL and request body
  shape inside `cloudflare-worker.js` would change.
