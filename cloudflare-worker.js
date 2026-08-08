/* ============================================================
   DIVEDU AI PROXY — Cloudflare Worker
   ============================================================
   This is the ONLY place your Gemini API key lives. It never
   touches the browser. The frontend (llm-engine.js) calls this
   worker; this worker calls Gemini and hands back plain JSON.

   DEPLOY (dashboard, no CLI needed):
     1. https://dash.cloudflare.com -> Workers & Pages -> Create
        -> "Create Worker" -> give it a name (e.g. divedu-ai-proxy)
     2. Click "Edit code", delete the sample code, paste this
        whole file in, click "Deploy".
     3. Go to Settings -> Variables and Secrets -> Add ->
        Name: GEMINI_API_KEY, Value: <your key from
        https://aistudio.google.com/app/apikey> -> Encrypt -> Save.
     4. Copy the worker's URL (looks like
        https://divedu-ai-proxy.YOUR-SUBDOMAIN.workers.dev) and
        paste it into WORKER_URL at the top of llm-engine.js.

   DEPLOY (CLI, if you prefer):
     npm install -g wrangler
     wrangler login
     wrangler secret put GEMINI_API_KEY   (paste your key)
     wrangler deploy

   ---- DEBUG MODE (temporary) ----
   Your worker was returning a generic "temporarily unavailable"
   502 with no way to see the real cause. This version puts
   Google's actual error text into the JSON response (in a
   `debug` field) so you can see exactly what's wrong. Once
   things are working, search for "REMOVE DEBUG" below and
   delete that block to stop exposing error details.
   ============================================================ */

const GEMINI_MODEL = 'gemini-3.6-flash'; // latest GA Gemini Flash model (faster + cheaper than 3.5/2.5 Flash)
const MAX_INPUT_CHARS = 30000;
const MAX_ATTACHMENTS = 4;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'This endpoint only accepts POST requests.' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const task = body.task;

    // Current Affairs is handled FIRST, before the GEMINI_API_KEY check
    // below — it's a plain read of live external RSS feeds and never
    // calls Gemini at all. It used to sit after the key check, which
    // meant the news tab silently broke any time GEMINI_API_KEY was
    // missing, expired, or misconfigured, even though news doesn't
    // depend on it. Keep it first so news works independently of the
    // AI key's status.
    if (task === 'news') {
      return handleNews(body, env);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is missing GEMINI_API_KEY — add it in Worker Settings.' }, 500);
    }

    // Chatbot turns have a different shape (message + history +
    // attachments, no single `text` field) and can legitimately be
    // attachment-only with no text, so it gets its own path entirely.
    if (task === 'chat') {
      return handleChat(body, env);
    }

    // Presentation generation also has its own shape (a topic and/or
    // pasted notes and/or file attachments, producing a structured
    // slide-deck JSON rather than the flat shapes the other tasks use).
    if (task === 'presentation') {
      return handlePresentation(body, env);
    }

    const text = (body.text || '').toString();
    // Attachments (images/PDFs/DOCX-or-other-as-text) can now stand in
    // for, or supplement, pasted text on these tasks too — e.g. the
    // mind map and summarizer/quiz/milestone tools send the actual
    // file straight to Gemini instead of pre-extracting text
    // client-side, and it works for any file format Gemini can read
    // (or that got turned into text upstream), same as chat/presentation.
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : [];

    if ((!text || text.trim().length < 10) && attachments.length === 0) {
      return json({ error: 'Please provide a longer passage of text or attach a file.' }, 400);
    }
    if (text.length > MAX_INPUT_CHARS) {
      return json({ error: 'That text is too long for this endpoint — please shorten it.' }, 400);
    }

    const promptText = buildPrompt(task, text, body.count, body.ratio, attachments.length > 0);
    if (!promptText) {
      return json({ error: 'Unknown task type: ' + task }, 400);
    }

    const parts = [{ text: promptText }, ...attachmentsToParts(attachments)];

    try {
      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.4,
              responseMimeType: 'application/json'
            }
          })
        }
      );

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        console.error('Gemini API error:', geminiResp.status, errText);
        const status = geminiResp.status === 429 ? 429 : 502;

        // ---- REMOVE DEBUG: delete the `debug` line below once fixed ----
        return json({
          error: status === 429
            ? 'The free AI quota is temporarily exhausted — please try again in a minute.'
            : 'The AI service is temporarily unavailable.',
          debug: `Gemini responded ${geminiResp.status}: ${errText.slice(0, 500)}`
        }, status);
        // ---- end REMOVE DEBUG ----
      }

      const data = await geminiResp.json();
      const raw = data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : '';

      let parsed;
      try {
        const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('Could not parse Gemini output as JSON:', raw);
        return json({ error: 'The AI returned something unexpected — please try again.', debug: raw.slice(0, 500) }, 502);
      }

      return json({ ok: true, task, result: parsed });
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: 'Something went wrong contacting the AI service.', debug: String(err && err.message || err) }, 500);
    }
  }
};

