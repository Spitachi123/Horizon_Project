/* ============================================================
   PRESENTATION-ENGINE.JS — the AI Presentation Creator's brain
   (ai-presentation.html).

   Talks to the same Cloudflare Worker as chat-engine.js / llm-
   engine.js, using a new "presentation" task the worker now
   understands (see cloudflare-worker.js: handlePresentation).
   Input can be a typed topic, pasted notes/outline, and/or
   uploaded files (image/PDF/DOCX/TXT) in any combination — the
   worker turns whichever of those it gets into a structured
   slide-deck JSON.

   From that JSON this file builds TWO outputs, both without ever
   leaving the app or hitting a server-side file converter:
     1. An in-app web slideshow (renderDeck) — plain HTML/CSS
        slides with prev/next navigation and a fullscreen present
        mode.
     2. A real downloadable .pptx file (exportPptx) — built
        entirely in the browser with PptxGenJS, triggered as a
        normal file download.

   Load order: ai-engine.js, llm-engine.js, chat-engine.js (reused
   here for its file-reading helpers: prepareAttachment / mammoth
   DOCX extraction), then this file. PptxGenJS itself is lazy-
   loaded from a CDN only when the user actually clicks "Download
   PPTX", so the page doesn't pay for it up front.
   ============================================================ */

