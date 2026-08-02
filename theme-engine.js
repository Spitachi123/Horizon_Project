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

  function buildStickers() {
    if (document.querySelector('.te-stickers')) return;
    const wrap = document.createElement('div');
    wrap.className = 'te-stickers';
    const count = 7;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'te-sticker';
      s.textContent = STICKER_EMOJI[i % STICKER_EMOJI.length];
      s.style.left = Math.round(Math.random() * 92) + 'vw';
      s.style.top = Math.round(Math.random() * 88) + 'vh';
      s.style.animationDelay = (Math.random() * 6).toFixed(1) + 's';
      s.style.animationDuration = (7 + Math.random() * 5).toFixed(1) + 's';
      wrap.appendChild(s);
    }
    document.body.appendChild(wrap);
  }

  /* ---------------- Nepali character & motif sprite ----------------
     A single hidden <svg><symbol>...</symbol></svg> sprite sheet is
     injected once, and every on-screen decoration references it with
     <use>. This keeps the markup light, avoids duplicate-gradient-id
     bugs (the old version re-embedded a full <svg> per sticker), and
     makes it trivial to add more motifs later.

     Redrawn from scratch for this pass: a boy in a diamond-patterned
     dhaka topi + daura-suruwal and a girl with a braid, tika, and a
     red cholo — both mid-namaste — plus a marigold (sayapatri) bloom
     and a small diya lamp, so Nepali mode feels like an actual Dashain/
     Tihar greeting card rather than one recolored icon repeated. */
  const SPRITE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden;" aria-hidden="true">
    <defs>
      <linearGradient id="teSkin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffd9b3"/>
        <stop offset="100%" stop-color="#f2c9a0"/>
      </linearGradient>
      <linearGradient id="teVestBoy" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4a4a52"/>
        <stop offset="100%" stop-color="#2f2f36"/>
      </linearGradient>
      <linearGradient id="teDressGirl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d33b3f"/>
        <stop offset="100%" stop-color="#a3242b"/>
      </linearGradient>
      <linearGradient id="teSkirtGirl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#003893"/>
        <stop offset="100%" stop-color="#00266b"/>
      </linearGradient>
      <radialGradient id="teFlame" cx="50%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#fff6cf"/>
        <stop offset="55%" stop-color="#ffb545"/>
        <stop offset="100%" stop-color="#e8720f"/>
      </radialGradient>
    </defs>

    <symbol id="te-char-boy" viewBox="0 0 64 64">
      <ellipse cx="32" cy="59" rx="15" ry="3" fill="#2b1a12" opacity="0.12"/>
      <path d="M17 62 L19 41 Q19 33 32 33 Q45 33 45 41 L47 62 Z" fill="#f7f2e9"/>
      <path d="M19 41 Q19 33 32 33 Q45 33 45 41 L45 45 Q32 50 19 45 Z" fill="#efe6d6"/>
      <path d="M22 40 L22 58 Q32 61 42 58 L42 40 Q37 36 32 36 Q27 36 22 40Z" fill="url(#teVestBoy)"/>
      <path d="M27 37 L27 57" stroke="#1c1c22" stroke-width="0.8" opacity="0.5"/>
      <path d="M37 37 L37 57" stroke="#1c1c22" stroke-width="0.8" opacity="0.5"/>
      <path d="M22 58 L20 62 L27 62 L27 58Z" fill="#f7f2e9"/>
      <path d="M42 58 L44 62 L37 62 L37 58Z" fill="#f7f2e9"/>
      <rect x="28" y="27" width="8" height="8" rx="3" fill="url(#teSkin)"/>
      <circle cx="32" cy="21" r="10" fill="url(#teSkin)"/>
      <path d="M22 20 Q22 10 32 9 Q42 10 42 20 L41 17 Q32 12 23 17Z" fill="#241a12"/>
      <path d="M21 15 Q21 6 32 5 Q43 6 43 15 Q32 11 21 15Z" fill="#b3262e"/>
      <g fill="#ffd447" opacity="0.9">
        <rect x="24" y="8.4" width="2.6" height="2.6" transform="rotate(45 25.3 9.7)"/>
        <rect x="29.7" y="6.6" width="2.6" height="2.6" transform="rotate(45 31 7.9)"/>
        <rect x="35.4" y="8.4" width="2.6" height="2.6" transform="rotate(45 36.7 9.7)"/>
        <rect x="40" y="11.6" width="2.2" height="2.2" transform="rotate(45 41.1 12.7)"/>
        <rect x="19.8" y="11.6" width="2.2" height="2.2" transform="rotate(45 20.9 12.7)"/>
      </g>
      <path d="M21 15 Q32 19 43 15" fill="none" stroke="#7a1a20" stroke-width="1.1"/>
      <path d="M27.5 22.5 q1.3 1.3 2.6 0" stroke="#5b3a25" stroke-width="1" fill="none" stroke-linecap="round"/>
      <path d="M33.9 22.5 q1.3 1.3 2.6 0" stroke="#5b3a25" stroke-width="1" fill="none" stroke-linecap="round"/>
      <path d="M28 26.5 Q32 29.5 36 26.5" stroke="#8a4a2e" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <circle cx="26" cy="25" r="1.6" fill="#f7b0a0" opacity="0.55"/>
      <circle cx="38" cy="25" r="1.6" fill="#f7b0a0" opacity="0.55"/>
      <path d="M26 44 Q32 36 38 44 Q38 50 32 51 Q26 50 26 44Z" fill="url(#teSkin)"/>
      <path d="M32 37 L32 50" stroke="#d9a877" stroke-width="0.8" opacity="0.7"/>
    </symbol>

    <symbol id="te-char-girl" viewBox="0 0 64 64">
      <ellipse cx="32" cy="59" rx="15" ry="3" fill="#2b1a12" opacity="0.12"/>
      <path d="M18 62 L21 42 Q21 36 32 36 Q43 36 43 42 L46 62 Z" fill="url(#teSkirtGirl)"/>
      <path d="M22 62 L24 44 M28 62 L29.5 44 M35 62 L34 44 M40 62 L38 44" stroke="#fff" stroke-width="1" opacity="0.35"/>
      <path d="M18 62 L21 42 Q21 36 32 36 Q43 36 43 42 L46 62Z" fill="none" stroke="#001d4d" stroke-width="0.8" opacity="0.4"/>
      <path d="M23 37 L23 46 Q32 49 41 46 L41 37 Q37 33 32 33 Q27 33 23 37Z" fill="url(#teDressGirl)"/>
      <path d="M23 37 L28 40 L32 36 L36 40 L41 37" fill="none" stroke="#ffd447" stroke-width="1"/>
      <circle cx="32" cy="43.5" r="1.4" fill="#ffd447"/>
      <circle cx="29.5" cy="42.5" r="1" fill="#ffd447" opacity="0.85"/>
      <circle cx="34.5" cy="42.5" r="1" fill="#ffd447" opacity="0.85"/>
      <rect x="28.5" y="28" width="7" height="7" rx="3" fill="url(#teSkin)"/>
      <circle cx="32" cy="22" r="9.6" fill="url(#teSkin)"/>
      <path d="M22.5 21 Q21.5 10 32 9.5 Q42.5 10 41.5 21 Q41.5 25 39 27 Q40 20 36 16 Q32 13 28 16 Q24 20 25 27 Q22.5 25 22.5 21Z" fill="#221913"/>
      <path d="M40 25 Q45 28 44 36 Q47 38 45 42 Q47.5 44.5 45 47" fill="none" stroke="#221913" stroke-width="3.4" stroke-linecap="round"/>
      <circle cx="24.5" cy="15.5" r="1.9" fill="#f0a93a"/>
      <circle cx="24.5" cy="15.5" r="0.8" fill="#b3262e"/>
      <circle cx="32" cy="17.6" r="1.3" fill="#b3262e"/>
      <path d="M27.6 23 q1.2 1.2 2.4 0" stroke="#5b3a25" stroke-width="1" fill="none" stroke-linecap="round"/>
      <path d="M34 23 q1.2 1.2 2.4 0" stroke="#5b3a25" stroke-width="1" fill="none" stroke-linecap="round"/>
      <path d="M28.3 27 Q32 30.4 35.7 27" stroke="#8a4a2e" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <circle cx="26.3" cy="25.5" r="1.6" fill="#f7b0a0" opacity="0.55"/>
      <circle cx="37.7" cy="25.5" r="1.6" fill="#f7b0a0" opacity="0.55"/>
      <path d="M26.5 45 Q32 38 37.5 45 Q37.5 50.5 32 51.5 Q26.5 50.5 26.5 45Z" fill="url(#teSkin)"/>
      <path d="M32 39 L32 51" stroke="#d9a877" stroke-width="0.8" opacity="0.7"/>
    </symbol>

    <symbol id="te-marigold" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="17" fill="#f0a93a"/>
      <circle cx="24" cy="24" r="12.5" fill="#f6c065"/>
      <circle cx="24" cy="24" r="8" fill="#f0a93a"/>
      <circle cx="24" cy="24" r="4.2" fill="#b3262e"/>
      <circle cx="19" cy="18" r="4" fill="#fff" opacity="0.18"/>
    </symbol>

    <symbol id="te-diya" viewBox="0 0 40 40">
      <path d="M6 26 Q20 34 34 26 Q32 33 20 34 Q8 33 6 26Z" fill="#c98a2e"/>
      <path d="M6 26 Q20 32 34 26 Q20 22 6 26Z" fill="#e8ab4a"/>
      <path d="M18 22 Q20 12 22 22 Q24 17 20 8 Q16 17 18 22Z" fill="url(#teFlame)"/>
    </symbol>

    <!-- The actual Nepal flag: the world's only non-quadrilateral
         national flag — a crimson double pennant with a blue border,
         a moon in the upper triangle and a sun in the lower one. -->
    <symbol id="te-nepal-flag" viewBox="0 0 34 46">
      <path d="M3 2 L27 15 L14 24 L27 33 L3 44 Z" fill="#003893"/>
      <path d="M5 5 L23.5 15.3 L12.3 23.5 L5 27.6 Z" fill="#b3262e"/>
      <path d="M5 27.6 L23.5 33.5 L5 41 Z" fill="#b3262e"/>
      <circle cx="11" cy="12.5" r="3.1" fill="#fff"/>
      <circle cx="12.6" cy="11" r="2.5" fill="#003893"/>
      <g stroke="#fff" stroke-width="0.8" stroke-linecap="round">
        <path d="M11 7.3 L11 6"/><path d="M14.2 9 L15.3 8.1"/><path d="M15.5 12.5 L16.8 12.5"/>
        <path d="M14.2 16 L15.3 16.9"/><path d="M7.8 9 L6.7 8.1"/><path d="M6.5 12.5 L5.2 12.5"/>
      </g>
      <g fill="#fff">
        <circle cx="12" cy="34.5" r="3.6"/>
        <g stroke="#fff" stroke-width="1" stroke-linecap="round">
          <path d="M12 29.2 L12 27.6"/><path d="M12 41.8 L12 40.2"/>
          <path d="M17.3 34.5 L18.9 34.5"/><path d="M5.1 34.5 L6.7 34.5"/>
          <path d="M15.7 30.8 L16.8 29.7"/><path d="M7.2 39.3 L8.3 38.2"/>
          <path d="M15.7 38.2 L16.8 39.3"/><path d="M7.2 29.7 L8.3 30.8"/>
        </g>
      </g>
    </symbol>
  </svg>`;

  function injectSprite() {
    if (document.getElementById('te-sprite')) return;
    const holder = document.createElement('div');
    holder.id = 'te-sprite';
    holder.innerHTML = SPRITE_SVG;
    document.body.prepend(holder);
  }

  function useIcon(symbolId, extraClass) {
    return `<svg class="te-icon-use${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 64 64"><use href="#${symbolId}"></use></svg>`;
  }

  /* ---------------- self-contained runtime CSS ----------------
     Everything the widget + Nepali decorations need to look right
     and stack correctly, independent of theme-modes.css. Injected
     once, high specificity, so it can't be silently overlapped or
     hidden behind page content regardless of what other stylesheets
     the page happens to load. */
  function injectRuntimeStyles() {
    if (document.getElementById('te-runtime-styles')) return;
    const style = document.createElement('style');
    style.id = 'te-runtime-styles';
    style.textContent = `
      .te-stickers, .te-namaste-wrap { position: fixed; inset: 0; pointer-events: none; z-index: 1; overflow: hidden; }
      .te-namaste-wrap { display: none; }
      :root[data-theme-mode="nepali"] .te-namaste-wrap { display: block; }

      .te-namaste { position: absolute; width: 68px; height: 68px; opacity: 0.55; animation: teNamasteBob 6s ease-in-out infinite; filter: drop-shadow(0 6px 10px rgba(43,26,18,0.18)); }
      .te-icon-use { width: 100%; height: 100%; display: block; }
      @keyframes teNamasteBob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-14px) rotate(-3deg); } }

      .te-namaste-banner { display: none; align-items: center; gap: 10px; border-radius: 14px; padding: 10px 16px; font-size: 13px; font-weight: 700; margin: 0 0 16px; position: relative; z-index: 3; }
      :root[data-theme-mode="nepali"] .te-namaste-banner { display: flex; }
      .te-namaste-banner svg { width: 30px; height: 30px; flex-shrink: 0; }

      @media (max-width: 700px) { .te-namaste { width: 48px; height: 48px; } }

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
      .te-flag-icon { width: 15px; height: 15px; flex-shrink: 0; }
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

  function buildNamasteStickers() {
    if (document.querySelector('.te-namaste-wrap')) return;
    injectSprite();
    const wrap = document.createElement('div');
    wrap.className = 'te-namaste-wrap';
    // Alternates the boy, the girl, a marigold bloom, and a diya so the
    // page reads as a little festival scene instead of one icon cloned.
    const motifs = ['te-char-boy', 'te-marigold', 'te-char-girl', 'te-nepal-flag', 'te-diya', 'te-char-boy', 'te-nepal-flag', 'te-char-girl'];
    const positions = [
      { left: '3vw', top: '10vh' }, { left: '95vw', top: '8vh', transform: 'translateX(-100%)' },
      { left: '92vw', top: '28vh', transform: 'translateX(-100%)' }, { left: '4vw', top: '30vh' },
      { left: '5vw', top: '50vh' }, { left: '91vw', top: '52vh', transform: 'translateX(-100%)' },
      { left: '6vw', top: '80vh' }, { left: '90vw', top: '78vh', transform: 'translateX(-100%)' }
    ];
    positions.forEach((pos, i) => {
      const holder = document.createElement('div');
      holder.className = 'te-namaste';
      holder.style.left = pos.left;
      holder.style.top = pos.top;
      if (pos.transform) holder.style.transform = pos.transform;
      holder.style.animationDelay = (i * 0.8).toFixed(1) + 's';
      holder.innerHTML = useIcon(motifs[i % motifs.length]);
      wrap.appendChild(holder);
    });
    document.body.appendChild(wrap);
  }

  function buildNamasteBanner() {
    if (document.querySelector('.te-namaste-banner')) return;
    injectSprite();
    const container = document.querySelector('.d-container, .desk-wrap, .chat-wrap, .page');
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'te-namaste-banner';
    banner.style.background = 'linear-gradient(90deg, var(--student-bg, #fbe6df), var(--teacher-bg, #e4ecf9))';
    banner.style.border = '1px solid var(--panel-border, rgba(179,38,46,0.22))';
    banner.style.color = 'var(--text-main, #2b1a12)';
    banner.innerHTML = `${useIcon('te-char-boy')}<span data-i18n="namasteBanner">नमस्ते! Welcome — you can switch back to English anytime from the same menu.</span>`;
    container.prepend(banner);
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
        <button class="te-mode-btn" data-mode="nepali">${useIcon('te-nepal-flag', 'te-flag-icon')}नेपाली</button>
      </div>
      <h5>Site language</h5>
      <div class="te-modes">
        <button class="te-mode-btn te-lang-btn" data-lang="en"><i class="fa-solid fa-globe"></i>English</button>
        <button class="te-mode-btn te-lang-btn" data-lang="ne">${useIcon('te-nepal-flag', 'te-flag-icon')}नेपाली</button>
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
      injectSprite();
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