const CHAT_SYSTEM_PROMPT =
  'You are Sathi, the friendly built-in AI study assistant inside the ज्ञानSetु ' +
  '(DiveEdu) classroom platform. You help students and teachers with homework ' +
  'questions, explaining concepts simply, reading attached photos/PDFs/notes, ' +
  'and generally being a supportive study companion. Keep answers clear and ' +
  'well-organized (short paragraphs or bullet points), and keep a warm, ' +
  'encouraging tone suited to students. If the user writes in Nepali, reply in ' +
  'Nepali (Devanagari script); otherwise reply in whatever language they wrote in.\n\n' +
  'Formatting rules — the chat window renders only a small subset of markdown ' +
  '(headers, **bold**, *italic*, bullet/numbered lists, `code`, blockquotes) as ' +
  'real HTML, nothing else:\n' +
  '- NEVER use LaTeX or math-mode syntax (no $...$, $$...$$, \\(...\\), \\frac, ' +
  '\\rightarrow, \\times, etc.). Use plain Unicode symbols instead (→ × ÷ ± ≈ ≠ ≤ ≥ ² ³ √) ' +
  'or just spell it out in words.\n' +
  '- Prefer plain prose and short paragraphs; use headers (#, ##, ###) sparingly, ' +
  'only for genuinely long, multi-section answers.\n' +
  '- Use fenced code blocks (```) only for actual code, never for math or plain text.';

const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_HISTORY = 20;
const MAX_ATTACHMENT_TEXT_CHARS = 12000;

/** Converts the frontend's attachment shape ({kind, mimeType, data,
 *  text, name}) into Gemini `parts`: images/PDFs travel as inline
 *  base64 (Gemini reads both natively), anything already reduced to
 *  plain text client-side (DOCX, TXT, etc.) travels as a labelled
 *  text part. Used by the summarize/quiz/milestones/mindmap task
 *  path so those tasks can take a file attachment the same way chat
 *  and presentation generation already do. */
function attachmentsToParts(attachments) {
  const parts = [];
  for (const att of attachments) {
    if (att && att.data && att.mimeType) {
      parts.push({ inline_data: { mime_type: att.mimeType, data: String(att.data).slice(0, 12_000_000) } });
    } else if (att && att.text) {
      const label = att.name ? `[Attached file: ${att.name}]` : '[Attached file]';
      parts.push({ text: `${label}\n${String(att.text).slice(0, MAX_ATTACHMENT_TEXT_CHARS)}` });
    }
  }
  return parts;
}

/** Handles the chatbot's "chat" task: builds a full multi-turn,
 *  multimodal Gemini request (conversation history + this turn's
 *  text + any image/PDF attachments as inline base64 data, with
 *  DOCX/TXT attachments already converted to plain text client-side)
 *  and returns the assistant's reply as plain conversational text —
 *  no JSON-shape enforcement here, unlike the other tasks. */
async function handleChat(body, env) {
  const message = (body.message || '').toString().slice(0, 8000);
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_CHAT_HISTORY) : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_CHAT_ATTACHMENTS) : [];
  const nepali = !!body.nepali;

  if (!message && attachments.length === 0) {
    return json({ error: 'Please type a message or attach a file.' }, 400);
  }

  const contents = [];
  history.forEach(turn => {
    const turnText = (turn && turn.text ? String(turn.text) : '').slice(0, 8000);
    if (!turnText) return;
    contents.push({ role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turnText }] });
  });

  const currentParts = [];
  if (message) currentParts.push({ text: message });
  for (const att of attachments) {
    if (att && att.data && att.mimeType) {
      currentParts.push({ inline_data: { mime_type: att.mimeType, data: String(att.data).slice(0, 12_000_000) } });
    } else if (att && att.text) {
      const label = att.name ? `[Attached file: ${att.name}]` : '[Attached file]';
      currentParts.push({ text: `${label}\n${String(att.text).slice(0, MAX_ATTACHMENT_TEXT_CHARS)}` });
    }
  }
  if (currentParts.length === 0) currentParts.push({ text: '(The user sent an attachment that could not be read.)' });
  contents.push({ role: 'user', parts: currentParts });

  const systemText = CHAT_SYSTEM_PROMPT + (nepali ? ' The user has requested Nepali replies — respond in Nepali (Devanagari script) regardless of what script they type in.' : '');

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemText }] },
          generationConfig: { temperature: 0.6 }
        })
      }
    );

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error('Gemini chat error:', geminiResp.status, errText);
      const status = geminiResp.status === 429 ? 429 : 502;
      return json({
        error: status === 429
          ? 'The free AI quota is temporarily exhausted — please try again in a minute.'
          : 'The AI service is temporarily unavailable.',
        debug: `Gemini responded ${geminiResp.status}: ${errText.slice(0, 500)}`
      }, status);
    }

    const data = await geminiResp.json();
    const candidate = data && data.candidates && data.candidates[0];
    const finishReason = candidate && candidate.finishReason;
    const reply = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map(p => p.text || '').join('').trim()
      : '';

    if (!reply) {
      const blocked = finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT';
      return json({
        error: blocked
          ? "I can't help with that request."
          : 'The AI returned an empty response — please try rephrasing.'
      }, 502);
    }

    return json({ ok: true, task: 'chat', result: { reply } });
  } catch (err) {
    console.error('Worker chat error:', err);
    return json({ error: 'Something went wrong contacting the AI service.', debug: String(err && err.message || err) }, 500);
  }
}

