/* ============================================================
   THEME-ENGINE.JS — shared Light / Dark / Fun / नेपाली mode
   switcher + custom accent color picker, used on every ज्ञानSetु
   page.

   Pairs with theme-modes.css (must be loaded on the same page)
   for the base light/dark/fun palettes. As of this version the
   floating toggle button + settings panel + all Nepali-mode
   decorations (characters, marigolds, banner) ship with their
   OWN complete CSS (injected once via injectRuntimeStyles()) so
   they render correctly and never overlap page content even if
   theme-modes.css is missing, stale, or only covers the color
   palettes. Self-contained: builds its own markup, so no page
   changes are needed — just add:
     <link rel="stylesheet" href="theme-modes.css">
     <script src="theme-engine.js"></script>
   after the page's existing theme.css/index.css.

   Persistence: localStorage only (per-browser). If you later want
   a setting that follows a user across devices, this is the one
   place to change — swap the two storage functions at the bottom
   for Firestore reads/writes against users/{uid}.themePrefs.
   ============================================================ */

const ThemeEngine = (() => {
  const STORAGE_KEY = 'divedu_theme_prefs_v1';
  const PRESET_COLORS = ['#7886fa', '#10b981', '#f43f5e', '#f59e0b', '#0ea5e9', '#a855f7'];
  const STICKER_EMOJI = ['⭐', '✨', '🎈', '🌈', '☁️', '🚀', '🎨', '💡'];

  /* A dashboard page (student-dashboard.html, teacher-dashboard.html)
     embeds pages like h.html / teacher-ai.html / mindmap.html in an
     <iframe>. Each of those pages loads this same script, so without
     this check every embedded page would build its OWN floating
     toggle button + panel on top of the dashboard's — which is
     exactly the "two circles stacked in the corner" overlap. Only the
     outermost window gets the visible widget; embedded pages still
     apply the theme and stay in sync (see the storage listener in
     init()), they just don't duplicate the button. */
  function isTopFrame() {
    try { return window.self === window.top; } catch (e) { return true; }
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { mode: 'light', accent: null };
    } catch (e) { return { mode: 'light', accent: null }; }
  }

  function savePrefs(prefs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  /* ---- tiny hex color helpers (no dependency needed) ---- */
  function hexToRgb(hex) {
    const m = hex.replace('#', '');
    const bigint = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  }
  function shade(hex, percent) {
    const { r, g, b } = hexToRgb(hex);
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent);
    const nr = Math.round((t - r) * p) + r;
    const ng = Math.round((t - g) * p) + g;
    const nb = Math.round((t - b) * p) + b;
    return '#' + [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyAccent(hex) {
    const root = document.documentElement.style;
    if (!hex) {
      // Clear inline overrides so the page's own CSS defaults win again.
      ['--primary-indigo', '--primary-indigo-hover', '--current-accent', '--student-accent',
        '--teacher-accent', '--current-glow', '--student-glow', '--teacher-glow', '--sky-accent']
        .forEach(v => root.removeProperty(v));
      return;
    }
    const hover = shade(hex, -0.12);
    const glow = rgba(hex, 0.28);
    root.setProperty('--primary-indigo', hex);
    root.setProperty('--primary-indigo-hover', hover);
    root.setProperty('--current-accent', hex);
    root.setProperty('--student-accent', hex);
    root.setProperty('--teacher-accent', hex);
    root.setProperty('--current-glow', glow);
    root.setProperty('--student-glow', glow);
    root.setProperty('--teacher-glow', glow);
    root.setProperty('--sky-accent', shade(hex, 0.2));
  }

  function applyMode(mode) {
    document.documentElement.setAttribute('data-theme-mode', mode);
  }

  /* ---------------- Decorative floating motifs ----------------
     Fun mode gets drifting emoji stickers; नेपाली mode gets a small
     namaste/flag/diya/marigold motif set plus a greeting banner.
     Real Unicode emoji instead of hand-drawn art — crisp on every
     device, zero load time, and (importantly) the Nepal flag emoji
     IS the actual Nepal flag, not an approximation.

     Placement is deliberately conservative: everything sits only in
     the outer 8% margin on each side, and the whole layer disappears
     below 1100px width. Earlier versions used random/full-width
     placement, which is exactly what was landing on top of headline
     text and buttons on narrower or embedded views — there's no safe
     empty margin to put decorations in below that width, so instead
     of guessing they just stay off rather than covering content. */
  const NEPALI_MOTIFS = ['🙏', '🇳🇵', '🪔', '🌼'];

  function buildStickers() {
    if (document.querySelector('.te-stickers')) return;
    const wrap = document.createElement('div');
    wrap.className = 'te-stickers';
    const count = 6;
    // Only the outer margins (0-8vw and 92-100vw) and a spread of
    // vertical positions — never the central content column.
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'te-sticker';
      s.textContent = STICKER_EMOJI[i % STICKER_EMOJI.length];
      const onLeft = i % 2 === 0;
      s.style.left = (onLeft ? Math.round(Math.random() * 6) : Math.round(94 + Math.random() * 6)) + 'vw';
      s.style.top = Math.round(6 + Math.random() * 84) + 'vh';
      s.style.animationDelay = (Math.random() * 6).toFixed(1) + 's';
      s.style.animationDuration = (7 + Math.random() * 5).toFixed(1) + 's';
      wrap.appendChild(s);
    }
    document.body.appendChild(wrap);
  }

  function buildNamasteStickers() {
    if (document.querySelector('.te-namaste-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'te-namaste-wrap';
    const positions = [
      { left: '2vw', top: '14vh' }, { left: '97vw', top: '12vh', transform: 'translateX(-100%)' },
      { left: '2vw', top: '48vh' }, { left: '97vw', top: '46vh', transform: 'translateX(-100%)' },
      { left: '3vw', top: '80vh' }, { left: '96vw', top: '78vh', transform: 'translateX(-100%)' }
    ];
    positions.forEach((pos, i) => {
      const holder = document.createElement('div');
      holder.className = 'te-namaste';
      holder.style.left = pos.left;
      holder.style.top = pos.top;
      if (pos.transform) holder.style.transform = pos.transform;
      holder.style.animationDelay = (i * 0.8).toFixed(1) + 's';
      holder.textContent = NEPALI_MOTIFS[i % NEPALI_MOTIFS.length];
      wrap.appendChild(holder);
    });
    document.body.appendChild(wrap);
  }

  function buildNamasteBanner() {
    if (document.querySelector('.te-namaste-banner')) return;
    const container = document.querySelector('.d-container, .desk-wrap, .chat-wrap, .page');
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'te-namaste-banner';
    banner.style.background = 'linear-gradient(90deg, var(--student-bg, #fbe6df), var(--teacher-bg, #e4ecf9))';
    banner.style.border = '1px solid var(--panel-border, rgba(179,38,46,0.22))';
    banner.style.color = 'var(--text-main, #2b1a12)';
    banner.innerHTML = `<span class="te-banner-emoji" aria-hidden="true">🙏🇳🇵</span><span data-i18n="namasteBanner">नमस्ते! Welcome — you can switch back to English anytime from the same menu.</span>`;
    container.prepend(banner);
  }

  /* ---------------- self-contained runtime CSS ----------------
     Everything the widget + decorations need to look right and
     stack correctly, independent of theme-modes.css. Injected once,
     high specificity, so it can't be silently overlapped or hidden
     behind page content regardless of what other stylesheets the
     page happens to load. */
  function injectRuntimeStyles() {
    if (document.getElementById('te-runtime-styles')) return;
    const style = document.createElement('style');
    style.id = 'te-runtime-styles';
    style.textContent = `
      .te-stickers, .te-namaste-wrap { position: fixed; inset: 0; pointer-events: none; z-index: 1; overflow: hidden; }
      .te-namaste-wrap { display: none; }
      :root[data-theme-mode="nepali"] .te-namaste-wrap { display: block; }

      .te-sticker, .te-namaste {
        position: absolute; font-size: 30px; line-height: 1;
        opacity: 0.5; animation: teDriftBob 6s ease-in-out infinite;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.15));
      }
      .te-namaste { font-size: 34px; }
      @keyframes teDriftBob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-14px) rotate(-4deg); } }

      /* The whole decorative layer only ever shows where there is
         real empty margin to put it in. Below this width the content
         column fills the viewport edge-to-edge (this is exactly what
         was overlapping headline text and buttons before), so it's
         simply hidden rather than guessed at. */
      @media (max-width: 1100px) {
        .te-stickers, .te-namaste-wrap { display: none !important; }
      }

      .te-namaste-banner { display: none; align-items: center; gap: 10px; border-radius: 14px; padding: 10px 16px; font-size: 13px; font-weight: 700; margin: 0 0 16px; position: relative; z-index: 3; }
      :root[data-theme-mode="nepali"] .te-namaste-banner { display: flex; }
      .te-banner-emoji { font-size: 22px; flex-shrink: 0; }
      .te-flag-icon { font-size: 13px; }

      .te-toggle-btn {
        position: fixed; right: 22px; bottom: 22px; z-index: 2147483000;
        width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
        background: var(--current-accent, #7886fa); color: #fff; font-size: 19px;
        box-shadow: 0 10px 24px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12);
        display: flex; align-items: center; justify-content: center;
        transition: transform .2s ease, box-shadow .2s ease;
      }
      .te-toggle-btn:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 14px 30px rgba(0,0,0,0.28); }
      .te-toggle-btn:active { transform: translateY(0) scale(0.97); }

      .te-panel {
        position: fixed; right: 22px; bottom: 84px; z-index: 2147483000;
        width: 268px; max-width: calc(100vw - 32px);
        max-height: min(72vh, 560px); overflow-y: auto; overflow-x: hidden;
        background: var(--surface-white, #fff); border: 1px solid var(--panel-border, rgba(0,0,0,0.08));
        border-radius: var(--radius-lg, 18px); padding: 18px 18px 16px;
        box-shadow: 0 20px 48px rgba(20,20,30,0.18), 0 4px 14px rgba(20,20,30,0.08);
        opacity: 0; visibility: hidden; transform: translateY(10px) scale(0.98);
        transform-origin: bottom right;
        transition: opacity .18s ease, transform .18s ease, visibility .18s;
      }
      .te-panel.open { opacity: 1; visibility: visible; transform: translateY(0) scale(1); }
      .te-panel h5 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 800; color: var(--text-muted, #8a8a99); margin: 14px 0 8px; }
      .te-panel h5:first-child { margin-top: 2px; }
      .te-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .te-mode-btn {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        border: 1.5px solid var(--panel-border, rgba(0,0,0,0.1)); background: var(--bg-main, #f7f7fb);
        color: var(--text-main, #1e1e28); padding: 9px 8px; border-radius: 12px;
        font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        transition: background .15s ease, border-color .15s ease, color .15s ease;
      }
      .te-mode-btn i { font-size: 12px; }
      .te-mode-btn.active { background: var(--current-accent, #7886fa); border-color: var(--current-accent, #7886fa); color: #fff; }
      .te-mode-btn:not(.active):hover { border-color: var(--current-accent, #7886fa); }

      .te-swatches { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .te-swatch {
        width: 26px; height: 26px; border-radius: 50%; cursor: pointer; display: inline-block;
        border: 2px solid transparent; box-shadow: 0 0 0 1px rgba(0,0,0,0.08) inset;
        transition: transform .15s ease, border-color .15s ease;
      }
      .te-swatch:hover { transform: scale(1.12); }
      .te-swatch.active { border-color: var(--text-main, #1e1e28); transform: scale(1.15); }
      .te-color-row { display: flex; align-items: center; }
      .te-color-row input[type="color"] { width: 30px; height: 30px; border: none; border-radius: 8px; padding: 0; background: none; cursor: pointer; }

      .te-reset {
        width: 100%; margin-top: 16px; padding: 10px; border-radius: 10px; cursor: pointer;
        border: 1.5px dashed var(--panel-border, rgba(0,0,0,0.14)); background: transparent; color: var(--text-muted, #8a8a99);
        font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;
        transition: border-color .15s ease, color .15s ease;
      }
      .te-reset:hover { border-color: var(--current-accent, #7886fa); color: var(--current-accent, #7886fa); }

      @media (max-width: 480px) {
        .te-toggle-btn { right: 14px; bottom: 14px; width: 46px; height: 46px; font-size: 17px; }
        .te-panel { right: 14px; left: 14px; width: auto; bottom: 68px; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildWidget(prefs) {
    if (document.querySelector('.te-toggle-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'te-toggle-btn';
    btn.setAttribute('aria-label', 'Theme settings');
    btn.innerHTML = '<i class="fa-solid fa-palette"></i>';

    const panel = document.createElement('div');
    panel.className = 'te-panel';
    panel.innerHTML = `
      <h5>Mode</h5>
      <div class="te-modes">
        <button class="te-mode-btn" data-mode="light"><i class="fa-solid fa-sun"></i>Light</button>
        <button class="te-mode-btn" data-mode="dark"><i class="fa-solid fa-moon"></i>Dark</button>
        <button class="te-mode-btn" data-mode="fun"><i class="fa-solid fa-face-grin-stars"></i>Fun</button>
        <button class="te-mode-btn" data-mode="nepali"><span class="te-flag-icon" aria-hidden="true">🇳🇵</span>नेपाली</button>
      </div>
      <h5>Site language</h5>
      <div class="te-modes">
        <button class="te-mode-btn te-lang-btn" data-lang="en"><i class="fa-solid fa-globe"></i>English</button>
        <button class="te-mode-btn te-lang-btn" data-lang="ne"><span class="te-flag-icon" aria-hidden="true">🇳🇵</span>नेपाली</button>
      </div>
      <h5>Accent color</h5>
      <div class="te-swatches">
        ${PRESET_COLORS.map(c => `<span class="te-swatch" data-color="${c}" style="background:${c}"></span>`).join('')}
        <div class="te-color-row"><input type="color" id="teCustomColor" value="${prefs.accent || '#7886fa'}"></div>
      </div>
      <button class="te-reset"><i class="fa-solid fa-rotate-left"></i> Reset to default</button>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    function refreshActiveStates() {
      panel.querySelectorAll('.te-mode-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === prefs.mode));
      panel.querySelectorAll('.te-swatch').forEach(s => s.classList.toggle('active', prefs.accent === s.dataset.color));
      panel.querySelectorAll('.te-lang-btn').forEach(b => b.classList.toggle('active', typeof LangEngine !== 'undefined' && LangEngine.getLang() === b.dataset.lang));
    }

    btn.addEventListener('click', () => panel.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) panel.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') panel.classList.remove('open');
    });

    panel.querySelectorAll('.te-mode-btn[data-mode]').forEach(b => {
      b.addEventListener('click', () => {
        prefs.mode = b.dataset.mode;
        applyMode(prefs.mode);
        savePrefs(prefs);
        if (prefs.mode === 'nepali') { buildNamasteStickers(); buildNamasteBanner(); }
        refreshActiveStates();
      });
    });

    panel.querySelectorAll('.te-lang-btn').forEach(b => {
      b.addEventListener('click', () => {
        if (typeof LangEngine !== 'undefined') LangEngine.setLang(b.dataset.lang);
        if (b.dataset.lang === 'ne') buildNamasteBanner();
        refreshActiveStates();
      });
    });

    panel.querySelectorAll('.te-swatch').forEach(s => {
      s.addEventListener('click', () => {
        prefs.accent = s.dataset.color;
        applyAccent(prefs.accent);
        document.getElementById('teCustomColor').value = prefs.accent;
        savePrefs(prefs);
        refreshActiveStates();
      });
    });

    panel.querySelector('#teCustomColor').addEventListener('input', (e) => {
      prefs.accent = e.target.value;
      applyAccent(prefs.accent);
      savePrefs(prefs);
      refreshActiveStates();
    });

    panel.querySelector('.te-reset').addEventListener('click', () => {
      prefs.mode = 'light';
      prefs.accent = null;
      applyMode(prefs.mode);
      applyAccent(null);
      document.getElementById('teCustomColor').value = '#7886fa';
      savePrefs(prefs);
      if (typeof LangEngine !== 'undefined') LangEngine.setLang('en');
      refreshActiveStates();
    });

    refreshActiveStates();
  }

  /* Re-applies whatever is currently in localStorage to THIS
     document. Used both on first load and whenever another
     same-origin window/frame changes the shared prefs, so a page
     embedding h.html / teacher-ai.html / mindmap.html in an <iframe>
     (the dashboards do this) and the dashboard itself always show
     the same mode + accent + language without needing a refresh. */
  function syncFromStorage(prefs) {
    applyMode(prefs.mode || 'light');
    applyAccent(prefs.accent || null);
    if (prefs.mode === 'nepali') { buildNamasteStickers(); buildNamasteBanner(); }
    const panel = document.querySelector('.te-panel');
    if (panel) {
      panel.querySelectorAll('.te-mode-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === prefs.mode));
      panel.querySelectorAll('.te-swatch').forEach(s => s.classList.toggle('active', prefs.accent === s.dataset.color));
      const customColor = panel.querySelector('#teCustomColor');
      if (customColor && prefs.accent) customColor.value = prefs.accent;
    }
  }

  function init() {
    const prefs = loadPrefs();
    applyMode(prefs.mode || 'light');
    applyAccent(prefs.accent || null);
    const boot = () => {
      injectRuntimeStyles();
      buildStickers();
      if (prefs.mode === 'nepali') { buildNamasteStickers(); buildNamasteBanner(); }
      // Only the outermost window gets the floating button + panel —
      // see isTopFrame() above for why.
      if (isTopFrame()) buildWidget(prefs);
    };
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot);

    // Live sync: fires in every OTHER same-origin document (parent
    // page, sibling tabs, embedded iframes) the instant one of them
    // changes theme prefs — this is what makes "change it in one,
    // all of them change" actually true instead of needing a reload.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      syncFromStorage(loadPrefs());
    });
  }

  init();
  return { applyMode, applyAccent, loadPrefs, savePrefs };
})();
