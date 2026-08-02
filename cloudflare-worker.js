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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'This endpoint only accepts POST requests.' }, 405);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is missing GEMINI_API_KEY — add it in Worker Settings.' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const task = body.task;

    // Chatbot turns have a different shape (message + history +
    // attachments, no single `text` field) and can legitimately be
    // attachment-only with no text, so it gets its own path entirely.
    if (task === 'chat') {
      return handleChat(body, env);
    }

    const text = (body.text || '').toString();

    if (!text || text.trim().length < 10) {
      return json({ error: 'Please provide a longer passage of text.' }, 400);
    }
    if (text.length > MAX_INPUT_CHARS) {
      return json({ error: 'That text is too long for this endpoint — please shorten it.' }, 400);
    }

    const prompt = buildPrompt(task, text, body.count, body.ratio);
    if (!prompt) {
      return json({ error: 'Unknown task type: ' + task }, 400);
    }

    try {
      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
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

function buildPrompt(task, text, count, ratio) {
  const safeText = text.slice(0, 30000);

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
      `Passage:\n"""${safeText}"""`;
  }

  if (task === 'quiz') {
    const n = count || 6;
    return `You are a teacher writing quiz questions from the passage below, for students who have ` +
      `just read it. Write ${n} varied questions that test real understanding of the ideas, not just ` +
      `matching words — mix short-answer and multiple-choice. ` +
      `Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"questions": [{"question": "...", "type": "short_answer", "answer": "..."}, ` +
      `{"question": "...", "type": "multiple_choice", "options": ["A", "B", "C", "D"], "answer": "B"}]}\n\n` +
      `Passage:\n"""${safeText}"""`;
  }

  if (task === 'milestones') {
    const n = count || 3;
    return `You are helping a teacher break the passage below into ${n} distinct daily learning ` +
      `milestones/activities for students, each focused on a different concept from the passage. ` +
      `Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"milestones": [{"title": "short activity title", ` +
      `"hint": "one sentence describing what the student should do or understand", "points": 15}]}\n\n` +
      `Passage:\n"""${safeText}"""`;
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