const MAX_PRESENTATION_ATTACHMENTS = 4;

/** Handles the "presentation" task: takes a topic, and/or pasted
 *  notes/outline text, and/or file attachments (same shapes as chat
 *  — images/PDFs as inline base64, DOCX/TXT already extracted to
 *  plain text client-side), and returns a structured slide-deck JSON
 *  that the frontend turns into both a downloadable .pptx (via
 *  PptxGenJS) and an in-app web slideshow. Uses responseMimeType:
 *  'application/json' plus an explicit schema in the prompt so the
 *  model's output can be parsed directly, the same pattern as the
 *  other structured tasks (summarize/quiz/milestones) below. */
async function handlePresentation(body, env) {
  const topic = (body.topic || '').toString().slice(0, 500);
  const notes = (body.notes || '').toString().slice(0, MAX_INPUT_CHARS);
  const slideCount = Math.min(Math.max(parseInt(body.slideCount, 10) || 8, 3), 20);
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_PRESENTATION_ATTACHMENTS) : [];

  if (!topic && !notes && attachments.length === 0) {
    return json({ error: 'Give it a topic, some notes, or a file to work from.' }, 400);
  }

  const schemaInstructions =
    `Design a ${slideCount}-slide presentation deck. Respond ONLY with valid JSON (no markdown ` +
    `fences, no commentary) in exactly this shape:\n` +
    `{"title": "deck title", "subtitle": "short subtitle or empty string", ` +
    `"theme": "one of: blue, green, purple, warm, dark — pick whichever best fits the subject's mood", ` +
    `"slides": [{"layout": "one of: title, bullets, twoColumn, quote, sectionHeader, imageFocus, closing", ` +
    `"title": "slide title", "subtitle": "optional short line, or empty string", ` +
    `"bullets": ["point", "..."], "leftTitle": "only for twoColumn layout", "leftBullets": ["...", "only for twoColumn"], ` +
    `"rightTitle": "only for twoColumn layout", "rightBullets": ["...", "only for twoColumn"], ` +
    `"quote": "only for quote layout", "attribution": "only for quote layout", ` +
    `"notes": "one or two sentences of speaker notes for this slide"}]}\n\n` +
    `Rules: the FIRST slide must use layout "title" (deck title + subtitle, no bullets). The LAST slide ` +
    `must use layout "closing" (a short wrap-up/thank-you, 0-3 bullets max). Use "sectionHeader" sparingly ` +
    `to divide the deck into 2-4 parts if it naturally has distinct sections. Keep each "bullets" array to ` +
    `3-5 short punchy points (max ~12 words each) — this is a presentation slide, not a document; move ` +
    `detail into "notes" instead of cramming it into bullets. Use "twoColumn" for genuine comparisons ` +
    `(before/after, pros/cons, X vs Y) and "quote" only if there's a real quote/statistic worth isolating. ` +
    `Write in the same language as the source material/topic (reply in Nepali/Devanagari if the input is Nepali).`;

  const systemText =
    'You are an expert presentation designer helping a student or teacher turn a topic, notes, or ' +
    'documents into a clear, well-structured slide deck for the ज्ञानSetु (DiveEdu) classroom platform. ' +
    schemaInstructions;

  const parts = [];
  let sourceDescription = '';
  if (topic) { parts.push({ text: `Presentation topic: ${topic}` }); sourceDescription += 'a topic'; }
  if (notes) { parts.push({ text: `Source notes/outline to build the deck from:\n"""${notes}"""` }); sourceDescription += (sourceDescription ? ' and ' : '') + 'notes'; }
  for (const att of attachments) {
    if (att && att.data && att.mimeType) {
      parts.push({ inline_data: { mime_type: att.mimeType, data: String(att.data).slice(0, 12_000_000) } });
      sourceDescription += (sourceDescription ? ' and ' : '') + 'an attached file';
    } else if (att && att.text) {
      const label = att.name ? `[Attached file: ${att.name}]` : '[Attached file]';
      parts.push({ text: `${label}\n${String(att.text).slice(0, MAX_ATTACHMENT_TEXT_CHARS)}` });
      sourceDescription += (sourceDescription ? ' and ' : '') + 'an attached file';
    }
  }
  if (parts.length === 0) parts.push({ text: '(No usable source content was provided.)' });

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          systemInstruction: { parts: [{ text: systemText }] },
          generationConfig: { temperature: 0.5, responseMimeType: 'application/json' }
        })
      }
    );

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error('Gemini presentation error:', geminiResp.status, errText);
      const status = geminiResp.status === 429 ? 429 : 502;
      return json({
        error: status === 429
          ? 'The free AI quota is temporarily exhausted — please try again in a minute.'
          : 'The AI service is temporarily unavailable.',
        debug: `Gemini responded ${geminiResp.status}: ${errText.slice(0, 500)}`
      }, status);
    }

    const data = await geminiResp.json();
    const raw = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : '';

    let parsed;
    try {
      const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('Could not parse Gemini presentation output as JSON:', raw);
      return json({ error: 'The AI returned something unexpected — please try again.', debug: raw.slice(0, 500) }, 502);
    }
    if (!parsed || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
      return json({ error: 'The AI did not return any slides — please try again.' }, 502);
    }

    return json({ ok: true, task: 'presentation', result: parsed });
  } catch (err) {
    console.error('Worker presentation error:', err);
    return json({ error: 'Something went wrong contacting the AI service.', debug: String(err && err.message || err) }, 500);
  }
}

