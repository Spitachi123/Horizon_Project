/* ============================================================
   AI-ENGINE.JS — shared client-side text-understanding engine
   used by the AI Study Desk (h.html) and the AI Teaching
   Assistant (teacher-ai.html).

   This is a genuine step up from plain word-frequency scoring:
   it builds a TextRank graph (the same family of algorithm behind
   Google's original PageRank, adapted to sentences) so a sentence
   is ranked highly when it is *semantically central* — closely
   related to many other important sentences — not just because it
   repeats common words. It also detects headings/structure, pulls
   out real definitions ("X is/refers to/means Y"), and extracts
   PDF text so a whole reading-material file can be summarized.

   Honesty note: this still runs entirely in the browser with no
   API key, so it is extractive/structural NLP, not a large
   language model — it selects, ranks, and reorganizes the actual
   sentences you gave it rather than writing new ones. Wiring this
   up to a real LLM (e.g. the Claude API) would need a small backend
   to hold the API key; see the README for details.
   ============================================================ */

const AIEngine = (() => {

  const STOPWORDS = new Set(("a an the and or but if then else when while of to in on for with as by is are was were " +
    "be been being this that these those it its it's i you he she they we my your his her their our " +
    "not no so than too very can will shall would could should just also into about over under out up down at from " +
    "there here what which who whom whose all any some such only own same again further once there's " +
    "do does did doing have has had having").split(' '));

  const DEFINITION_PATTERNS = [
    /\b([A-Z][a-zA-Z0-9\- ]{2,40}?)\s+(?:is|are)\s+(?:defined as|known as|called|referred to as)\s+/i,
    /\b([A-Z][a-zA-Z0-9\- ]{2,40}?)\s+refers to\s+/i,
    /\b([A-Z][a-zA-Z0-9\- ]{2,40}?)\s+means\s+/i,
    /\b([A-Z][a-zA-Z0-9\- ]{2,40}?)\s+is a\s+/i,
    /\b([A-Z][a-zA-Z0-9\- ]{2,40}?)\s+is the\s+/i
  ];

  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z0-9']+/g) || []);
  }

  function significantWords(text) {
    return tokenize(text).filter(w => !STOPWORDS.has(w) && w.length >= 3);
  }

  /** Splits raw pasted text into paragraphs and lines, so headings
   *  and structure (bullets, blank-line-separated sections) survive
   *  instead of being flattened into one blob. */
  function splitStructure(rawText) {
    const lines = rawText.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
    const blocks = [];
    let buffer = [];
    lines.forEach(line => {
      if (line === '') {
        if (buffer.length) { blocks.push(buffer.join(' ')); buffer = []; }
      } else {
        buffer.push(line);
      }
    });
    if (buffer.length) blocks.push(buffer.join(' '));
    return blocks.length ? blocks : [rawText];
  }

  function looksLikeHeading(line) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 9) return false;
    if (/[.!?]$/.test(line)) return false;
    const capitalized = words.filter(w => /^[A-Z0-9]/.test(w)).length;
    return capitalized / words.length >= 0.6 || /^#+\s/.test(line) || /^[0-9]+[.)]\s/.test(line);
  }

  function splitSentences(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const matches = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [];
    return matches.map(s => s.trim()).filter(s => s.length > 0);
  }

  /** Word similarity between two sentences (normalized word overlap —
   *  the standard TextRank sentence-similarity formula). */
  function sentenceSimilarity(wordsA, wordsB) {
    if (wordsA.length === 0 || wordsB.length === 0) return 0;
    const setB = new Set(wordsB);
    let shared = 0;
    new Set(wordsA).forEach(w => { if (setB.has(w)) shared++; });
    const norm = Math.log(wordsA.length + 1) + Math.log(wordsB.length + 1);
    return norm === 0 ? 0 : shared / norm;
  }

  /** TextRank: builds a graph where sentences are nodes and edges are
   *  weighted by similarity, then runs power-iteration (like PageRank)
   *  so a sentence's importance depends on how well-connected it is to
   *  the rest of the passage, not just raw word frequency. */
  function textRank(sentences, opts) {
    opts = opts || {};
    const damping = 0.85;
    const iterations = 30;
    const n = sentences.length;
    const wordSets = sentences.map(s => significantWords(s));

    const sim = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const s = sentenceSimilarity(wordSets[i], wordSets[j]);
        sim[i][j] = s; sim[j][i] = s;
      }
    }
    const outSum = sim.map(row => row.reduce((a, b) => a + b, 0));
    let scores = new Array(n).fill(1 / Math.max(n, 1));

    for (let it = 0; it < iterations; it++) {
      const next = new Array(n).fill((1 - damping) / Math.max(n, 1));
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < n; j++) {
          if (j === i || sim[j][i] === 0 || outSum[j] === 0) continue;
          acc += (sim[j][i] / outSum[j]) * scores[j];
        }
        next[i] += damping * acc;
      }
      scores = next;
    }

    // Positional bonus: lead + closing sentences of a passage carry
    // real information (topic sentence / conclusion), same instinct a
    // human skim-reader uses.
    return sentences.map((s, idx) => {
      let score = scores[idx];
      if (idx === 0) score *= 1.3;
      if (idx === n - 1) score *= 1.12;
      return { idx, text: s, score, words: wordSets[idx] };
    });
  }

  /** TF-IDF-flavoured keyword extraction across the whole passage,
   *  boosting words that also appear in heading-like lines. */
  function extractKeyTerms(sentences, headingWords, limit) {
    const freq = {};
    sentences.forEach(s => significantWords(s).forEach(w => { freq[w] = (freq[w] || 0) + 1; }));
    const maxFreq = Math.max(1, ...Object.values(freq));
    const boosted = {};
    Object.keys(freq).forEach(w => {
      let score = freq[w] / maxFreq;
      if (headingWords.has(w)) score *= 1.6;
      if (w.length >= 7) score *= 1.1; // longer terms tend to be domain-specific
      boosted[w] = score;
    });
    return Object.entries(boosted).sort((a, b) => b[1] - a[1]).slice(0, limit || 10).map(([w]) => w);
  }

  function findDefinitions(sentences, limit) {
    const found = [];
    for (const s of sentences) {
      for (const re of DEFINITION_PATTERNS) {
        const m = s.match(re);
        if (m) { found.push({ term: m[1].trim(), sentence: s }); break; }
      }
      if (found.length >= (limit || 5)) break;
    }
    return found;
  }

  /** Full analysis pipeline used by both AI pages. */
  function analyze(rawText) {
    const blocks = splitStructure(rawText);
    const headingLines = [];
    const bodyBlocks = [];
    blocks.forEach(b => {
      if (looksLikeHeading(b) && b.split(/\s+/).length <= 9) headingLines.push(b.replace(/^#+\s*/, ''));
      else bodyBlocks.push(b);
    });
    const bodyText = bodyBlocks.join(' ');
    const sentences = splitSentences(bodyText.length ? bodyText : rawText);
    const headingWords = new Set();
    headingLines.forEach(h => significantWords(h).forEach(w => headingWords.add(w)));

    const ranked = textRank(sentences);
    const terms = extractKeyTerms(sentences, headingWords, 12);
    const definitions = findDefinitions(sentences, 5);

    return { sentences, ranked, terms, definitions, headings: headingLines };
  }

  /** Produces a coherent structured summary rather than just "top N
   *  sentences in original order" — groups the highest-ranked
   *  sentences, then trims to a target ratio and returns them in
   *  reading order plus a one-line auto headline. */
  function summarize(rawText, ratio) {
    const { sentences, ranked, terms, definitions, headings } = analyze(rawText);
    if (sentences.length === 0) return null;
    const keepCount = Math.max(1, Math.round(sentences.length * (ratio || 0.3)));
    const top = [...ranked].sort((a, b) => b.score - a.score).slice(0, keepCount);
    top.sort((a, b) => a.idx - b.idx);
    const headline = headings[0] || (top[0] ? top[0].text.split(/[.!?]/)[0] : '');
    return {
      headline,
      summarySentences: top.map(t => t.text),
      terms,
      definitions,
      sentenceCount: sentences.length,
      keptCount: top.length
    };
  }

  /** Draft fill-in-the-blank questions from the most information-dense
   *  sentences, picking the *rarest* significant word in each sentence
   *  as the blank (rarer words carry more distinguishing information
   *  than the most frequent one). */
  function draftQuestions(rawText, count) {
    const { sentences, ranked } = analyze(rawText);
    const freq = {};
    sentences.forEach(s => significantWords(s).forEach(w => { freq[w] = (freq[w] || 0) + 1; }));
    const candidates = [...ranked].filter(s => s.words.length >= 4).sort((a, b) => b.score - a.score).slice(0, count || 6);
    return candidates.map((t, i) => {
      const rarest = [...t.words].sort((a, b) => (freq[a] || 0) - (freq[b] || 0))[0] || t.words[0];
      const re = new RegExp('\\b' + rarest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      const blanked = t.text.replace(re, '_____');
      return { n: i + 1, blanked, answer: rarest };
    });
  }

  /** Milestone-idea suggestions clustered around distinct top terms
   *  (not just three random top sentences), so each idea targets a
   *  different concept from the passage. */
  function draftMilestones(rawText, count) {
    const { ranked, terms } = analyze(rawText);
    const sortedSentences = [...ranked].sort((a, b) => b.score - a.score);
    const used = new Set();
    const ideas = [];
    for (const term of terms) {
      if (ideas.length >= (count || 3)) break;
      const match = sortedSentences.find(s => !used.has(s.idx) && s.words.includes(term));
      if (match) { used.add(match.idx); ideas.push({ topic: term, hint: match.text }); }
    }
    // Fill remaining slots from top sentences if not enough term matches
    for (const s of sortedSentences) {
      if (ideas.length >= (count || 3)) break;
      if (used.has(s.idx)) continue;
      used.add(s.idx);
      ideas.push({ topic: terms[0] || 'this topic', hint: s.text });
    }
    return ideas.map((idea, i) => ({
      title: `Review & explain: ${idea.topic}`,
      points: 15 + i * 10,
      hint: idea.hint.slice(0, 100) + (idea.hint.length > 100 ? '…' : '')
    }));
  }

  /* ---------------- PDF text extraction ----------------
     Lazily loads pdf.js from cdnjs only when a PDF is actually
     dropped in, so pages that never touch a PDF pay no cost. */
  let pdfjsLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsLoading) return pdfjsLoading;
    pdfjsLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('Could not load the PDF reader library.'));
      document.head.appendChild(script);
    });
    return pdfjsLoading;
  }

  /** Extracts plain text from a PDF File/Blob, page by page, with a
   *  progress callback(pageNum, totalPages). */
  async function extractPdfText(fileOrBlob, onProgress) {
    const pdfjsLib = await loadPdfJs();
    const buf = await fileOrBlob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => it.str).join(' ');
      text += pageText + '\n\n';
      if (onProgress) onProgress(p, pdf.numPages);
    }
    return text.trim();
  }

  /** Extracts PDF text from a remote URL (e.g. a Firebase Storage
   *  download URL for a published reading material). */
  async function extractPdfTextFromUrl(url, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Could not download that PDF.');
    const blob = await resp.blob();
    return extractPdfText(blob, onProgress);
  }

  return {
    tokenize, significantWords, splitSentences, analyze, summarize,
    draftQuestions, draftMilestones, extractPdfText, extractPdfTextFromUrl
  };
})();