const PresentationEngine = (() => {
  // Same worker as chat-engine.js / llm-engine.js — keep all three
  // URLs in sync if you redeploy the worker somewhere else.
  const WORKER_URL = 'https://divedu-ai-proxy.pandusujan123.workers.dev';
  const TIMEOUT_MS = 60000; // deck generation is a bigger request than a single chat turn
  const PPTXGENJS_URL = 'https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';

  function isConfigured() {
    return WORKER_URL && WORKER_URL.startsWith('http') && !WORKER_URL.includes('REPLACE-ME');
  }

  /* ---------------- talking to the worker ---------------- */

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
        err.isWorkerError = true;
        throw err;
      }
      return data.result;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const e = new Error('The AI took too long to design the deck.');
        e.isTimeout = true;
        throw e;
      }
      throw err;
    }
  }

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

  function serializeAttachment(att) {
    return { kind: att.kind, mimeType: att.mimeType, data: att.data, text: att.text, name: att.name };
  }

  /** Generates a slide deck from a topic and/or notes and/or files.
   *  `files` are raw <input type="file"> File objects — reused via
   *  ChatEngine.prepareAttachment() (images/PDFs as base64, DOCX/TXT
   *  as extracted text) so this page doesn't duplicate that logic. */
  async function generate({ topic, notes, files, slideCount, onFileProgress }) {
    const attachments = [];
    const fileList = files || [];
    for (let i = 0; i < fileList.length; i++) {
      const att = await ChatEngine.prepareAttachment(fileList[i]);
      attachments.push(serializeAttachment(att));
      if (onFileProgress) onFileProgress(i + 1, fileList.length);
    }
    const result = await callWorker({
      task: 'presentation',
      topic: (topic || '').slice(0, 500),
      notes: (notes || '').slice(0, 30000),
      slideCount: slideCount || 8,
      attachments
    });
    if (!result || !Array.isArray(result.slides) || result.slides.length === 0) {
      throw new Error('The AI did not return any slides — please try again.');
    }
    return result;
  }

  /* ---------------- theme palettes (shared by web + pptx) ---------------- */

  const THEMES = {
    blue:   { bg: '1E293B', accent: '3B82F6', accentLight: 'DBEAFE', text: 'F8FAFC', dark: false },
    green:  { bg: '14532D', accent: '22C55E', accentLight: 'DCFCE7', text: 'F0FDF4', dark: false },
    purple: { bg: '2E1065', accent: 'A855F7', accentLight: 'F3E8FF', text: 'FAF5FF', dark: false },
    warm:   { bg: '7C2D12', accent: 'F97316', accentLight: 'FFEDD5', text: 'FFF7ED', dark: false },
    dark:   { bg: '0F172A', accent: '38BDF8', accentLight: '1E293B', text: 'F1F5F9', dark: true }
  };
  function themeOf(deck) { return THEMES[deck && deck.theme] || THEMES.blue; }

  /* ---------------- in-app web slideshow ---------------- */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function slideHtml(slide, theme, index, total) {
    const layout = slide.layout || 'bullets';
    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    let inner = '';

    if (layout === 'title') {
      inner = `<div class="pe-slide-title-layout">
        <h1>${escapeHtml(slide.title)}</h1>
        ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
      </div>`;
    } else if (layout === 'sectionHeader') {
      inner = `<div class="pe-slide-section-layout">
        <div class="pe-section-num">${String(index + 1).padStart(2, '0')}</div>
        <h2>${escapeHtml(slide.title)}</h2>
        ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
      </div>`;
    } else if (layout === 'quote') {
      inner = `<div class="pe-slide-quote-layout">
        <i class="fa-solid fa-quote-left pe-quote-mark"></i>
        <p class="pe-quote-text">${escapeHtml(slide.quote || slide.title)}</p>
        ${slide.attribution ? `<p class="pe-quote-attr">— ${escapeHtml(slide.attribution)}</p>` : ''}
      </div>`;
    } else if (layout === 'twoColumn') {
      inner = `<h2>${escapeHtml(slide.title)}</h2>
      <div class="pe-two-col">
        <div class="pe-col">
          ${slide.leftTitle ? `<h4>${escapeHtml(slide.leftTitle)}</h4>` : ''}
          <ul>${(slide.leftBullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </div>
        <div class="pe-col">
          ${slide.rightTitle ? `<h4>${escapeHtml(slide.rightTitle)}</h4>` : ''}
          <ul>${(slide.rightBullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </div>
      </div>`;
    } else if (layout === 'closing') {
      inner = `<div class="pe-slide-title-layout">
        <h1>${escapeHtml(slide.title)}</h1>
        ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
        ${bullets.length ? `<ul class="pe-closing-list">${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
      </div>`;
    } else {
      // 'bullets' / 'imageFocus' (imageFocus degrades gracefully to a bullets layout — no image generation here)
      inner = `<h2>${escapeHtml(slide.title)}</h2>
      ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
      <ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`;
    }

    return `<div class="pe-slide pe-layout-${layout}" data-index="${index}">
      <div class="pe-slide-inner">${inner}</div>
      <div class="pe-slide-footer"><span>${index + 1} / ${total}</span></div>
    </div>`;
  }

  /** Renders the deck into `container` as a navigable web slideshow.
   *  Returns a small controller object ({ next, prev, goTo, current }).
   *  Applies the deck's theme as CSS variables scoped to the
   *  container so multiple decks/themes never collide on one page. */
  function renderDeck(deck, container) {
    const theme = themeOf(deck);
    container.style.setProperty('--pe-bg', '#' + theme.bg);
    container.style.setProperty('--pe-accent', '#' + theme.accent);
    container.style.setProperty('--pe-accent-light', '#' + theme.accentLight);
    container.style.setProperty('--pe-text', '#' + theme.text);

    const total = deck.slides.length;
    container.innerHTML = `
      <div class="pe-viewer">
        <div class="pe-stage">${deck.slides.map((s, i) => slideHtml(s, theme, i, total)).join('')}</div>
        <div class="pe-controls">
          <button type="button" class="pe-nav-btn" data-act="prev" aria-label="Previous slide"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="pe-dots"></div>
          <button type="button" class="pe-nav-btn" data-act="next" aria-label="Next slide"><i class="fa-solid fa-chevron-right"></i></button>
          <button type="button" class="pe-nav-btn pe-fullscreen-btn" data-act="fullscreen" aria-label="Present fullscreen"><i class="fa-solid fa-expand"></i></button>
        </div>
      </div>`;

    const stage = container.querySelector('.pe-stage');
    const slides = Array.from(container.querySelectorAll('.pe-slide'));
    const dotsWrap = container.querySelector('.pe-dots');
    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'pe-dot';
      dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      dot.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(dot);
    });
    const dots = Array.from(dotsWrap.querySelectorAll('.pe-dot'));

    let current = 0;
    function show(i) {
      current = Math.max(0, Math.min(total - 1, i));
      stage.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, idx) => d.classList.toggle('active', idx === current));
    }
    function goTo(i) { show(i); }
    function next() { show(current + 1); }
    function prev() { show(current - 1); }

    container.querySelector('[data-act="prev"]').addEventListener('click', prev);
    container.querySelector('[data-act="next"]').addEventListener('click', next);
    container.querySelector('[data-act="fullscreen"]').addEventListener('click', () => {
      const viewer = container.querySelector('.pe-viewer');
      if (viewer.requestFullscreen) viewer.requestFullscreen();
    });
    container.tabIndex = 0;
    container.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    });

    show(0);
    return { next, prev, goTo, current: () => current, total };
  }

  /* ---------------- .pptx export (PptxGenJS, entirely client-side) ---------------- */

  let pptxLoading = null;
  function loadPptxGen() {
    if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
    if (pptxLoading) return pptxLoading;
    pptxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PPTXGENJS_URL;
      script.onload = () => resolve(window.PptxGenJS);
      script.onerror = () => reject(new Error('Could not load the PowerPoint export library — check your connection.'));
      document.head.appendChild(script);
    });
    return pptxLoading;
  }

  function addBulletsBox(slide, bullets, opts) {
    if (!bullets || !bullets.length) return;
    slide.addText(
      bullets.map(b => ({ text: b, options: { bullet: { code: '25AA', indent: 18 }, breakLine: true } })),
      Object.assign({ fontSize: 16, color: opts.textColor, fontFace: 'Arial', lineSpacingMultiple: 1.3 }, opts)
    );
  }

  /** Builds a real .pptx file from the deck and triggers a browser
   *  download — no server round-trip, the whole file is assembled
   *  in-memory by PptxGenJS and handed to the browser's normal save
   *  dialog. `deck.slides[i].notes` (if present) is written into the
   *  slide's speaker notes field. */
  async function exportPptx(deck, filename) {
    const PptxGenJSCtor = await loadPptxGen();
    const pres = new PptxGenJSCtor();
    pres.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
    pres.layout = 'WIDE';

    const theme = themeOf(deck);
    const bg = theme.bg, accent = theme.accent, textColor = theme.text;

    deck.slides.forEach((slide) => {
      const s = pres.addSlide();
      s.background = { color: bg };
      const layout = slide.layout || 'bullets';

      if (layout === 'title') {
        s.addText(slide.title || '', { x: 0.8, y: 2.6, w: 11.7, h: 1.6, fontSize: 44, bold: true, color: textColor, fontFace: 'Arial', align: 'left' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.8, y: 4.1, w: 11.7, h: 0.8, fontSize: 20, color: accent, fontFace: 'Arial', align: 'left' });
        s.addShape(pres.ShapeType.rect, { x: 0.8, y: 2.35, w: 1.6, h: 0.06, fill: { color: accent } });
      } else if (layout === 'sectionHeader') {
        s.addText(slide.title || '', { x: 0.8, y: 3.0, w: 11.7, h: 1.4, fontSize: 36, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.8, y: 4.3, w: 11.7, h: 0.7, fontSize: 18, color: accent, fontFace: 'Arial' });
      } else if (layout === 'quote') {
        s.addText('"' + (slide.quote || slide.title || '') + '"', { x: 1.2, y: 2.2, w: 10.9, h: 2.2, fontSize: 28, italic: true, color: textColor, fontFace: 'Georgia', align: 'center', valign: 'middle' });
        if (slide.attribution) s.addText('— ' + slide.attribution, { x: 1.2, y: 4.5, w: 10.9, h: 0.6, fontSize: 16, color: accent, fontFace: 'Arial', align: 'center' });
      } else if (layout === 'twoColumn') {
        s.addText(slide.title || '', { x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.leftTitle) s.addText(slide.leftTitle, { x: 0.6, y: 1.6, w: 5.9, h: 0.5, fontSize: 18, bold: true, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.leftBullets, { x: 0.6, y: 2.15, w: 5.9, h: 4.5, textColor });
        if (slide.rightTitle) s.addText(slide.rightTitle, { x: 6.85, y: 1.6, w: 5.9, h: 0.5, fontSize: 18, bold: true, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.rightBullets, { x: 6.85, y: 2.15, w: 5.9, h: 4.5, textColor });
      } else if (layout === 'closing') {
        s.addText(slide.title || '', { x: 0.8, y: 2.6, w: 11.7, h: 1.3, fontSize: 40, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.8, y: 3.9, w: 11.7, h: 0.7, fontSize: 18, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.bullets, { x: 0.8, y: 4.7, w: 11.7, h: 2, textColor });
      } else {
        s.addText(slide.title || '', { x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.6, y: 1.3, w: 12.1, h: 0.5, fontSize: 16, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.bullets, { x: 0.6, y: slide.subtitle ? 2.0 : 1.6, w: 12.1, h: 5, textColor });
      }

      if (slide.notes) s.addNotes(slide.notes);
    });

    await pres.writeFile({ fileName: filename || (sanitizeFilename(deck.title) + '.pptx') });
  }

  function sanitizeFilename(name) {
    return (name || 'Presentation').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Presentation';
  }

  return { isConfigured, generate, renderDeck, exportPptx, sanitizeFilename };
})();