function buildPrompt(task, text, count, ratio, hasAttachments) {
  const safeText = text.slice(0, 30000);
  // When there's a file attachment and little/no pasted text, point the
  // model at the attached file(s) instead of an (empty) quoted passage.
  const sourceRef = safeText
    ? `Passage:\n"""${safeText}"""`
    : `Use the content of the attached file(s) provided with this request as the source material.`;

  if (task === 'summarize') {
    const pct = Math.round((ratio || 0.3) * 100);
    return `You are an educational summarizer helping a student understand a passage. ` +
      `Summarize the passage below, keeping roughly ${pct}% of its original density of ideas — ` +
      `write in clear, simple language a student could read quickly. ` +
      `Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"headline": "a short 5-10 word title for the passage", ` +
      `"summary": ["point 1", "point 2", "..."], ` +
      `"terms": ["key term 1", "key term 2", "..."], ` +
      `"definitions": [{"term": "X", "explanation": "one-sentence explanation"}]}\n\n` +
      `${sourceRef}`;
  }

  if (task === 'quiz') {
    const n = count || 6;
    return `You are a teacher writing quiz questions from the passage below, for students who have ` +
      `just read it. Write ${n} varied questions that test real understanding of the ideas, not just ` +
      `matching words — mix short-answer and multiple-choice. ` +
      `Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"questions": [{"question": "...", "type": "short_answer", "answer": "..."}, ` +
      `{"question": "...", "type": "multiple_choice", "options": ["A", "B", "C", "D"], "answer": "B"}]}\n\n` +
      `${sourceRef}`;
  }

  if (task === 'milestones') {
    const n = count || 3;
    return `You are helping a teacher break the passage below into ${n} distinct daily learning ` +
      `milestones/activities for students, each focused on a different concept from the passage. ` +
      `Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"milestones": [{"title": "short activity title", ` +
      `"hint": "one sentence describing what the student should do or understand", "points": 15}]}\n\n` +
      `${sourceRef}`;
  }

  if (task === 'mindmap') {
    return `You are building a structural mind map of the source material below for a student, ` +
      `capturing its main topic and the distinct concepts/branches that support it. ` +
      `Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"title": "short 2-5 word main topic", "children": [{"label": "branch concept name, max 6 words", ` +
      `"children": [{"label": "supporting point, one short phrase or clause, max 12 words / ~65 characters"}, "..."]}, "..."]}\n` +
      `Include 4-7 top-level branches, each with 2-4 supporting points where the source material ` +
      `supports it. These labels render inside small fixed-size boxes on a mind-map diagram (roughly ` +
      `3 lines of text fit per box) — keep every label genuinely short and punchy, not a full sentence; ` +
      `trim to the core idea rather than writing something that will get cut off. Write in the same ` +
      `language as the source material (reply in Nepali/Devanagari if the input is Nepali).\n\n` +
      `${sourceRef}`;
  }

  return null;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders())
  });
}

