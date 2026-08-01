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

const GEMINI_MODEL = 'gemini-2.5-flash';
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

  if (task === 'mindmap') {
    return `You are building a mind map from the passage below, the same way a study tool like ` +
      `NotebookLM would: find the single central topic, then organize the passage's main ideas into ` +
      `a clear hierarchical tree (central topic -> main branches -> sub-points). Use short phrases ` +
      `(3-6 words), never full sentences. Use 4-7 main branches, each with 2-5 sub-points that are ` +
      `genuinely distinct ideas from the passage (not restatements of the branch). Sub-points may have ` +
      `their own short "children" array (max 2 more levels deep) only if the passage clearly supports ` +
      `a finer breakdown — otherwise omit "children" entirely on a leaf node. ` +
      `Respond ONLY with valid JSON (no markdown fences, no commentary) in exactly this shape:\n` +
      `{"title": "central topic, 2-6 words", "children": [{"label": "branch phrase", "children": ` +
      `[{"label": "sub-point phrase"}, {"label": "sub-point phrase", "children": [{"label": "..."}]}]}]}\n\n` +
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
