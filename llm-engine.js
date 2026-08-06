/* ============================================================
   LLM-ENGINE.JS — real generative AI for the AI Study Desk
   (h.html), AI Teaching Assistant (teacher-ai.html), and AI Mind
   Map (mindmap.html).

   Talks to a small Cloudflare Worker (cloudflare-worker.js) that
   holds your free Gemini API key server-side — the key never
   ships to the browser. If the AI service is unreachable, rate-
   limited, or errors out, every function here automatically
   falls back to the local AIEngine (ai-engine.js) TextRank
   summarizer, so the page never goes blank — it just quietly
   switches to "offline mode".

   Every function below can now take an optional `attachments`
   array (from AIEngine.prepareAttachment, same shape used by
   ChatEngine/PresentationEngine) so the summarizer, quiz/
   milestone drafter, and mind map builder can hand Gemini the
   actual file — image, PDF, DOCX, or plain text — instead of
   requiring pre-extracted text pasted into a textarea.

   SETUP: after deploying cloudflare-worker.js, paste its URL
   below. Until you do, everything will just run in local/offline
   mode (same behavior as before).

   Load order: ai-engine.js must load BEFORE this file.
   ============================================================ */

const LLMEngine = (() => {
  const WORKER_URL = 'https://divedu-ai-proxy.pandusujan123.workers.dev'; // <-- set this after deploying the worker
  const TIMEOUT_MS = 30000; // a bit above the plain-text default to leave room for file attachments

  function isConfigured() {
    return WORKER_URL && WORKER_URL.startsWith('http') && !WORKER_URL.includes('REPLACE-ME');
  }

  function serializeAttachments(attachments) {
    return (attachments || []).map(AIEngine.serializeAttachment);
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
      if (!resp.ok || data.error) {
        const msg = (data.error || ('AI service error (' + resp.status + ')')) +
          (data.debug ? ' | DEBUG: ' + data.debug : '');
        throw new Error(msg);
      }
      return data.result;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  /** Real AI summary via Gemini, shaped to match what h.html /
   *  teacher-ai.html already expect from AIEngine.summarize(),
   *  plus a `source` flag ('gemini' | 'local') so the UI can show
   *  which mode produced the result. `attachments` (optional) lets
   *  the passage come from an uploaded file instead of/alongside
   *  pasted text. */
  async function summarize(text, ratio, attachments) {
    try {
      const result = await callWorker('summarize', text, { ratio, attachments: serializeAttachments(attachments) });
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
      // Offline fallback only understands pasted/extracted text, not raw
      // file attachments, so it can only help when there's text to work with.
      const fallback = text ? AIEngine.summarize(text, ratio) : null;
      if (fallback) fallback.source = 'local';
      return fallback;
    }
  }

  /** Real AI-generated quiz questions (short-answer + multiple-
   *  choice) instead of the old fill-in-the-blank-only approach.
   *  `attachments` (optional) lets the source come from a file. */
  async function draftQuestions(text, count, attachments) {
    try {
      const result = await callWorker('quiz', text, { count, attachments: serializeAttachments(attachments) });
      return {
        questions: Array.isArray(result.questions) ? result.questions : [],
        source: 'gemini'
      };
    } catch (err) {
      console.warn('Gemini quiz unavailable, using local engine:', err.message);
      const local = text ? AIEngine.draftQuestions(text, count) : [];
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

  /** Real AI-generated milestone ideas, one per distinct concept.
   *  `attachments` (optional) lets the source come from a file. */
  async function draftMilestones(text, count, attachments) {
    try {
      const result = await callWorker('milestones', text, { count, attachments: serializeAttachments(attachments) });
      return {
        milestones: Array.isArray(result.milestones) ? result.milestones : [],
        source: 'gemini'
      };
    } catch (err) {
      console.warn('Gemini milestones unavailable, using local engine:', err.message);
      const local = text ? AIEngine.draftMilestones(text, count) : [];
      return { milestones: local, source: 'local' };
    }
  }

  /** Real AI-generated structural mind map (used by mindmap.html).
   *  `attachments` (optional) lets the source be an uploaded file —
   *  image, PDF, DOCX, or plain text — sent straight to Gemini
   *  instead of extracting text client-side first. Falls back to
   *  AIEngine's local TextRank-based mind map builder when offline,
   *  which needs actual text to work with. */
  async function draftMindmap(text, attachments) {
    try {
      const result = await callWorker('mindmap', text, { attachments: serializeAttachments(attachments) });
      return {
        mindmap: {
          title: (result && result.title) || 'Main topic',
          children: (result && Array.isArray(result.children)) ? result.children : []
        },
        source: 'gemini'
      };
    } catch (err) {
      console.warn('Gemini mindmap unavailable, using local engine:', err.message);
      const mindmap = text ? AIEngine.buildMindmap(text) : { title: 'No content found', children: [] };
      return { mindmap, source: 'local' };
    }
  }

  return { summarize, draftQuestions, draftMilestones, draftMindmap, isConfigured };
})();