/* ============================================================
   CURRENT AFFAIRS ("news" task)
   ============================================================
   Reads live public RSS feeds server-side (Workers fetch has no
   CORS restrictions, unlike the browser) and hands back a small,
   already-categorized JSON digest — no Gemini call, no API key
   needed. Uses Google News' public RSS endpoints, which are always
   current (today's stories) and don't require any account/key:
     - Nepal news:        Kathmandu Post, Himalayan Times, Online
                           Khabar & Nepali Times RSS + Google News
                           Nepal search (this is the majority-Nepal
                           category — see NEWS_FEEDS.nepal below)
     - International:     Google News' World topic feed + BBC World
     - Trade & Business:   Google News' Business topic feed + BBC
                           Business + a dedicated Nepal economy/NEPSE
                           search
     - Sports:              Google News' Nepal-sports search + BBC Sport
     - Other:              Google News' Technology topic feed + BBC Tech
     - Gold/Silver:        a live numeric rate scraped from Hamro
                           Patro's gold page (see fetchGoldSilverRate)
                           plus a headline search, surfaced on the
                           Nepal tab
     - Conflict Watch:     one freshest headline per tracked war/
                           conflict (see CONFLICT_WATCH), surfaced on
                           the International tab
     - Trending & More:    hiking/trekking/travel reads for Nepal
   Results are cached at Cloudflare's edge for NEWS_CACHE_SECONDS so
   repeated dashboard loads don't re-fetch every feed every time.
   BBC's feeds (feeds.bbci.co.uk) are included alongside Google News
   in most categories because Google News' RSS endpoint sometimes
   rate-limits or blocks requests coming from shared datacenter IPs
   (which is what a Cloudflare Worker uses) — BBC's feeds don't have
   that restriction, so they act as a much more reliable fallback
   than a second Google News query would be. Swap/add feed URLs below
   if you'd rather pull from specific outlets (Kathmandu Post, Al
   Jazeera, Reuters, etc.) — any standard RSS 2.0 feed works with the
   same parser. */

const NEWS_FEEDS = {
  // Each category now has more than one feed URL from more than one
  // provider — if one feed (or one provider entirely) comes back
  // empty or errors, the other(s) still have a shot at filling it.
  //
  // IMPORTANT — gl=NP vs gl=US: Google News' RSS endpoint behaves
  // very differently depending on the "gl" (geo) parameter when the
  // request comes from a shared datacenter IP, which is what a
  // Cloudflare Worker uses. gl=NP (Nepal-scoped results) reliably
  // comes back empty/blocked from Workers, while the exact same
  // search with gl=US works fine and still returns Nepal-relevant
  // stories (Google indexes them regardless of the geo param — geo
  // just biases ranking, it doesn't gate which stories exist). This
  // was the root cause of the empty Nepal News tab: every "nepal"
  // and "trending" feed used to be gl=NP-only with no other source
  // to fall back on. Every feed below now either uses gl=US or comes
  // from a real Nepali outlet directly (which has no such block).
  nepal: [
    'https://kathmandupost.com/rss',
    'https://thehimalayantimes.com/feed/',
    'https://english.onlinekhabar.com/feed/',
    'https://www.nepalitimes.com/feed/',
    'https://www.ronbpost.com/feed/', // Nepali-language outlet (Routine of Nepal Banda) — headlines come through in Devanagari, which is fine, this is the Nepal tab
    'https://news.google.com/rss/search?q=Nepal&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Nepal%20politics%20government&hl=en-US&gl=US&ceid=US:en'
  ],
  international: [
    'http://feeds.bbci.co.uk/news/world/rss.xml',
    'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=world%20news&hl=en-US&gl=US&ceid=US:en'
  ],
  trade: [
    'http://feeds.bbci.co.uk/news/business/rss.xml',
    'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=business%20markets&hl=en-US&gl=US&ceid=US:en',
    // Nepal-specific business/markets coverage (NEPSE, remittances,
    // trade deficit, budget, etc.) so this tab isn't purely global.
    'https://news.google.com/rss/search?q=Nepal%20economy%20NEPSE%20business&hl=en-US&gl=US&ceid=US:en'
  ],
  sports: [
    'http://feeds.bbci.co.uk/sport/rss.xml',
    // Was gl=NP (silently blocked) — switched to gl=US, same query.
    'https://news.google.com/rss/search?q=Nepal%20sports%20cricket%20football&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en'
  ],
  other: [
    'http://feeds.bbci.co.uk/news/technology/rss.xml',
    'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en'
  ]
};

// Two evergreen/complementary pulls that don't depend on breaking
// news being available at all. Neither goes through the AI curation
// pass (see NEWS_CATEGORIES_FOR_AI below) — both are shown as-is,
// freshest first, straight from buildRawNewsCategories.
//
//   - goldsilver: dedicated gold/silver rate headlines. Kept as its
//     own category (rather than folded into "trending") specifically
//     so the frontend can surface a small "today's rate" strip on
//     the Nepal tab itself, not just buried in a separate tab.
//   - trending: hiking/trekking/travel & general "more" reads, shown
//     under the Trending & More tab.
const GOLDSILVER_FEEDS = {
  goldsilver: [
    'https://news.google.com/rss/search?q=gold%20silver%20price%20Nepal%20today&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=%22gold%20price%22%20Nepal&hl=en-US&gl=US&ceid=US:en'
  ]
};

const TRENDING_FEEDS = {
  trending: [
    'https://news.google.com/rss/search?q=hiking%20trekking%20Nepal&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Nepal%20travel%20tourism%20festival&hl=en-US&gl=US&ceid=US:en'
  ]
};

