/* ============================================================
   LLM-ENGINE.JS — real generative AI for the AI Study Desk
   (h.html) and AI Teaching Assistant (teacher-ai.html).

   Talks to a small Cloudflare Worker (cloudflare-worker.js) that
   holds your free Gemini API key server-side — the key never
   ships to the browser. If the AI service is unreachable, rate-
   limited, or errors out, every function here automatically
   falls back to the local AIEngine (ai-engine.js) TextRank
   summarizer, so the page never goes blank — it just quietly
   switches to "offline mode".

   SETUP: after deploying cloudflare-worker.js, paste its URL
   below. Until you do, everything will just run in local/offline
   mode (same behavior as before).

   Load order: ai-engine.js must load BEFORE this file.
   ============================================================ */

const LLMEngine = (() => {
  const WORKER_URL = 'https://divedu-ai-proxy.pandusujan123.workers.dev'; // <-- set this after deploying the worker
  const TIMEOUT_MS = 20000;

  function isConfigured() {
    return WORKER_URL && WORKER_URL.startsWith('http') && !WORKER_URL.includes('REPLACE-ME');
  }

  async function callWorker(task, text, extra) {
    if (!isConfigured()) throw new Error('AI worker not configured yet');
    extra = extra || {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ task, text }, extra)),
        signal: controller.signal
      });
      clearTimeout(timer);
      let data;
      try {
        data = await resp.json();
      } catch (parseErr) {
        throw new Error('AI service returned an unexpected response (' + resp.status + ')');
      }
      if (!resp.ok || data.error) throw new Error(data.error || ('AI service error (' + resp.status + ')'));
      return data.result;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  /** Real AI summary via Gemini, shaped to match what h.html /
   *  teacher-ai.html already expect from AIEngine.summarize(),
   *  plus a `source` flag ('gemini' | 'local') so the UI can show
   *  which mode produced the result. */
  async function summarize(text, ratio) {
    try {
      const result = await callWorker('summarize', text, { ratio });
      return {
        headline: result.headline || '',
        summarySentences: Array.isArray(result.summary) ? result.summary : [],
        terms: Array.isArray(result.terms) ? result.terms : [],
        definitions: (Array.isArray(result.definitions) ? result.definitions : [])
          .map(d => ({ term: d.term, sentence: d.explanation })),
        sentenceCount: AIEngine.splitSentences(text).length,
        keptCount: Array.isArray(result.summary) ? result.summary.length : 0,
        source: 'gemini'
      };
    } catch (err) {
      console.warn('Gemini summarize unavailable, using local engine:', err.message);
      const fallback = AIEngine.summarize(text, ratio);
      if (fallback) fallback.source = 'local';
      return fallback;
    }
  }

  /** Real AI-generated quiz questions (short-answer + multiple-
   *  choice) instead of the old fill-in-the-blank-only approach. */
  async function draftQuestions(text, count) {
    try {
      const result = await callWorker('quiz', text, { count });
      return {
        questions: Array.isArray(result.questions) ? result.questions : [],
        source: 'gemini'
      };
    } catch (err) {
      console.warn('Gemini quiz unavailable, using local engine:', err.message);
      const local = AIEngine.draftQuestions(text, count);
      return {
        questions: local.map(q => ({
          question: `Fill in the blank: "${q.blanked}"`,
          type: 'short_answer',
          answer: q.answer
        })),
        source: 'local'
      };
    }
  }

  /** Real AI-generated milestone ideas, one per distinct concept. */
  async function draftMilestones(text, count) {
    try {
      const result = await callWorker('milestones', text, { count });
      return {
        milestones: Array.isArray(result.milestones) ? result.milestones : [],
        source: 'gemini'
      };
    } catch (err) {
      console.warn('Gemini milestones unavailable, using local engine:', err.message);
      const local = AIEngine.draftMilestones(text, count);
      return { milestones: local, source: 'local' };
    }
  }

  return { summarize, draftQuestions, draftMilestones, isConfigured };
})();
