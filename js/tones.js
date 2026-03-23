/**
 * ================================================================
 *  BLUE MANDARIN — tones.js  (Tonal Colour System)
 *  Implements the 5-tone visual colour system across the entire app.
 *
 *  Tone colours (matching the uploaded reference):
 *    Tone 1 (High/Flat)  → #E53935  Red
 *    Tone 2 (Rising)     → #43A047  Green
 *    Tone 3 (Dipping)    → #1E88E5  Blue
 *    Tone 4 (Falling)    → #8E24AA  Purple
 *    Neutral (0)         → #9E9E9E  Grey
 *
 *  Public API (window.BM.Tones):
 *    getTone(pinyin)               → 0|1|2|3|4
 *    getColor(toneNumber)          → CSS colour string
 *    wrapPinyin(pinyin)            → '<span class="t1">mā</span>'
 *    wrapCn(cn, pinyin)            → '<span class="t3">我</span>'
 *    colorizeCard(cardEl, pinyin)  → applies colour class to card element
 *    applyToAll()                  → colourises all .tone-target elements in DOM
 *    togglePinyin(visible)         → show/hide all .py-hide spans globally
 * ================================================================
 */
'use strict';

const TonesEngine = (() => {

  // ── Tone detection ─────────────────────────────────────────────
  const TONE1_CHARS = 'āēīōūǖĀĒĪŌŪǕ';
  const TONE2_CHARS = 'áéíóúǘÁÉÍÓÚǗ';
  const TONE3_CHARS = 'ǎěǐǒǔǚǍĚǏǑǓǙ';
  const TONE4_CHARS = 'àèìòùǜÀÈÌÒÙǛ';

  function getTone(pinyin) {
    if (!pinyin) return 0;
    for (const c of pinyin) {
      if (TONE1_CHARS.includes(c)) return 1;
      if (TONE2_CHARS.includes(c)) return 2;
      if (TONE3_CHARS.includes(c)) return 3;
      if (TONE4_CHARS.includes(c)) return 4;
    }
    return 0;
  }

  // ── Colour map ──────────────────────────────────────────────────
  const COLORS = {
    0: '#9E9E9E',  // Neutral — grey
    1: '#E53935',  // Tone 1  — red    (High/Flat)
    2: '#43A047',  // Tone 2  — green  (Rising)
    3: '#1E88E5',  // Tone 3  — blue   (Dipping)
    4: '#8E24AA',  // Tone 4  — purple (Falling)
  };
  const CSS_CLASSES = { 0:'t0', 1:'t1', 2:'t2', 3:'t3', 4:'t4' };

  function getColor(tone) { return COLORS[tone] ?? COLORS[0]; }
  function getCls(tone)   { return CSS_CLASSES[tone] ?? 't0'; }

  // ── HTML builders ───────────────────────────────────────────────

  /** Wraps a pinyin string in a tone-coloured <span> */
  function wrapPinyin(pinyin) {
    if (!pinyin) return '';
    const tone = getTone(pinyin);
    return `<span class="${getCls(tone)} tone-py">${pinyin}</span>`;
  }

  /** Wraps a Chinese character in a tone-coloured <span> using its pinyin */
  function wrapCn(cn, pinyin) {
    if (!cn) return '';
    const tone = getTone(pinyin);
    return `<span class="${getCls(tone)} tone-cn">${cn}</span>`;
  }

  /**
   * Colourises a compound pinyin string (e.g. "nǐ hǎo") by syllable.
   * Each space-separated syllable gets its own tone span.
   */
  function wrapCompoundPinyin(pinyinStr) {
    return pinyinStr.split(/\s+/).map(syl => wrapPinyin(syl)).join(' ');
  }

  // ── Pinyin visibility toggle ────────────────────────────────────
  let _pinyinVisible = true;

  /**
   * togglePinyin(visible) — show or hide all .tone-py and .bm-pinyin elements.
   * When hidden, students must recall pinyin from the character alone.
   * @param {boolean} visible
   */
  function togglePinyin(visible) {
    _pinyinVisible = visible;
    const style = visible ? '' : 'none';
    document.querySelectorAll('.tone-py, .bm-pinyin, .fc-pinyin, .ld-word-py, .ce-word-py').forEach(el => {
      el.style.display = style;
    });
    // Update button text if it exists
    const btn = document.getElementById('btn-pinyin-toggle');
    if (btn) btn.textContent = visible ? '👁️ إخفاء البينيين' : '👁️ إظهار البينيين';
  }

  function isPinyinVisible() { return _pinyinVisible; }

  // ── Apply to DOM ────────────────────────────────────────────────
  /**
   * applyToAll() — post-render pass over every element with
   * data-pinyin attribute to inject tone colour classes.
   */
  function applyToAll() {
    document.querySelectorAll('[data-pinyin]').forEach(el => {
      const py   = el.dataset.pinyin;
      const tone = getTone(py);
      el.classList.remove('t0','t1','t2','t3','t4');
      el.classList.add(getCls(tone));
    });
  }

  // ── Tone reference data ─────────────────────────────────────────
  const TONE_META = [
    { n:1, mark:'ā', ar:'المستوية',      shape:'——', color:COLORS[1] },
    { n:2, mark:'á', ar:'الصاعدة',       shape:'/',  color:COLORS[2] },
    { n:3, mark:'ǎ', ar:'المنحنية',      shape:'∨',  color:COLORS[3] },
    { n:4, mark:'à', ar:'الهابطة',       shape:'\\', color:COLORS[4] },
    { n:0, mark:'·', ar:'المحايدة',      shape:'·',  color:COLORS[0] },
  ];

  return {
    getTone,
    getColor,
    getCls,
    wrapPinyin,
    wrapCn,
    wrapCompoundPinyin,
    togglePinyin,
    isPinyinVisible,
    applyToAll,
    COLORS,
    TONE_META,
  };
})();

window.BM = window.BM ?? {};
window.BM.Tones = TonesEngine;