const ALL_NEWS_FEEDS = Object.assign({}, NEWS_FEEDS, TRENDING_FEEDS, GOLDSILVER_FEEDS);
const NEWS_CACHE_SECONDS = 600; // 10 minutes — keeps loads snappy without hammering the feeds constantly

/* ------------------------------------------------------------
   CONFLICT WATCH — a small "is this war still going on" panel
   shown on the International tab. For each tracked conflict, we
   pull the single freshest real headline (so the person can see
   at a glance whether it's still active, paused, or resolved) and
   link straight to the article. This list of tracked conflicts is
   hand-maintained, not detected automatically — wars start and end,
   so it needs an occasional look to add/remove entries as the
   world changes. Nothing here is written by AI; every headline,
   source, and link is exactly what Google News returned.
   ------------------------------------------------------------ */
const CONFLICT_WATCH = [
  { id: 'ukraine', label: 'Russia–Ukraine War', query: 'Ukraine Russia war' },
  { id: 'gaza', label: 'Israel–Gaza Conflict', query: 'Israel Gaza Hamas conflict' },
  { id: 'sudan', label: 'Sudan Civil War', query: 'Sudan war RSF civil war' },
  { id: 'myanmar', label: 'Myanmar Civil War', query: 'Myanmar civil war junta' }
];

async function fetchConflictWatch() {
  const results = await Promise.all(CONFLICT_WATCH.map(async (c) => {
    try {
      const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(c.query) + '&hl=en-US&gl=US&ceid=US:en';
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiveEduNewsBot/1.0; +https://divedu.app)' } });
      if (!resp.ok) return null;
      const xml = await resp.text();
      const items = parseRssItems(xml);
      items.sort((a, b) => (b.pubDateMs || 0) - (a.pubDateMs || 0));
      const top = items[0];
      if (!top) return null;
      return { id: c.id, label: c.label, title: top.title, link: top.link, source: top.source, pubDate: top.pubDate };
    } catch (e) {
      console.error('Conflict watch feed error (' + c.id + '):', e && e.message);
      return null;
    }
  }));
  return results.filter(Boolean);
}

/* ------------------------------------------------------------
   GOLD/SILVER RATE SCRAPE — pulls the actual current Nepal gold &
   silver price (per tola) straight from Hamro Patro's rate page,
   the way the user requested, rather than just linking to a news
   article about the price. Hamro Patro's page is server-rendered
   (the numbers are present in the plain HTML response, no JS
   execution needed), so this strips tags down to plain text and
   pulls the figures out with a couple of regexes.
   This is a best-effort scrape of someone else's page markup, so
   it's wrapped in try/catch and returns null on any mismatch — if
   Hamro Patro redesigns the page and the regex stops matching, the
   frontend just falls back to a "check hamropatro.com" link instead
   of showing a wrong number. Never invents a price. */
async function fetchGoldSilverRate() {
  try {
    const resp = await fetch('https://www.hamropatro.com/en/gold', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiveEduNewsBot/1.0; +https://divedu.app)' }
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const text = decodeXmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
    ).trim();

    const parseMetal = (label) => {
      const re = new RegExp(label + '[^%]{0,40}?([+-]?\\d+(?:\\.\\d+)?%)[^R]{0,20}?Rs\\s*([\\d,]+)[^\\n]{0,30}?(Increase|Decrease)\\s*Rs\\s*([\\d,]+)', 'i');
      const m = text.match(re);
      if (!m) return null;
      return {
        pricePerTola: 'Rs ' + m[2],
        changePercent: m[1],
        direction: m[3].toLowerCase(),
        changeAmount: 'Rs ' + m[4]
      };
    };

    const gold = parseMetal('Gold\\s*\\(Hallmark\\)');
    const silver = parseMetal('Silver');
    const updatedMatch = text.match(/Last updated:\s*([^]*?)(?:\s*-|\s*Gold|\s*$)/i);

    if (!gold && !silver) return null;
    return {
      gold,
      silver,
      updated: updatedMatch ? updatedMatch[1].trim().slice(0, 40) : null,
      sourceUrl: 'https://www.hamropatro.com/en/gold'
    };
  } catch (e) {
    console.error('Gold/silver rate scrape failed:', e && e.message);
    return null;
  }
}

const NEWS_ITEMS_PER_CATEGORY = 14;
const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000; // prefer stories from the last ~2 days
const MIN_RECENT_ITEMS = 3; // if fewer than this many recent stories exist, widen the window instead of showing an empty tab
const NEWS_CATEGORIES_FOR_AI = ['nepal', 'international', 'trade', 'sports', 'other'];
const AI_NEWS_TIMEOUT_MS = 20000;

