/**
 * ================================================================
 *  BLUE MANDARIN — vocab.js  (Advanced Vocabulary Page)
 *  Full 500-word dictionary with:
 *    · Search by Hanzi / Pinyin / Arabic
 *    · Filter: All | Saved (⭐) | Remaining
 *    · Tonal colour coding on every card
 *    · Show/Hide Pinyin toggle
 *    · Web Speech API "Listen" button
 *    · Save/Favourite per word (persisted to localStorage)
 *    · Example sentences from word_examples.json
 *    · Lesson filter chips
 * ================================================================
 */
'use strict';

const VocabPage = (() => {

  const STORAGE_KEY = 'bm:saved_words';

  // ── State ───────────────────────────────────────────────────────
  let _allWords      = [];   // full 500-word array from KG
  let _examples      = {};   // { lessonId: { cn: { zh, py, ar } } }
  let _savedSet      = new Set();
  let _filter        = 'all';  // 'all' | 'saved' | 'remaining'
  let _searchQuery   = '';
  let _lessonFilter  = 0;    // 0 = all lessons
  let _rendered      = false;

  // ── Persistence ─────────────────────────────────────────────────
  function _loadSaved() {
    try { _savedSet = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')); }
    catch (_) { _savedSet = new Set(); }
  }
  function _persistSaved() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([..._savedSet]));
  }
  function toggleSave(wordId) {
    if (_savedSet.has(wordId)) _savedSet.delete(wordId);
    else                        _savedSet.add(wordId);
    _persistSaved();
  }
  function isSaved(wordId) { return _savedSet.has(wordId); }

  // ── TTS helper ──────────────────────────────────────────────────
  let _ttsInFlight = null;
  function speak(cn) {
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(cn);
    utt.lang   = 'zh-CN';
    utt.rate   = 0.85;
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    // Try to pick a zh-CN voice if available
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'));
    if (zh) utt.voice = zh;
    window.speechSynthesis.speak(utt);
    _ttsInFlight = utt;
    return utt;
  }

  // ── Tone helpers ────────────────────────────────────────────────
  const T = window.BM?.Tones;
  function _toneClass(py) { return T ? T.getCls(T.getTone(py)) : ''; }
  function _wrapPy(py)    { return T ? T.wrapCompoundPinyin(py) : `<span>${py}</span>`; }

  // ── Filter logic ────────────────────────────────────────────────
  function _applyFilters() {
    const q = _searchQuery.toLowerCase().trim();
    return _allWords.filter(w => {
      // Lesson filter
      if (_lessonFilter && w.lessonId !== _lessonFilter) return false;
      // Tab filter
      if (_filter === 'saved'     && !isSaved(w.id)) return false;
      if (_filter === 'remaining' &&  isSaved(w.id)) return false;
      // Search
      if (q) {
        return (
          w.cn.includes(q) ||
          w.pinyin.toLowerCase().includes(q) ||
          w.ar.includes(q)
        );
      }
      return true;
    });
  }

  // ── Card HTML ───────────────────────────────────────────────────
  function _cardHtml(w) {
    const saved  = isSaved(w.id);
    const tc     = _toneClass(w.pinyin);
    const lid    = w.lessonId;
    const ex     = _examples[lid]?.[w.cn];

    const exHtml = ex ? `
      <div class="vp-example">
        <div class="vp-ex-zh">${ex.zh}</div>
        <div class="vp-ex-py bm-pinyin">${ex.py}</div>
        <div class="vp-ex-ar">${ex.ar}</div>
      </div>` : '';

    return `
    <div class="vp-card ${tc}" data-word-id="${w.id}" data-cn="${w.cn}" data-pinyin="${w.pinyin}">
      <div class="vp-card-top">
        <div class="vp-cn ${tc}" data-pinyin="${w.pinyin}">${w.cn}</div>
        <div class="vp-right">
          <div class="vp-py bm-pinyin">${_wrapPy(w.pinyin)}</div>
          <div class="vp-ar">${w.ar}</div>
          <div class="vp-type">${w.type}</div>
        </div>
      </div>
      ${exHtml}
      <div class="vp-actions">
        <button class="vp-btn-listen rip" data-cn="${w.cn}" title="استمع">
          🔊 استمع
        </button>
        <button class="vp-btn-save rip ${saved ? 'saved' : ''}" data-word-id="${w.id}" title="حفظ">
          ${saved ? '⭐ محفوظ' : '☆ احفظ'}
        </button>
      </div>
    </div>`;
  }

  // ── Render ──────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('vp-word-list');
    if (!container) return;

    const filtered = _applyFilters();
    document.getElementById('vp-count')?.setAttribute('data-count', filtered.length);
    const countEl = document.getElementById('vp-count');
    if (countEl) countEl.textContent = `${filtered.length} كلمة`;

    if (!filtered.length) {
      container.innerHTML = `
        <div class="vp-empty">
          <div style="font-size:48px">🔍</div>
          <div style="font-size:14px;color:var(--text-3);direction:rtl;margin-top:8px">
            ${_searchQuery ? 'لا توجد نتائج للبحث' : _filter === 'saved' ? 'لم تحفظ أي كلمة بعد' : 'لا توجد كلمات'}
          </div>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(_cardHtml).join('');
    _wireCards(container);
    // Apply pinyin visibility
    if (window.BM?.Tones && !window.BM.Tones.isPinyinVisible()) {
      container.querySelectorAll('.bm-pinyin').forEach(el => el.style.display = 'none');
    }
  }

  function _wireCards(container) {
    // Listen buttons
    container.querySelectorAll('.vp-btn-listen').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        speak(btn.dataset.cn);
        btn.textContent = '🔊 ...';
        setTimeout(() => { btn.textContent = '🔊 استمع'; }, 1500);
      });
    });
    // Save buttons
    container.querySelectorAll('.vp-btn-save').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        const id = +btn.dataset.wordId;
        toggleSave(id);
        const saved = isSaved(id);
        btn.textContent = saved ? '⭐ محفوظ' : '☆ احفظ';
        btn.classList.toggle('saved', saved);
        // If filter is 'saved' or 'remaining', re-render to update list
        if (_filter !== 'all') render();
      });
    });
  }

  // ── Build overlay HTML ──────────────────────────────────────────
  function _buildOverlay() {
    let ov = document.getElementById('overlay-vocab-page');
    if (ov) return ov;

    ov = document.createElement('div');
    ov.id        = 'overlay-vocab-page';
    ov.className = 'overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'المفردات');
    ov.setAttribute('aria-modal', 'true');

    ov.innerHTML = `
      <div class="overlay-header vp-header">
        <button class="overlay-close rip" id="vp-close" aria-label="Close">✕</button>
        <div style="flex:1;text-align:center">
          <div class="overlay-title">📚 المفردات</div>
          <div class="overlay-sub" id="vp-count">500 كلمة</div>
        </div>
        <button id="btn-pinyin-toggle" class="vp-toggle-btn rip">👁️ إخفاء البينيين</button>
      </div>

      <!-- Search bar -->
      <div class="vp-search-bar">
        <input type="text" id="vp-search-input"
          placeholder="ابحث بالعربية، الهانزي، أو البينيين…"
          autocomplete="off" autocorrect="off" dir="rtl" />
        <span class="vp-search-icon">🔍</span>
      </div>

      <!-- Filter tabs: All | Saved | Remaining -->
      <div class="vp-filter-tabs">
        <button class="vp-filter-btn active" data-filter="all">الكل</button>
        <button class="vp-filter-btn" data-filter="saved">⭐ المحفوظة</button>
        <button class="vp-filter-btn" data-filter="remaining">📖 الباقي</button>
      </div>

      <!-- Lesson chips -->
      <div class="vp-lesson-chips" id="vp-lesson-chips">
        <button class="vp-chip active" data-lesson="0">الكل</button>
        <button class="vp-chip" data-lesson="1">👋 L1</button>
        <button class="vp-chip" data-lesson="2">👨‍👩‍👧 L2</button>
        <button class="vp-chip" data-lesson="3">🔢 L3</button>
        <button class="vp-chip" data-lesson="4">⏰ L4</button>
        <button class="vp-chip" data-lesson="5">🌤️ L5</button>
        <button class="vp-chip" data-lesson="6">🎨 L6</button>
        <button class="vp-chip" data-lesson="7">🍜 L7</button>
        <button class="vp-chip" data-lesson="8">🛍️ L8</button>
        <button class="vp-chip" data-lesson="9">🗺️ L9</button>
        <button class="vp-chip" data-lesson="10">🚌 L10</button>
        <button class="vp-chip" data-lesson="11">🎓 L11</button>
        <button class="vp-chip" data-lesson="12">💼 L12</button>
        <button class="vp-chip" data-lesson="13">🎮 L13</button>
        <button class="vp-chip" data-lesson="14">💊 L14</button>
        <button class="vp-chip" data-lesson="15">💙 L15</button>
      </div>

      <!-- Word list -->
      <div class="vp-body" id="vp-word-list">
        <!-- Populated by VocabPage.render() -->
        ${[1,2,3,4,5,6].map(() =>
          '<div class="skeleton" style="height:80px;border-radius:12px"></div>'
        ).join('')}
      </div>`;

    document.body.appendChild(ov);
    _wireOverlay(ov);
    return ov;
  }

  function _wireOverlay(ov) {
    // Close
    document.getElementById('vp-close').addEventListener('pointerdown', e => {
      e.preventDefault();
      close();
    });

    // Pinyin toggle
    document.getElementById('btn-pinyin-toggle').addEventListener('pointerdown', e => {
      e.preventDefault();
      const T = window.BM?.Tones;
      if (T) T.togglePinyin(!T.isPinyinVisible());
    });

    // Search
    const searchInput = document.getElementById('vp-search-input');
    searchInput.addEventListener('input', () => {
      _searchQuery = searchInput.value;
      render();
    });

    // Filter tabs
    ov.querySelectorAll('.vp-filter-btn').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        _filter = btn.dataset.filter;
        ov.querySelectorAll('.vp-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
        render();
      });
    });

    // Lesson chips
    ov.querySelectorAll('.vp-chip').forEach(chip => {
      chip.addEventListener('pointerdown', e => {
        e.preventDefault();
        _lessonFilter = +chip.dataset.lesson;
        ov.querySelectorAll('.vp-chip').forEach(c => c.classList.toggle('active', c === chip));
        render();
      });
    });
  }

  // ── Public ──────────────────────────────────────────────────────
  async function open() {
    _loadSaved();

    // Load word data from KG or DataManager
    if (!_allWords.length) {
      const kg = window.BM?.KnowledgeGraph;
      if (kg?.vocab?.all?.length) {
        _allWords = kg.vocab.all;
      } else {
        _allWords = (await window.BM?.DataManager?.getVocab()) ?? [];
      }
    }

    // Load examples
    if (!Object.keys(_examples).length) {
      try {
        const r = await fetch(`./data/hsk1/word_examples.json?_v=${Date.now()}`);
        if (r.ok) _examples = await r.json();
      } catch (_) {}
    }

    const ov = _buildOverlay();
    ov.classList.add('open');
    render();
  }

  function close() {
    document.getElementById('overlay-vocab-page')?.classList.remove('open');
  }

  return { open, close, toggleSave, isSaved, speak, render };
})();

window.BM = window.BM ?? {};
window.BM.VocabPage = VocabPage;
