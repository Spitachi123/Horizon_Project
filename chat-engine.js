/* ============================================================
   CHAT-ENGINE.JS — the AI Chatbot's brain (ai-chat.html).

   This file was missing from the project entirely — ai-chat.html
   has always loaded <script src="chat-engine.js"></script>, but the
   file never existed, so `ChatEngine` was undefined and every send
   attempt threw immediately. That's the whole "chatbot not working"
   bug. This is the implementation that was missing.

   Talks to the same Cloudflare Worker as llm-engine.js (the one
   holding your Gemini API key), using a new "chat" task that the
   worker now understands (see cloudflare-worker.js) — full multi-
   turn history plus image/PDF attachments sent as inline base64
   data, and DOCX/TXT attachments sent as extracted plain text.

   Load order: ai-engine.js, then llm-engine.js (only used here for
   its isConfigured() check + PDF text extraction), then this file.
   ============================================================ */

const ChatEngine = (() => {
  // Same worker as llm-engine.js — keep both URLs in sync if you
  // redeploy the worker somewhere else.
  const WORKER_URL = 'https://divedu-ai-proxy.pandusujan123.workers.dev';
  const TIMEOUT_MS = 45000;

  function isConfigured() {
    return WORKER_URL && WORKER_URL.startsWith('http') && !WORKER_URL.includes('REPLACE-ME');
  }

  // File-reading (images/PDF/DOCX/plain text -> attachment shape) now
  // lives in AIEngine so every AI tool on the site shares one "read
  // any file format" implementation instead of each page reinventing
  // it. ai-engine.js loads before this file everywhere it's used.
  const prepareAttachment = AIEngine.prepareAttachment;
  const serializeAttachment = AIEngine.serializeAttachment;

  async function callWorkerOnce(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        const err = new Error(data.error || ('AI service error (' + resp.status + ')'));
        err.isWorkerError = true; // the worker responded — don't retry, it has a real answer (e.g. rate limit, safety block)
        throw err;
      }
      return data.result;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const e = new Error('The AI took too long to respond.');
        e.isTimeout = true;
        throw e;
      }
      throw err;
    }
  }

  /** Retries once on a timeout or network hiccup (fetch throwing
   *  TypeError, e.g. a dropped connection) — those are transient by
   *  nature. Does NOT retry when the worker itself responded with an
   *  error (rate limit, safety block, bad request), since retrying an
   *  answer that already came back wastes another 45s for the same
   *  result. */
  async function callWorker(body) {
    if (!isConfigured()) throw new Error('AI worker not configured yet — see cloudflare-worker.js setup instructions.');
    try {
      return await callWorkerOnce(body);
    } catch (err) {
      if (err.isWorkerError) throw err;
      const transient = err.isTimeout || err instanceof TypeError;
      if (!transient) throw err;
      try {
        return await callWorkerOnce(body);
      } catch (err2) {
        if (err2.isTimeout) throw new Error('The AI is taking unusually long to respond — please try again in a moment.');
        throw err2;
      }
    }
  }

  /** Sends one chat turn (message + optional attachments) plus the
   *  running conversation history, and returns the assistant's reply
   *  as a plain string. Throws with a user-facing message on failure
   *  — ai-chat.html already shows that inline, so no silent local
   *  fallback is attempted here (unlike the extractive AIEngine tasks,
   *  open-ended chat has no meaningful offline equivalent). */
  async function send({ message, history, attachments, nepali }) {
    const result = await callWorker({
      task: 'chat',
      message: (message || '').slice(0, 8000),
      history: (history || []).slice(-20),
      attachments: (attachments || []).slice(0, 4).map(serializeAttachment),
      nepali: !!nepali
    });
    return (result && result.reply) ? result.reply : "Sorry, I didn't get a response — please try again.";
  }

  return { send, prepareAttachment, isConfigured };
})();