async function handleNews(body, env) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  // Bumped v5 -> v6: added conflicts[] and goldRate to the payload
  // shape (more Nepal sources, conflict watch, live gold/silver
  // scrape) — an old cache key would keep serving the previous
  // response, without these fields, for up to NEWS_CACHE_SECONDS.
  const cacheKey = new Request('https://divedu-news-cache.internal/v6');

  if (cache && !body.forceRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  // Fetch every feed (news categories + the evergreen trending ones),
  // the conflict watch, and the gold/silver rate scrape all in
  // parallel — none of this touches Gemini, it's just reading public
  // pages/RSS server-side.
  const categoryEntries = Object.entries(ALL_NEWS_FEEDS);
  const [fetched, conflicts, goldRate] = await Promise.all([
    Promise.all(categoryEntries.map(async ([key, urls]) => {
      const items = [];
      for (const url of urls) {
        try {
          const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiveEduNewsBot/1.0; +https://divedu.app)' } });
          if (!resp.ok) continue;
          const xml = await resp.text();
          items.push(...parseRssItems(xml));
        } catch (e) {
          console.error('News feed error (' + key + '):', url, e && e.message);
          // Skip a feed that's down rather than failing the whole category.
        }
      }
      const seen = new Set();
      const deduped = items.filter(it => {
        const k = it.title.toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      deduped.sort((a, b) => (b.pubDateMs || 0) - (a.pubDateMs || 0));
      return [key, deduped.slice(0, 20)]; // cap per feed-category before any AI pass, keeps the prompt small
    })),
    fetchConflictWatch(),
    fetchGoldSilverRate()
  ]);

  const rawByCategory = fetched.filter(([key]) => key !== 'trending' && key !== 'goldsilver');
  const trendingRaw = fetched.find(([key]) => key === 'trending');
  const goldsilverRaw = fetched.find(([key]) => key === 'goldsilver');

  // The primary source of truth — plain recency-sorted RSS/BBC, no AI
  // involved. This is always computed, and is exactly what gets used
  // if the AI pass below is unavailable or fails for any reason.
  const rawCategories = buildRawNewsCategories(rawByCategory);
  let categories = rawCategories;
  let source = 'rss';

  if (env && env.GEMINI_API_KEY) {
    try {
      const aiCategories = await curateNewsWithAI(rawByCategory, env);
      if (aiCategories) { categories = aiCategories; source = 'ai'; }
    } catch (e) {
      console.error('AI news curation unavailable, using primary RSS/BBC source:', e && e.message);
      // categories stays as rawCategories — the primary source.
    }
  }

  categories.trending = buildRawNewsCategories(trendingRaw ? [trendingRaw] : []).trending || [];
  categories.goldsilver = buildRawNewsCategories(goldsilverRaw ? [goldsilverRaw] : []).goldsilver || [];

  const payload = { ok: true, task: 'news', result: { categories, conflicts: conflicts || [], goldRate: goldRate || null, fetchedAt: new Date().toISOString(), source } };
  const resp = json(payload);
  resp.headers.set('Cache-Control', 'public, max-age=' + NEWS_CACHE_SECONDS);

  if (cache) {
    try { await cache.put(cacheKey, resp.clone()); } catch (e) { /* edge cache best-effort, not fatal */ }
  }
  return resp;
}

/** THE PRIMARY SOURCE. Turns raw per-category RSS/BBC items into the
 *  final trimmed shape the frontend expects, using only recency —
 *  no AI involved. This is what every category uses when the AI
 *  pass below is skipped (no key configured) or fails for any
 *  reason, so news never depends on Gemini being up. */
function buildRawNewsCategories(rawByCategory) {
  const now = Date.now();
  const categories = {};
  for (const [key, items] of rawByCategory) {
    // Prefer stories from the last ~2 days. Only fall back to older
    // stories if the recent window didn't turn up enough to fill a
    // tab — better than showing nothing, and still freshest-first.
    const recent = items.filter(it => it.pubDateMs && (now - it.pubDateMs) <= RECENT_WINDOW_MS);
    const pool = recent.length >= MIN_RECENT_ITEMS ? recent : items;
    categories[key] = pool.slice(0, NEWS_ITEMS_PER_CATEGORY)
      .map(it => ({ title: it.title, link: it.link, source: it.source, pubDate: it.pubDate }));
  }
  return categories;
}

/** OPTIONAL AI ENHANCEMENT LAYER. Takes the real headlines already
 *  fetched from RSS/BBC (rawByCategory) and asks Gemini to clean the
 *  digest up: drop near-duplicate stories that multiple outlets
 *  reported, fix any headline that landed in the wrong category, and
 *  pick the freshest/most relevant ones per category.
 *
 *  Gemini NEVER writes headline text, sources, or links itself — it
 *  only ever returns which of the already-fetched items (referenced
 *  by a numeric idx) belong in which category. The response is
 *  mapped back onto the real fetched items afterward, so there is no
 *  way for the model to invent a story, a source, or a URL; it can
 *  only reorganize what was actually fetched. If the call fails, times
 *  out, or returns something unusable, the caller (handleNews) simply
 *  keeps using the plain RSS/BBC result computed by
 *  buildRawNewsCategories — the AI layer is additive, never required. */
async function curateNewsWithAI(rawByCategory, env) {
  const now = Date.now();
  const pool = [];
  const seenGlobal = new Set();
  for (const [key, items] of rawByCategory) {
    for (const it of items) {
      const k = it.title.toLowerCase();
      if (!k || seenGlobal.has(k)) continue; // de-dupe the exact same headline across feeds before even asking the AI
      seenGlobal.add(k);
      pool.push({
        idx: pool.length,
        title: it.title,
        link: it.link,
        source: it.source,
        pubDate: it.pubDate,
        hoursAgo: it.pubDateMs ? Math.round((now - it.pubDateMs) / 3600000) : null,
        category: key
      });
    }
  }
  if (pool.length === 0) return null;

  const compact = pool.slice(0, 100).map(it => ({ idx: it.idx, title: it.title, source: it.source || '', hoursAgo: it.hoursAgo, category: it.category }));

  const prompt =
    `You are curating a live news digest for a Nepal-based classroom platform (ज्ञानSetु / DiveEdu) from real ` +
    `headlines already fetched server-side from Google News and BBC RSS feeds — nothing below was written by you. ` +
    `Each object has: "idx" (a stable reference number), "title", "source" (outlet name), "hoursAgo" (age in hours, ` +
    `or null if unknown), and "category" (which feed it was originally fetched under: nepal, international, trade, ` +
    `sports, or other — this is sometimes wrong and needs correcting).\n\n` +
    `Your job:\n` +
    `1. Drop near-duplicate stories — the same real-world event reported by more than one outlet — keeping only ` +
    `the single best/freshest version.\n` +
    `2. Move any clearly miscategorized headline into its correct category (e.g. a cricket result filed under ` +
    `"other" belongs in "sports").\n` +
    `3. Prefer lower hoursAgo (fresher) stories when deciding what to keep or which duplicate to drop.\n` +
    `4. For each of the 5 categories, return up to ${NEWS_ITEMS_PER_CATEGORY} idx values, freshest/most relevant first.\n\n` +
    `CRITICAL: you may ONLY reference idx numbers that appear in the input list below. Never invent a headline, a ` +
    `source, a link, or an idx that isn't listed — you are selecting and organizing existing items, not writing ` +
    `new ones. Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
    `{"nepal": [idx, idx], "international": [idx, idx], "trade": [idx, idx], "sports": [idx, idx], "other": [idx, idx]}\n\n` +
    `Headlines:\n${JSON.stringify(compact)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_NEWS_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        }),
        signal: controller.signal
      }
    );
    if (!resp.ok) throw new Error('Gemini news curation responded ' + resp.status);

    const data = await resp.json();
    const raw = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : '';
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(cleaned);

    const byIdx = new Map(pool.map(it => [it.idx, it]));
    const categories = {};
    let totalItems = 0;
    for (const cat of NEWS_CATEGORIES_FOR_AI) {
      const idxList = Array.isArray(parsed[cat]) ? parsed[cat] : [];
      const items = idxList
        .map(i => byIdx.get(i))
        .filter(Boolean) // defensively ignore any out-of-range/invented idx instead of trusting it
        .slice(0, NEWS_ITEMS_PER_CATEGORY)
        .map(it => ({ title: it.title, link: it.link, source: it.source, pubDate: it.pubDate }));
      categories[cat] = items;
      totalItems += items.length;
    }
    if (totalItems === 0) throw new Error('AI curation returned no usable items');
    return categories;
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal, dependency-free RSS <item> extractor. Cloudflare Workers
 *  have no DOMParser/XML parser built in, so this pulls title/link/
 *  pubDate/source out of each <item>...</item> block with regex —
 *  good enough for the well-formed RSS 2.0 that Google News (and
 *  virtually every news outlet's own feed) emits. */
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    let title = decodeXmlEntities(extractXmlTag(block, 'title'));
    const link = decodeXmlEntities(extractXmlTag(block, 'link'));
    const pubDate = extractXmlTag(block, 'pubDate');
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const source = sourceMatch ? decodeXmlEntities(sourceMatch[1]) : '';
    if (!title) continue;
    // Google News titles are often "Headline - Source Name" with the
    // same source repeated in its own <source> tag — strip the
    // duplicate suffix so the headline reads cleanly on its own.
    if (source && title.endsWith(' - ' + source)) {
      title = title.slice(0, title.length - source.length - 3).trim();
    }
    const pubDateMs = pubDate ? Date.parse(pubDate) : NaN;
    items.push({ title, link, source, pubDate, pubDateMs: isNaN(pubDateMs) ? 0 : pubDateMs });
  }
  return items;
}

function extractXmlTag(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  if (!m) return '';
  let val = m[1].trim();
  const cdata = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) val = cdata[1];
  return val.trim();
}

function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
