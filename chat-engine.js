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
  const MAX_IMAGE_DIM = 1600; // downscale huge photos before sending, worker has a payload cap

  function isConfigured() {
    return WORKER_URL && WORKER_URL.startsWith('http') && !WORKER_URL.includes('REPLACE-ME');
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  /** Downscales an oversized image in a <canvas> before base64-encoding
   *  it, so a 12MP phone photo doesn't blow past the worker's request
   *  size limit or burn a huge chunk of the model's context. */
  function downscaleImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
        if (scale === 1) { resolve(null); return; } // small enough already, use original file
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  let mammothLoading = null;
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    if (mammothLoading) return mammothLoading;
    mammothLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.2/mammoth.browser.min.js';
      script.onload = () => resolve(window.mammoth);
      script.onerror = () => reject(new Error('Could not load the Word document reader.'));
      document.head.appendChild(script);
    });
    return mammothLoading;
  }

  async function extractDocxText(file) {
    const mammoth = await loadMammoth();
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return (result.value || '').trim();
  }

  /** Turns a raw <input type="file"> File into the shape the worker
   *  expects: images and PDFs travel as base64 (Gemini reads both
   *  natively — including handwriting/diagrams in photos and full
   *  PDF layout), DOCX/TXT travel as already-extracted plain text
   *  since Gemini has no native DOCX reader. */
  async function prepareAttachment(file, onProgress) {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isDocx = /\.docx$/i.test(file.name);

    if (isImage) {
      if (onProgress) onProgress(1, 1);
      const downscaled = await downscaleImage(file).catch(() => null);
      if (downscaled) return { kind: 'image', mimeType: downscaled.mimeType, data: downscaled.base64, name: file.name };
      const data = await fileToBase64(file);
      return { kind: 'image', mimeType: file.type || 'image/png', data, name: file.name };
    }
    if (isPdf) {
      if (onProgress) onProgress(1, 1);
      const data = await fileToBase64(file);
      return { kind: 'pdf', mimeType: 'application/pdf', data, name: file.name };
    }
    if (isDocx) {
      if (onProgress) onProgress(1, 1);
      const text = await extractDocxText(file);
      return { kind: 'file', mimeType: null, data: null, text, name: file.name };
    }
    // Plain text / anything else readable as text.
    if (onProgress) onProgress(1, 1);
    const text = await file.text();
    return { kind: 'file', mimeType: null, data: null, text, name: file.name };
  }

  function serializeAttachment(att) {
    return { kind: att.kind, mimeType: att.mimeType, data: att.data, text: att.text, name: att.name };
  }

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
