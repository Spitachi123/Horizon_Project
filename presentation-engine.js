/* ============================================================
   PRESENTATION-ENGINE.JS — the AI Presentation Creator's brain
   (ai-presentation.html).

   Talks to the same Cloudflare Worker as chat-engine.js / llm-
   engine.js, using a "presentation" task the worker understands
   (see cloudflare-worker.js: handlePresentation). Input can be a
   typed topic, pasted notes/outline, and/or uploaded files
   (image/PDF/DOCX/TXT) in any combination — the worker turns
   whichever of those it gets into a structured slide-deck JSON.

   The SAME deck JSON shape also powers "Manual Build" mode, where
   a person assembles slides by hand (see createEmptyDeck /
   createEmptySlide below) instead of asking the AI — both modes
   feed the exact same renderDeck() / exportPptx() pipeline, so a
   hand-built deck looks and exports identically to an AI one.

   From that JSON this file builds TWO outputs, both without ever
   leaving the app or hitting a server-side file converter:
     1. An in-app web slideshow (renderDeck) — plain HTML/CSS
        slides with prev/next navigation and a fullscreen present
        mode.
     2. A real downloadable .pptx file (exportPptx) — built
        entirely in the browser with PptxGenJS, triggered as a
        normal file download.

   PREVIEW/EXPORT PARITY: both outputs share one theme table
   (THEMES) and one gradient generator (buildGradientDataUrl), so
   the .pptx background, blob decorations, bullet style and section
   markers are built to visually match the on-screen preview rather
   than falling back to flat PptxGenJS defaults.

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

  /** Generates one illustration via the worker's "presentationImage"
   *  task. Returns { mimeType, data(base64) } or null if generation
   *  fails (image failures are non-fatal — the slide/gallery tile
   *  just renders without one). */
  async function generateSlideImage(prompt, theme) {
    try {
      return await callWorker({ task: 'presentationImage', prompt, theme: theme || 'blue' });
    } catch (err) {
      console.warn('Slide image failed:', err.message);
      return null;
    }
  }

  /** Collects every image job in a deck: a slide's own imagePrompt,
   *  PLUS every image inside a "gallery" slide's images[] array that
   *  has its own imagePrompt. Used both to size progress counters in
   *  the UI and to drive generateImages() below. */
  function collectImageJobs(deck, maxImages) {
    const jobs = [];
    (deck.slides || []).forEach((s, i) => {
      if (s.imagePrompt && s.imagePrompt.trim()) jobs.push({ type: 'slide', i, s, prompt: s.imagePrompt });
      if (s.layout === 'gallery' && Array.isArray(s.images)) {
        s.images.forEach((im, gi) => {
          if (im && im.imagePrompt && im.imagePrompt.trim()) jobs.push({ type: 'gallery', i, s, gi, im, prompt: im.imagePrompt });
        });
      }
    });
    return typeof maxImages === 'number' ? jobs.slice(0, maxImages) : jobs;
  }
  function countImageJobs(deck) { return collectImageJobs(deck).length; }

  /** Generates illustrations for every image job in `deck` (slide
   *  hero/split images AND gallery tiles), a few at a time (default
   *  concurrency 2). Mutates the deck in place as results land and
   *  calls onSlideDone(index, slide) / onGalleryImageDone(index,
   *  galleryIndex, slide) after each one — that's what lets images
   *  fill in progressively in the UI instead of the user waiting for
   *  all of them before seeing anything. Safe to call multiple
   *  times / abandon early. */
  async function generateImages(deck, { concurrency = 2, maxImages = 12, onSlideDone, onGalleryImageDone } = {}) {
    const targets = collectImageJobs(deck, maxImages);
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const job = targets[cursor++];
        const img = await generateSlideImage(job.prompt, deck.theme);
        if (job.type === 'slide') {
          if (img) { job.s.imageData = img.data; job.s.imageMime = img.mimeType || 'image/png'; }
          if (onSlideDone) onSlideDone(job.i, job.s);
        } else {
          if (img) { job.im.imageData = img.data; job.im.imageMime = img.mimeType || 'image/png'; }
          if (onGalleryImageDone) onGalleryImageDone(job.i, job.gi, job.s);
        }
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, targets.length) }, worker);
    await Promise.all(workers);
    return deck;
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

  /* ---------------- theme palettes (shared by web + pptx) ----------------
     12 templates total. Each is a dark, high-contrast "field guide"
     style palette (bg → bg2 radial gradient, one accent, one near-
     white text) so every template automatically looks cohesive
     without per-slide art direction. Keep the KEY set in sync with
     cloudflare-worker.js's presentation prompt (handlePresentation)
     so the AI can pick any of them by name. */
  const THEMES = {
    blue:    { name: 'Classic Blue',   bg: '0F2A4A', bg2: '1E3A8A', accent: '60A5FA', accentLight: 'DBEAFE', text: 'F8FAFC' },
    green:   { name: 'Forest Green',   bg: '052E1E', bg2: '14532D', accent: '4ADE80', accentLight: 'DCFCE7', text: 'F0FDF4' },
    purple:  { name: 'Royal Purple',   bg: '2E1065', bg2: '4C1D95', accent: 'C084FC', accentLight: 'F3E8FF', text: 'FAF5FF' },
    warm:    { name: 'Sunset Warm',    bg: '431407', bg2: '7C2D12', accent: 'FB923C', accentLight: 'FFEDD5', text: 'FFF7ED' },
    dark:    { name: 'Midnight Dark',  bg: '020617', bg2: '0F172A', accent: '38BDF8', accentLight: '1E293B', text: 'F1F5F9' },
    teal:    { name: 'Ocean Teal',     bg: '0C4A46', bg2: '115E59', accent: '2DD4BF', accentLight: 'CCFBF1', text: 'F0FDFA' },
    rose:    { name: 'Rose Gold',      bg: '4C0519', bg2: '881337', accent: 'FB7185', accentLight: 'FFE4E6', text: 'FFF1F2' },
    slate:   { name: 'Slate Gray',     bg: '0F172A', bg2: '1E293B', accent: '94A3B8', accentLight: 'E2E8F0', text: 'F8FAFC' },
    amber:   { name: 'Golden Amber',   bg: '451A03', bg2: '78350F', accent: 'FBBF24', accentLight: 'FEF3C7', text: 'FFFBEB' },
    crimson: { name: 'Crimson Red',    bg: '450A0A', bg2: '7F1D1D', accent: 'F87171', accentLight: 'FEE2E2', text: 'FEF2F2' },
    mono:    { name: 'Mono Ink',       bg: '0A0A0A', bg2: '1A1A1A', accent: 'E5E5E5', accentLight: 'F5F5F5', text: 'FAFAFA' },
    sunrise: { name: 'Sunrise Coral',  bg: '451A2C', bg2: '831843', accent: 'FB923C', accentLight: 'FFEDD5', text: 'FFF7ED' }
  };
  function themeOf(deck) { return THEMES[deck && deck.theme] || THEMES.blue; }
  /** Flat array (with `key`) for building a template-picker UI. */
  const THEME_LIST = Object.keys(THEMES).map(key => Object.assign({ key }, THEMES[key]));

  /* ---------------- gradient background (preview/export parity) ----------------
     Both the web preview AND the .pptx export now paint the SAME
     rasterized PNG as their background (renderDeck sets it as a CSS
     background-image via --pe-bg-image; exportPptx uses it directly
     as the slide background) — true pixel parity instead of two
     independently-tuned gradients drifting apart over time.

     The raster itself is a layered "field guide" look: a radial
     accent wash in the top-left, a soft accent glow bottom-right for
     depth, a fine dot-grid texture for a premium non-flat feel, and a
     gentle vignette to ground the edges. */
  const gradientCache = {};
  function hexToRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function buildGradientDataUrl(theme) {
    const key = theme.bg + '_' + theme.bg2 + '_' + theme.accent;
    if (gradientCache[key]) return gradientCache[key];
    const W = 1280, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 1. Base radial wash — brighter accent-tinted corner fading to the deep base tone.
    const cx = W * 0.16, cy = H * 0.14;
    const r = Math.max(W, H) * 1.2;
    const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    base.addColorStop(0, '#' + theme.bg2);
    base.addColorStop(0.58, '#' + theme.bg);
    base.addColorStop(1, '#' + theme.bg);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // 2. Soft accent glow, opposite corner, for a sense of depth rather than a flat wash.
    const gx = W * 0.94, gy = H * 0.98;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, W * 0.55);
    glow.addColorStop(0, hexToRgba(theme.accent, 0.14));
    glow.addColorStop(1, hexToRgba(theme.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // 3. Fine dot-grid texture — keeps large flat areas from looking cheap/empty.
    ctx.fillStyle = hexToRgba(theme.text, 0.035);
    const step = 30;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Gentle vignette to ground the edges/corners.
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    const url = canvas.toDataURL('image/png');
    gradientCache[key] = url;
    return url;
  }

  /* ---------------- in-app web slideshow ---------------- */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function mediaMarkup(slide) {
    if (slide.imageData) {
      return `<img class="pe-media-img" src="data:${slide.imageMime || 'image/png'};base64,${slide.imageData}" alt="">`;
    }
    if (slide.imagePrompt && slide.imagePrompt.trim()) {
      return `<div class="pe-media-placeholder"><i class="fa-solid fa-image"></i></div>`;
    }
    return '';
  }
  function galleryTileMarkup(im) {
    if (!im) return '';
    if (im.imageData) return `<img class="pe-media-img" src="data:${im.imageMime || 'image/png'};base64,${im.imageData}" alt="">`;
    if (im.imagePrompt && im.imagePrompt.trim()) return `<div class="pe-media-placeholder"><i class="fa-solid fa-image"></i></div>`;
    return `<div class="pe-media-placeholder pe-media-empty"><i class="fa-solid fa-image"></i></div>`;
  }

  function slideHtml(slide, theme, index, total) {
    const layout = slide.layout || 'bullets';
    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    const hasMedia = !!(slide.imageData || (slide.imagePrompt && slide.imagePrompt.trim()));
    const mediaSlot = `<div class="pe-media-slot" data-slide-index="${index}">${mediaMarkup(slide)}</div>`;
    let inner = '';

    if (layout === 'title') {
      inner = `<div class="pe-slide-title-layout">
        <div class="pe-kicker">Presentation</div>
        <h1>${escapeHtml(slide.title)}</h1>
        ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
      </div>`;
    } else if (layout === 'sectionHeader') {
      inner = `<div class="pe-slide-section-layout">
        <div class="pe-section-num">${String(index + 1).padStart(2, '0')} <span class="pe-section-line"></span></div>
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
      inner = `<h2><span class="pe-title-bar"></span>${escapeHtml(slide.title)}</h2>
      <div class="pe-two-col">
        <div class="pe-col">
          ${slide.leftTitle ? `<h4>${escapeHtml(slide.leftTitle)}</h4>` : ''}
          <ul>${(slide.leftBullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </div>
        <div class="pe-col pe-col-alt">
          ${slide.rightTitle ? `<h4>${escapeHtml(slide.rightTitle)}</h4>` : ''}
          <ul>${(slide.rightBullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </div>
      </div>`;
    } else if (layout === 'gallery') {
      const imgs = Array.isArray(slide.images) ? slide.images.slice(0, 6) : [];
      inner = `<h2><span class="pe-title-bar"></span>${escapeHtml(slide.title)}</h2>
      ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
      <div class="pe-gallery-grid pe-gallery-count-${imgs.length || 1}">${imgs.map((im, gi) => `
        <div class="pe-gallery-item">
          <div class="pe-media-slot pe-gallery-slot" data-slide-index="${index}" data-gallery-index="${gi}">${galleryTileMarkup(im)}</div>
          ${im && im.caption ? `<div class="pe-gallery-cap">${escapeHtml(im.caption)}</div>` : ''}
        </div>`).join('')}</div>`;
    } else if (layout === 'table') {
      const headers = Array.isArray(slide.tableHeaders) ? slide.tableHeaders : [];
      const rows = Array.isArray(slide.tableRows) ? slide.tableRows : [];
      inner = `<h2><span class="pe-title-bar"></span>${escapeHtml(slide.title)}</h2>
      ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
      <div class="pe-table-wrap"><table class="pe-table">
        ${headers.length ? `<thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>` : ''}
        <tbody>${rows.map(r => `<tr>${(Array.isArray(r) ? r : []).map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    } else if (layout === 'closing') {
      inner = `<div class="pe-slide-title-layout">
        <h1>${escapeHtml(slide.title)}</h1>
        ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
        ${bullets.length ? `<ul class="pe-closing-list">${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
      </div>`;
    } else {
      // 'bullets' / 'imageFocus'
      inner = `<h2><span class="pe-title-bar"></span>${escapeHtml(slide.title)}</h2>
      ${slide.subtitle ? `<p class="pe-subtitle">${escapeHtml(slide.subtitle)}</p>` : ''}
      <ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`;
    }

    const isHero = layout === 'title' || layout === 'sectionHeader' || layout === 'closing';
    const isGallery = layout === 'gallery';
    const noSplitMedia = isGallery || layout === 'table'; // these layouts never take a side image panel
    const layoutClass = isHero
      ? 'pe-layout-hero' + (hasMedia ? ' pe-has-hero-media' : '')
      : 'pe-layout-content' + (hasMedia && !noSplitMedia ? ' pe-has-split-media' : '');

    if (isHero) {
      return `<div class="pe-slide pe-layout-${layout} ${layoutClass}" data-index="${index}">
        ${hasMedia ? `<div class="pe-hero-media">${mediaSlot}<div class="pe-hero-overlay"></div></div>` : ''}
        <div class="pe-decor-blob"></div>
        <div class="pe-slide-inner">${inner}</div>
        <div class="pe-slide-footer"><span>${index + 1} / ${total}</span></div>
      </div>`;
    }

    return `<div class="pe-slide pe-layout-${layout} ${layoutClass}" data-index="${index}">
      <div class="pe-decor-blob pe-decor-blob-sm"></div>
      <div class="pe-slide-inner ${hasMedia && !noSplitMedia ? 'pe-split' : ''}">
        <div class="pe-split-text">${inner}</div>
        ${hasMedia && !noSplitMedia ? `<div class="pe-split-media">${mediaSlot}</div>` : ''}
      </div>
      <div class="pe-slide-footer"><span>${index + 1} / ${total}</span></div>
    </div>`;
  }

  /** Renders the deck into `container` as a navigable web slideshow.
   *  Returns a small controller object ({ next, prev, goTo, current }).
   *  Applies the deck's theme as CSS variables AND the exact same
   *  rasterized gradient used in the .pptx export, scoped to the
   *  container so multiple decks/themes never collide on one page. */
  function renderDeck(deck, container) {
    const theme = themeOf(deck);
    container.style.setProperty('--pe-bg', '#' + theme.bg);
    container.style.setProperty('--pe-bg2', '#' + theme.bg2);
    container.style.setProperty('--pe-accent', '#' + theme.accent);
    container.style.setProperty('--pe-accent-light', '#' + theme.accentLight);
    container.style.setProperty('--pe-text', '#' + theme.text);
    // Same rasterized background used in the .pptx export — see buildGradientDataUrl.
    container.style.setProperty('--pe-bg-image', `url(${buildGradientDataUrl(theme)})`);

    const total = deck.slides.length;
    container.innerHTML = `
      <div class="pe-viewer">
        <div class="pe-progress-track"><div class="pe-progress-bar"></div></div>
        <div class="pe-stage">${deck.slides.map((s, i) => slideHtml(s, theme, i, total)).join('')}</div>
        <div class="pe-controls">
          <button type="button" class="pe-nav-btn" data-act="prev" aria-label="Previous slide"><i class="fa-solid fa-chevron-left"></i></button>
          <button type="button" class="pe-nav-btn" data-act="play" aria-label="Play slideshow"><i class="fa-solid fa-play"></i></button>
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
    let autoplayTimer = null;
    let autoplaySeconds = 5;
    const progressBar = container.querySelector('.pe-progress-bar');

    // Re-triggers the slide-in animation on the active slide every time
    // it becomes current (removing then re-adding the class forces the
    // CSS animation to replay instead of only firing once on render).
    function replayEntrance(i) {
      const el = slides[i];
      if (!el) return;
      el.classList.remove('pe-active');
      void el.offsetWidth; // force reflow so the animation restarts
      el.classList.add('pe-active');
    }

    function show(i) {
      current = Math.max(0, Math.min(total - 1, i));
      stage.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, idx) => d.classList.toggle('active', idx === current));
      replayEntrance(current);
      restartProgress();
    }
    function goTo(i) { show(i); }
    function next() { show(current >= total - 1 ? 0 : current + 1); }
    function prev() { show(current <= 0 ? total - 1 : current - 1); }

    function stopAutoplay() {
      if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null; }
      container.classList.remove('pe-autoplaying');
      if (progressBar) progressBar.style.transition = 'none', progressBar.style.width = '0%';
      const pb = container.querySelector('[data-act="play"]');
      if (pb) pb.innerHTML = '<i class="fa-solid fa-play"></i>';
    }
    function restartProgress() {
      if (!autoplayTimer || !progressBar) return;
      progressBar.style.transition = 'none';
      progressBar.style.width = '0%';
      void progressBar.offsetWidth;
      progressBar.style.transition = `width ${autoplaySeconds}s linear`;
      progressBar.style.width = '100%';
    }
    function startAutoplay(seconds) {
      autoplaySeconds = seconds || autoplaySeconds;
      stopAutoplay();
      container.classList.add('pe-autoplaying');
      autoplayTimer = setInterval(next, autoplaySeconds * 1000);
      restartProgress();
    }
    function toggleAutoplay(seconds) {
      if (autoplayTimer) stopAutoplay(); else startAutoplay(seconds);
      return !!autoplayTimer;
    }

    container.querySelector('[data-act="prev"]').addEventListener('click', () => { stopAutoplay(); prev(); });
    container.querySelector('[data-act="next"]').addEventListener('click', () => { stopAutoplay(); next(); });
    container.querySelector('[data-act="fullscreen"]').addEventListener('click', () => {
      const viewer = container.querySelector('.pe-viewer');
      if (viewer.requestFullscreen) viewer.requestFullscreen();
    });
    const playBtn = container.querySelector('[data-act="play"]');
    playBtn.addEventListener('click', () => {
      const playing = toggleAutoplay(5);
      playBtn.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) stopAutoplay();
    });
    container.tabIndex = 0;
    container.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { stopAutoplay(); next(); }
      if (e.key === 'ArrowLeft') { stopAutoplay(); prev(); }
      if (e.key === ' ') { e.preventDefault(); toggleAutoplay(); }
    });

    show(0);
    return {
      next, prev, goTo, current: () => current, total,
      startAutoplay, stopAutoplay, toggleAutoplay,
      isPlaying: () => !!autoplayTimer,
      presentFullscreen: (seconds) => {
        const viewer = container.querySelector('.pe-viewer');
        if (viewer.requestFullscreen) viewer.requestFullscreen();
        if (seconds) startAutoplay(seconds);
      }
    };
  }

  /** Patches a single slide's image in-place inside an already-
   *  rendered deck (from renderDeck), without rebuilding the stage or
   *  disturbing which slide the user is currently looking at. Used to
   *  stream in images progressively as generateImages() finishes each
   *  one — a rebuild-the-whole-deck approach would reset scroll/
   *  position and cause a visible flash every time an image lands. */
  function applySlideImage(container, index, slide) {
    const slot = container.querySelector(`.pe-media-slot[data-slide-index="${index}"]:not(.pe-gallery-slot)`);
    if (!slot) return;
    slot.innerHTML = mediaMarkup(slide);
    const slideEl = container.querySelector(`.pe-slide[data-index="${index}"]`);
    if (slideEl && slide.imageData) {
      slideEl.classList.add('pe-has-hero-media', 'pe-has-split-media');
    }
  }
  /** Same idea as applySlideImage but for one tile inside a "gallery"
   *  layout slide (identified by both the slide index and the
   *  image's index within slide.images). */
  function applyGalleryImage(container, slideIndex, galleryIndex, slide) {
    const slot = container.querySelector(`.pe-gallery-slot[data-slide-index="${slideIndex}"][data-gallery-index="${galleryIndex}"]`);
    if (!slot) return;
    const im = (slide.images || [])[galleryIndex];
    slot.innerHTML = galleryTileMarkup(im);
  }

  /* ---------------- manual mode: build/edit a deck by hand ---------------- */

  const LAYOUT_LABELS = {
    title: 'Title slide', sectionHeader: 'Section header', bullets: 'Bullet points',
    twoColumn: 'Two columns', quote: 'Quote / stat', gallery: 'Image gallery',
    table: 'Table / data', closing: 'Closing slide'
  };

  /** Creates a blank slide object of the given layout, pre-filled
   *  with just enough placeholder structure for the manual editor UI
   *  to bind form fields to. Every field this produces is understood
   *  by both renderDeck() and exportPptx() — a manually-built slide
   *  is indistinguishable from an AI-authored one downstream. */
  function createEmptySlide(layout) {
    const base = { layout: layout || 'bullets', title: '', subtitle: '' };
    if (layout === 'title') return Object.assign(base, { title: 'Untitled presentation', subtitle: '' });
    if (layout === 'sectionHeader') return Object.assign(base, { title: 'New section' });
    if (layout === 'quote') return Object.assign(base, { quote: '', attribution: '' });
    if (layout === 'twoColumn') return Object.assign(base, { title: 'Comparison', leftTitle: '', leftBullets: [''], rightTitle: '', rightBullets: [''] });
    if (layout === 'gallery') return Object.assign(base, { title: 'Gallery', images: [] });
    if (layout === 'table') return Object.assign(base, {
      title: 'Data table', subtitle: '',
      tableHeaders: ['Column 1', 'Column 2', 'Column 3'],
      tableRows: [['', '', ''], ['', '', '']]
    });
    if (layout === 'closing') return Object.assign(base, { title: 'Thank you!', bullets: [] });
    return Object.assign(base, { title: 'New slide', bullets: [''] }); // bullets / imageFocus
  }

  /** Creates a brand-new empty deck for Manual Build mode. */
  function createEmptyDeck(title, theme) {
    return {
      title: title || 'Untitled presentation',
      subtitle: '',
      theme: theme || 'blue',
      slides: [createEmptySlide('title'), createEmptySlide('bullets'), createEmptySlide('closing')]
    };
  }

  /** Reads a File (e.g. from a manual-mode <input type="file">) into
   *  { mimeType, data } base64 form, the same shape generateImages()
   *  produces — so a person's own uploaded photo and an AI-generated
   *  illustration are interchangeable once attached to a slide. */
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve({ mimeType: file.type || 'image/png', data: comma >= 0 ? result.slice(comma + 1) : result });
      };
      reader.onerror = () => reject(new Error('Could not read that image file.'));
      reader.readAsDataURL(file);
    });
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

  // Small right-pointing triangle — reads closer to the web preview's
  // Font Awesome chevron bullet (▸) than PptxGenJS's default square.
  const BULLET_CODE = '25B8';

  function addBulletsBox(slide, bullets, opts) {
    if (!bullets || !bullets.length) return;
    slide.addText(
      bullets.map(b => ({ text: b, options: { bullet: { code: BULLET_CODE, indent: 18 }, breakLine: true } })),
      Object.assign({ fontSize: 16, color: opts.textColor, fontFace: 'Arial', lineSpacingMultiple: 1.3 }, opts)
    );
  }

  /** Builds a real .pptx file from the deck and triggers a browser
   *  download — no server round-trip, the whole file is assembled
   *  in-memory by PptxGenJS and handed to the browser's normal save
   *  dialog. `deck.slides[i].notes` (if present) is written into the
   *  slide's speaker notes field, and `imageData` (if present, from
   *  generateImages() or a manual upload) is embedded as a real
   *  image — full-bleed with a dark overlay behind text on
   *  title/section/closing slides, side-by-side with bullets on
   *  content slides, or in a grid on gallery slides. Every slide's
   *  background is the SAME rasterized radial gradient used by the
   *  web preview (buildGradientDataUrl) rather than a flat fill, and
   *  bullet glyphs / section markers / kicker labels mirror the
   *  on-screen layout — this is what keeps the download from looking
   *  like a different, plainer deck than the preview. */
  async function exportPptx(deck, filename) {
    const PptxGenJSCtor = await loadPptxGen();
    const pres = new PptxGenJSCtor();
    pres.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
    pres.layout = 'WIDE';

    const theme = themeOf(deck);
    const accent = theme.accent, textColor = theme.text;
    const gradientUrl = buildGradientDataUrl(theme);

    function imageDataUrl(obj) {
      return obj && obj.imageData ? `data:${obj.imageMime || 'image/png'};base64,${obj.imageData}` : null;
    }

    /** Decorative corner accent used on every slide that isn't a
     *  full-bleed hero image, so the gradient doesn't read as flat —
     *  echoes the .pe-decor-blob glow used in the web preview. */
    function addCornerAccent(s, opts) {
      s.addShape(pres.ShapeType.ellipse, Object.assign({ fill: { color: accent, transparency: 84 }, line: { type: 'none' } }, opts));
    }

    /** Up to 6-image grid for "gallery" slides — mirrors .pe-gallery-grid. */
    function galleryLayoutFor(n) {
      if (n <= 1) return [{ x: 2.9, y: 2.05, w: 7.53, h: 4.55 }];
      if (n === 2) return [0, 1].map(i => ({ x: 0.6 + i * 6.33, y: 2.05, w: 6.03, h: 4.55 }));
      if (n === 3) return [0, 1, 2].map(i => ({ x: 0.6 + i * 4.05, y: 2.05, w: 3.85, h: 4.55 }));
      // 4, 5, or 6 → two rows
      const cols = n <= 4 ? 2 : 3;
      const w = (12.13 - (cols - 1) * 0.2) / cols;
      const rows = Math.ceil(n / cols);
      const h = (4.55 - (rows - 1) * 0.2) / rows;
      const out = [];
      for (let i = 0; i < n; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        out.push({ x: 0.6 + col * (w + 0.2), y: 2.05 + row * (h + 0.2), w, h });
      }
      return out;
    }

    deck.slides.forEach((slide, idx) => {
      const s = pres.addSlide();
      s.background = { data: gradientUrl }; // gradient parity with the web preview, replaced below for hero+image slides
      const layout = slide.layout || 'bullets';
      const imgUrl = imageDataUrl(slide);
      const isHero = layout === 'title' || layout === 'sectionHeader' || layout === 'closing';

      if (isHero && imgUrl) {
        // Full-bleed image with a dark scrim behind the text so it stays readable — matches .pe-hero-overlay.
        s.background = { data: imgUrl };
        s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: '000000', transparency: 42 }, line: { type: 'none' } });
      } else if (layout !== 'gallery') {
        addCornerAccent(s, { x: 10.5, y: -2.2, w: 6.5, h: 6.5 });
        addCornerAccent(s, { x: -2.5, y: 5.2, w: 4, h: 4 });
      }

      if (layout === 'title') {
        s.addText('PRESENTATION', { x: 0.8, y: 2.05, w: 5, h: 0.35, fontSize: 12, bold: true, color: accent, fontFace: 'Arial', charSpacing: 2 });
        s.addText(slide.title || '', { x: 0.8, y: 2.45, w: 11.7, h: 1.6, fontSize: 44, bold: true, color: textColor, fontFace: 'Arial', align: 'left' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.8, y: 4.0, w: 11.7, h: 0.8, fontSize: 20, color: accent, fontFace: 'Arial', align: 'left' });
      } else if (layout === 'sectionHeader') {
        s.addText(String(idx + 1).padStart(2, '0'), { x: 0.8, y: 2.55, w: 1.0, h: 0.5, fontSize: 18, bold: true, color: accent, fontFace: 'Arial' });
        s.addShape(pres.ShapeType.rect, { x: 1.45, y: 2.78, w: 1.3, h: 0.035, fill: { color: accent, transparency: 50 }, line: { type: 'none' } });
        s.addText(slide.title || '', { x: 0.8, y: 3.05, w: 11.7, h: 1.4, fontSize: 36, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.8, y: 4.35, w: 11.7, h: 0.7, fontSize: 18, color: accent, fontFace: 'Arial' });
      } else if (layout === 'quote') {
        s.addText('"' + (slide.quote || slide.title || '') + '"', { x: 1.2, y: 2.2, w: 10.9, h: 2.2, fontSize: 28, italic: true, color: textColor, fontFace: 'Georgia', align: 'center', valign: 'middle' });
        if (slide.attribution) s.addText('— ' + slide.attribution, { x: 1.2, y: 4.5, w: 10.9, h: 0.6, fontSize: 16, color: accent, fontFace: 'Arial', align: 'center' });
      } else if (layout === 'twoColumn') {
        s.addShape(pres.ShapeType.rect, { x: 0.6, y: 0.5, w: 0.09, h: 0.75, fill: { color: accent }, line: { type: 'none' } });
        s.addText(slide.title || '', { x: 0.85, y: 0.5, w: 11.85, h: 0.9, fontSize: 28, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.leftTitle) s.addText(slide.leftTitle, { x: 0.6, y: 1.6, w: 5.9, h: 0.5, fontSize: 18, bold: true, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.leftBullets, { x: 0.6, y: 2.15, w: 5.9, h: 4.5, textColor });
        if (slide.rightTitle) s.addText(slide.rightTitle, { x: 6.85, y: 1.6, w: 5.9, h: 0.5, fontSize: 18, bold: true, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.rightBullets, { x: 6.85, y: 2.15, w: 5.9, h: 4.5, textColor });
      } else if (layout === 'gallery') {
        s.addShape(pres.ShapeType.rect, { x: 0.6, y: 0.5, w: 0.09, h: 0.75, fill: { color: accent }, line: { type: 'none' } });
        s.addText(slide.title || '', { x: 0.85, y: 0.5, w: 11.85, h: 0.9, fontSize: 28, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.6, y: 1.3, w: 12.1, h: 0.5, fontSize: 16, color: accent, fontFace: 'Arial' });
        const imgs = (slide.images || []).slice(0, 6);
        const boxes = galleryLayoutFor(imgs.length || 1);
        imgs.forEach((im, gi) => {
          const box = boxes[gi];
          const captionH = im && im.caption ? 0.4 : 0;
          const url = imageDataUrl(im);
          if (url) {
            s.addImage({ data: url, x: box.x, y: box.y, w: box.w, h: box.h - captionH, sizing: { type: 'cover', w: box.w, h: box.h - captionH } });
          } else {
            s.addShape(pres.ShapeType.rect, { x: box.x, y: box.y, w: box.w, h: box.h - captionH, fill: { color: accent, transparency: 88 }, line: { color: accent, transparency: 60, width: 1 } });
          }
          if (im && im.caption) {
            s.addText(im.caption, { x: box.x, y: box.y + box.h - captionH, w: box.w, h: captionH, fontSize: 11, bold: true, color: textColor, fontFace: 'Arial', align: 'left', valign: 'middle' });
          }
        });
      } else if (layout === 'table') {
        s.addShape(pres.ShapeType.rect, { x: 0.6, y: 0.5, w: 0.09, h: 0.75, fill: { color: accent }, line: { type: 'none' } });
        s.addText(slide.title || '', { x: 0.85, y: 0.5, w: 11.85, h: 0.9, fontSize: 28, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.6, y: 1.3, w: 12.1, h: 0.5, fontSize: 16, color: accent, fontFace: 'Arial' });
        const headers = Array.isArray(slide.tableHeaders) ? slide.tableHeaders : [];
        const rows = Array.isArray(slide.tableRows) ? slide.tableRows : [];
        const tableRows = [];
        if (headers.length) {
          tableRows.push(headers.map(h => ({ text: String(h ?? ''), options: { bold: true, color: theme.bg, fill: { color: accent }, fontFace: 'Arial', fontSize: 13, align: 'left' } })));
        }
        rows.forEach((r, ri) => {
          tableRows.push((Array.isArray(r) ? r : []).map(c => ({
            text: String(c ?? ''),
            options: { color: textColor, fontFace: 'Arial', fontSize: 12.5, align: 'left', fill: { color: 'FFFFFF', transparency: ri % 2 ? 96 : 100 } }
          })));
        });
        if (tableRows.length) {
          s.addTable(tableRows, {
            x: 0.6, y: slide.subtitle ? 2.0 : 1.6, w: 12.1, h: Math.min(4.8, 0.55 * tableRows.length),
            border: { type: 'solid', color: accent, pt: 0.5 }, autoPage: false, valign: 'middle'
          });
        }
      } else if (layout === 'closing') {
        s.addText(slide.title || '', { x: 0.8, y: 2.6, w: 11.7, h: 1.3, fontSize: 40, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.8, y: 3.9, w: 11.7, h: 0.7, fontSize: 18, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.bullets, { x: 0.8, y: 4.7, w: 11.7, h: 2, textColor });
      } else if (imgUrl) {
        // bullets / imageFocus WITH an image — text on the left, image panel on the right.
        s.addShape(pres.ShapeType.rect, { x: 0.6, y: 0.5, w: 0.09, h: 0.75, fill: { color: accent }, line: { type: 'none' } });
        s.addText(slide.title || '', { x: 0.85, y: 0.5, w: 6.6, h: 0.9, fontSize: 26, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.6, y: 1.3, w: 6.85, h: 0.5, fontSize: 14, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.bullets, { x: 0.6, y: slide.subtitle ? 1.95 : 1.6, w: 6.85, h: 4.8, textColor });
        s.addImage({ data: imgUrl, x: 7.75, y: 0.9, w: 5.0, h: 5.6, sizing: { type: 'cover', w: 5.0, h: 5.6 } });
      } else {
        s.addShape(pres.ShapeType.rect, { x: 0.6, y: 0.5, w: 0.09, h: 0.75, fill: { color: accent }, line: { type: 'none' } });
        s.addText(slide.title || '', { x: 0.85, y: 0.5, w: 11.85, h: 0.9, fontSize: 28, bold: true, color: textColor, fontFace: 'Arial' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 0.6, y: 1.3, w: 12.1, h: 0.5, fontSize: 16, color: accent, fontFace: 'Arial' });
        addBulletsBox(s, slide.bullets, { x: 0.6, y: slide.subtitle ? 2.0 : 1.6, w: 12.1, h: 5, textColor });
      }

      // Page counter, footer-right — mirrors .pe-slide-footer in the web preview.
      s.addText(`${idx + 1} / ${deck.slides.length}`, { x: 11.9, y: 7.08, w: 1.2, h: 0.3, fontSize: 10, color: textColor, fontFace: 'Arial', align: 'right', transparency: 45 });

      if (slide.notes) s.addNotes(slide.notes);
    });

    await pres.writeFile({ fileName: filename || (sanitizeFilename(deck.title) + '.pptx') });
  }

  function sanitizeFilename(name) {
    return (name || 'Presentation').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Presentation';
  }

  /* ---------------- "Save to the site" — persisted decks so a user can
     close the tab and re-open a presentation later without regenerating
     it. Uses IndexedDB (not localStorage) because decks can carry many
     embedded base64 images and easily exceed localStorage's ~5MB quota.
     Records are scoped by `ownerKey` (pass the logged-in user's id from
     the host page; falls back to a shared 'guest' bucket if omitted) so
     one browser profile can't see another signed-in user's decks. ---- */
  const IDB_NAME = 'divedu_presentations_v1';
  const IDB_STORE = 'decks';
  let idbPromise = null;
  function openDb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('This browser does not support saving presentations.')); return; }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('byOwner', 'ownerKey', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open local storage.'));
    });
    return idbPromise;
  }
  function withStore(mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      tx.onerror = () => reject(tx.error);
    }));
  }
  function genId() { return 'deck_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  /** Saves (or updates, if deck.id already exists) a deck for the given
   *  owner. Returns the saved record's id. A lightweight thumbnail (the
   *  deck's theme + title + slide count) is stored alongside the full
   *  deck JSON so the "My Presentations" list can render instantly
   *  without decoding every embedded image. */
  async function saveDeck(deck, ownerKey) {
    if (!deck || !Array.isArray(deck.slides)) throw new Error('Nothing to save yet.');
    const id = deck.id || genId();
    const record = {
      id,
      ownerKey: ownerKey || 'guest',
      title: deck.title || 'Untitled presentation',
      subtitle: deck.subtitle || '',
      theme: deck.theme || 'blue',
      slideCount: deck.slides.length,
      updatedAt: Date.now(),
      deck: Object.assign({}, deck, { id })
    };
    await withStore('readwrite', store => { store.put(record); });
    deck.id = id;
    return id;
  }

  /** Lists saved decks for an owner, newest first, WITHOUT the heavy
   *  per-slide image data (keeps the "My Presentations" list cheap to
   *  render even with many saved decks). Call loadDeck(id) to get the
   *  full deck back for editing/exporting. */
  async function listSavedDecks(ownerKey) {
    const key = ownerKey || 'guest';
    const all = await withStore('readonly', store => new Promise((resolve, reject) => {
      const idx = store.index('byOwner');
      const req = idx.getAll(key);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
    return all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(r => ({ id: r.id, title: r.title, subtitle: r.subtitle, theme: r.theme, slideCount: r.slideCount, updatedAt: r.updatedAt }));
  }

  async function loadDeck(id) {
    const record = await withStore('readonly', store => new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
    if (!record) throw new Error('That saved presentation could not be found.');
    return record.deck;
  }

  async function deleteDeck(id) {
    await withStore('readwrite', store => { store.delete(id); });
  }

  return {
    isConfigured, generate, generateImages, countImageJobs,
    renderDeck, applySlideImage, applyGalleryImage,
    exportPptx, sanitizeFilename,
    THEMES, THEME_LIST, buildGradientDataUrl,
    createEmptySlide, createEmptyDeck, readImageFile, LAYOUT_LABELS,
    saveDeck, listSavedDecks, loadDeck, deleteDeck
  };
})();
