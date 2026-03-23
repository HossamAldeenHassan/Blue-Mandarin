/**
 * ================================================================
 *  BLUE MANDARIN — ui.js  (App Controller)
 *  All DOM interaction, rendering, and engine logic.
 *  Depends on: data.js, progress.js, shelly.js (loaded before this).
 *  Entry-point: DOMContentLoaded → init()
 * ================================================================
 */
'use strict';

/* ===========================================================
   APP CONTROLLER — ui.js  v1.3.0
   Phase 3 shell + engine, wired to BM modules.
   =========================================================== */

// ── Boot diagnostics ─────────────────────────────────────────
// These logs appear in console immediately so you can verify:
// 1) The script executed, 2) Key DOM containers exist
console.log('DOM Fully Loaded ❄️');
console.log('Target Container Found:', !!document.getElementById('lessons-grid'));
console.log('Story List Found:',       !!document.getElementById('story-list'));
console.log('Grammar List Found:',     !!document.getElementById('grammar-list'));
console.log('Home Path Found:',        !!document.getElementById('home-path-container'));

// ── BM module guard ───────────────────────────────────────────
// Silently check — only warn if modules actually failed to load.
// This fires AFTER DOMContentLoaded so the <script> tags have
// already executed (or 404'd).
const _bmOk = !!(window.BM?.DataManager && window.BM?.ProgressManager && window.BM?.ShellyAI);
if (!_bmOk) {
  console.warn(
    '[Blue Mandarin] One or more BM modules failed to load.\n' +
    'Check that these files exist relative to index.html:\n' +
    '  ./js/data.js  ·  ./js/progress.js  ·  ./js/shelly.js\n' +
    'And that your dev server root is the folder containing index.html.'
  );
}

// ── Safe aliases ───────────────────────────────────────────────
// The _noop Proxy returns a function that always returns [] for
// array-producing methods (getWords, getTestQuestions) so that
// ALL_WORDS stays an Array even when modules fail to load,
// preventing the "ALL_WORDS.filter is not a function" crash.
const _safeFallbackWords = () => window.BM?.DataManager?.getFallbackWords?.() ?? [];
const _noop = new Proxy({}, {
  get(_, prop) {
    // Methods that must return an Array get a promise-wrapped []
    if (['getWords','getLessons','getTestQuestions','prefetchAll','getFallbackWords'].includes(prop)) {
      return () => Promise.resolve(_safeFallbackWords());
    }
    // Everything else: no-op returning empty object
    return () => ({});
  }
});

const Data     = window.BM?.DataManager     ?? _noop;
const Progress = window.BM?.ProgressManager ?? _noop;
const Shelly   = window.BM?.ShellyAI       ?? _noop;

// ── Global TTS helper (sentences, dialogues, stories) ──────────
let _ttsActivBtn = null;
function _speakZh(text, btn) {
  window.speechSynthesis.cancel();
  if (_ttsActivBtn) { _ttsActivBtn.textContent = '🔊'; _ttsActivBtn = null; }
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = 'zh-CN';
  utt.rate   = 0.82;
  utt.pitch  = 1.0;
  utt.volume = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const zh = voices.find(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'));
  if (zh) utt.voice = zh;
  if (btn) {
    _ttsActivBtn = btn;
    utt.onstart = () => { btn.textContent = '...'; };
    utt.onend   = () => { btn.textContent = '🔊'; _ttsActivBtn = null; };
  }
  window.speechSynthesis.speak(utt);
}

// ===========================================================
// 1. SERVICE WORKER REGISTRATION
// ===========================================================
(function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  // Only register on genuine local dev or production domains.
  // Skips claudeusercontent.com, any CDN preview, and any origin
  // that doesn't actually host sw.js — avoids the 404 that was
  // appearing in the console when the app was previewed in Claude.
  const host = location.hostname;
  const ALLOWED = ['localhost', '127.0.0.1', '0.0.0.0'];
  const isLocal      = ALLOWED.includes(host);
  const isProduction = host.length > 0 &&
                       !host.includes('claudeusercontent') &&
                       !host.includes('webcontainer') &&
                       !host.includes('csb.app') &&       // CodeSandbox
                       !host.includes('stackblitz');       // StackBlitz

  if (!isLocal && !isProduction) {
    console.info('[BM SW] Skipped registration — preview environment detected:', host);
    return;
  }

  // Use a document-relative path so the SW scope always matches
  // wherever index.html is being served from (root or sub-path).
  navigator.serviceWorker.register('./sw.js')
    .then(r => {
      console.log('[BM SW] ✓ Registered — scope:', r.scope);
      navigator.serviceWorker.addEventListener('message', evt => {
        if (evt.data?.type === 'FLUSH_SYNC_QUEUE') {
          const queue = Progress.flushSyncQueue();
          console.log('[BM] Flushed sync queue:', queue.length, 'events');
          // TODO (Phase 5): POST queue to your backend endpoint here
        }
      });
    })
    .catch(e => {
      // Non-fatal — the app works fully without the SW.
      console.warn('[BM SW] Registration failed:', e.message,
        '\nEnsure sw.js is in the same folder as index.html.');
    });
})();

// ===========================================================
// 2. GLOBAL STATE
// ===========================================================
const VIEW_ORDER = ['home', 'learn', 'read', 'shelly', 'profile'];
let   activeView = 'home';

/** All HSK words (vocab) loaded from DataManager */
let ALL_WORDS    = [];
/** Full KnowledgeGraph — available after prefetchAll() */
let KG           = null;

// ===========================================================
// 3. SNOWFALL CANVAS
// ===========================================================
(function Snowfall() {
  const canvas = document.getElementById('snow-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, flakes = [];
  const COUNT = 55;

  class Flake {
    reset(start) {
      this.x = Math.random() * W;   this.y = start ? Math.random() * H : -8;
      this.r = Math.random() * 2.2 + 0.4;  this.vy = Math.random() * 0.55 + 0.12;
      this.vx = Math.random() * 0.25 - 0.125;
      this.alpha = Math.random() * 0.45 + 0.15;
      this.angle = Math.random() * Math.PI * 2;
      this.spin  = (Math.random() - 0.5) * 0.018;
    }
    constructor() { this.reset(true); }
    update() {
      this.angle += this.spin;
      this.x += this.vx + Math.sin(this.angle) * 0.25;
      this.y += this.vy;
      if (this.y > H + 8 || this.x < -8 || this.x > W + 8) this.reset(false);
    }
    draw() {
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(168,216,240,${this.alpha})`; ctx.fill();
    }
  }
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  function init()   { flakes = Array.from({ length: COUNT }, () => new Flake()); }
  function tick()   { ctx.clearRect(0, 0, W, H); flakes.forEach(f => { f.update(); f.draw(); }); requestAnimationFrame(tick); }
  resize(); init(); tick();
  window.addEventListener('resize', () => { resize(); init(); }, { passive: true });
})();

// ===========================================================
// 4. NAVIGATION ENGINE
// ===========================================================
const navItems = document.querySelectorAll('.nav-item');

function navigateTo(viewId) {
  if (viewId === activeView) return;
  const prevEl  = document.getElementById('view-' + activeView);
  const nextEl  = document.getElementById('view-' + viewId);
  const goRight = VIEW_ORDER.indexOf(viewId) > VIEW_ORDER.indexOf(activeView);

  Object.assign(prevEl.style, { transition: 'opacity 200ms ease, transform 200ms ease', opacity: '0', transform: goRight ? 'translateX(-18px)' : 'translateX(18px)', pointerEvents: 'none' });
  Object.assign(nextEl.style, { transition: 'none', opacity: '0', transform: goRight ? 'translateX(18px)' : 'translateX(-18px)' });
  nextEl.classList.add('active');
  nextEl.style.pointerEvents = 'all';

  requestAnimationFrame(() => requestAnimationFrame(() => {
    Object.assign(nextEl.style, { transition: 'opacity 280ms cubic-bezier(0,0,0.2,1), transform 280ms cubic-bezier(0,0,0.2,1)', opacity: '1', transform: 'translateX(0)' });
    setTimeout(() => {
      prevEl.classList.remove('active');
      ['opacity','transform','transition','pointerEvents'].forEach(p => prevEl.style[p] = '');
      ['transition','opacity','transform'].forEach(p => nextEl.style[p] = '');
    }, 300);
  }));

  navItems.forEach(item => {
    const on = item.dataset.view === viewId;
    item.classList.toggle('active', on);
    item.setAttribute('aria-selected', on);
  });
  nextEl.scrollTop = 0;
  if (navigator.vibrate) navigator.vibrate(6);
  activeView = viewId;
}

// Use pointerdown instead of click: fires immediately on touch with zero 300ms delay.
// pointerdown fires before the browser decides if it's a tap, double-tap, or scroll.
navItems.forEach(item => {
  item.addEventListener('pointerdown', e => {
    if (e.isPrimary === false) return;
    e.preventDefault();
    const v = item.dataset.view;
    if (v === 'learn')     { window.BM?.VocabPage?.open(); return; }
    if (v === 'translate') { navigateTo(v); setTimeout(() => window.BM?.TranslatorTool?.init(), 50); return; }
    navigateTo(v);
  });
  item.addEventListener('click', e => {
    if (e.pointerType) return;
    const v = item.dataset.view;
    if (v === 'learn')     { window.BM?.VocabPage?.open(); return; }
    if (v === 'translate') { navigateTo(v); setTimeout(() => window.BM?.TranslatorTool?.init(), 50); return; }
    navigateTo(v);
  });
});

// ===========================================================
// 4B. switchPage() — smart routing for Stories and Grammar
// ===========================================================
/**
 * switchPage(pageId) — the single entry-point for all navigation.
 * Handles both view switching AND sub-panel activation for
 * the read view (stories / grammar).
 *
 * pageId values: 'home' | 'learn' | 'stories' | 'grammar' | 'shelly' | 'profile'
 *
 * Stories and Grammar both live inside view-read. Calling switchPage
 * navigates there AND activates the correct panel AND triggers rendering
 * with real data from the KnowledgeGraph (if available).
 */
function switchPage(pageId) {
  const VIEW_MAP = {
    home:    'home',
    learn:   'learn',
    stories: 'read',
    grammar: 'read',
    shelly:  'shelly',
    profile: 'profile',
  };

  const viewId = VIEW_MAP[pageId] ?? pageId;

  // Navigate to the parent view first
  if (viewId !== activeView) navigateTo(viewId);

  // Sub-panel switching for read view
  if (pageId === 'stories' || pageId === 'grammar') {
    const tab = pageId === 'stories' ? 'stories' : 'grammar';

    // Activate the correct read-tab
    document.querySelectorAll('.read-tab').forEach(t => {
      const on = t.dataset.readTab === tab;
      t.classList.toggle('active', on);
    });
    // Activate the correct read-panel
    document.querySelectorAll('.read-panel').forEach(p => {
      p.classList.toggle('active', p.id === `read-panel-${tab}`);
    });

    if (pageId === 'stories') {
      // Render stories with KG data (already loaded in init)
      const stories = KG?.stories?.all ?? [];
      const storyList = document.getElementById('story-list');
      if (stories.length && storyList && !storyList.querySelector('.story-card')) {
        renderStoryList(stories);
        console.log('[BM] switchPage: renderStoryList called →', stories.length, 'stories');
      }
    } else {
      // Grammar — use smart re-render guard already in GrammarViewer
      GrammarViewer.render();
      console.log('[BM] switchPage: GrammarViewer.render() called');
    }
  }
}

// ===========================================================
// 5. RIPPLE EFFECT
// ===========================================================
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('.rip');
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2.2;
  const wave = document.createElement('span');
  wave.className = 'ripple-wave';
  wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px;`;
  el.appendChild(wave);

  // FIX: Guard removal — the element may have been detached by a navigation
  // transition before the animation ends, which caused the NotFoundError:
  // "Failed to execute 'removeChild' on 'Node': The node to be removed is
  // not a child of this node."
  const safeRemove = () => {
    try {
      if (wave.isConnected) wave.remove();
    } catch (_) { /* already removed — silently ignore */ }
  };
  wave.addEventListener('animationend', safeRemove, { once: true });
  // Belt-and-suspenders: also remove after CSS animation duration + buffer
  setTimeout(safeRemove, 600);
});

// ===========================================================
// 6. TOAST
// ===========================================================
function toast(msg, ms = 2800) {
  const wrap = document.getElementById('toast');
  document.getElementById('toast-inner').textContent = msg;
  wrap.classList.add('show');
  clearTimeout(wrap._t);
  wrap._t = setTimeout(() => wrap.classList.remove('show'), ms);
}

// ===========================================================
// 7. STATS UI REFRESH
// ===========================================================
function refreshUI() {
  const s = Progress.getStats();

  // Top bar chips
  document.getElementById('streak-val').textContent = s.streakDays;
  document.getElementById('xp-val').textContent = s.xp;

  // Home view
  document.getElementById('home-name').textContent = s.name;
  document.getElementById('stat-streak').textContent = s.streakDays;
  document.getElementById('stat-xp').textContent = s.xp;
  document.getElementById('stat-level').textContent = s.level;

  // Use TOTAL_VOCAB (500) from vocab.json; fall back to loaded word count
  const totalVocab = typeof TOTAL_VOCAB !== 'undefined' ? TOTAL_VOCAB : (ALL_WORDS.length || 500);
  const totalLessons = typeof LESSON_PLAN !== 'undefined' ? LESSON_PLAN.length : 15;
  const wordPct    = Math.round((s.wordsLearned / totalVocab) * 100);
  const lessonPct  = Math.round((s.lessonsCompleted / totalLessons) * 100);
  const CIRCUM     = 201.1;

  document.getElementById('ring-pct').textContent = wordPct + '%';
  document.getElementById('ring-wrap').setAttribute('aria-valuenow', wordPct);
  document.getElementById('ring-progress').style.strokeDashoffset = CIRCUM * (1 - wordPct / 100);
  document.getElementById('bar-words').style.width   = wordPct  + '%';
  document.getElementById('bar-lessons').style.width = lessonPct + '%';
  document.getElementById('words-count').textContent   = `${s.wordsLearned} / ${totalVocab}`;
  document.getElementById('lessons-count').textContent = `${s.lessonsCompleted} / ${totalLessons}`;

  document.getElementById('daily-meta').textContent = s.dailyDone
    ? '✅ تم اليوم!'
    : '+50 XP · ابدأ التحدي';

  // Sync home-path node states whenever stats are refreshed
  if (typeof renderHomePath === 'function') renderHomePath();

  // Profile view
  document.getElementById('profile-name').textContent = s.name;
  document.getElementById('profile-lv').textContent   = 'LV ' + s.level;
  document.getElementById('p-streak').textContent     = s.streakDays;
  document.getElementById('p-xp').textContent         = s.xp;
  document.getElementById('p-words').textContent      = s.wordsLearned;
  document.getElementById('p-lessons').textContent    = s.lessonsCompleted;
  document.getElementById('badges-sub').textContent   = `${s.lessonsCompleted} badge${s.lessonsCompleted !== 1 ? 's' : ''} unlocked`;
}

// ===========================================================
// 8. FLASHCARD ENGINE
// ===========================================================
const FC = {
  overlay:  document.getElementById('overlay-flashcard'),
  card:     document.getElementById('fc-card'),
  scene:    document.getElementById('fc-scene'),
  actions:  document.getElementById('fc-actions'),
  words:    [],
  idx:      0,
  lessonId: null,

  open(lessonId, lessonTitle, words) {
    this.lessonId = lessonId;
    this.words    = [...words];
    this.idx      = 0;
    this._correct = {};
    document.getElementById('fc-lesson-title').textContent = lessonTitle;
    document.getElementById('fc-lesson-sub').textContent   = `${words.length} words`;
    this.show();
    this.overlay.classList.add('open');
    document.getElementById('fc-close').focus();
  },

  close() {
    this.overlay.classList.remove('open');
    refreshUI();
  },

  show() {
    if (this.idx >= this.words.length) { this.finish(); return; }
    const w = this.words[this.idx];
    Progress.markWordSeen(w.id);

    // Apply tonal colour to character and pinyin
    const _T    = window.BM?.Tones;
    const _tone = _T ? _T.getTone(w.pinyin) : 0;
    const cnEl  = document.getElementById('fc-cn');
    cnEl.textContent = w.cn;
    // Apply tone class for colour (removes old ones first)
    cnEl.className = ['fc-cn', _T ? _T.getCls(_tone) : ''].join(' ').trim();
    // Pinyin with tone colour wrapping
    const pyEl = document.getElementById('fc-pinyin');
    pyEl.innerHTML = _T ? _T.wrapCompoundPinyin(w.pinyin) : w.pinyin;
    // Respect global pinyin visibility toggle
    pyEl.style.display = (_T && !_T.isPinyinVisible()) ? 'none' : '';
    document.getElementById('fc-arabic').textContent      = w.ar   ?? '';
    document.getElementById('fc-meaning').textContent     = w.type ?? '';
    document.getElementById('fc-cat-label').textContent   = w.category;
    document.getElementById('fc-counter').textContent = `${this.idx + 1} / ${this.words.length}`;

    const pct = Math.round((this.idx / this.words.length) * 100);
    document.getElementById('fc-progress-bar').style.width = pct + '%';

    // Reset card to front
    this.card.classList.remove('flipped');
    this.actions.classList.add('fc-hidden');
    this.scene.setAttribute('aria-label', 'Tap to reveal');
  },

  flip() {
    if (this.card.classList.contains('flipped')) return;
    this.card.classList.add('flipped');
    this.actions.classList.remove('fc-hidden');
    if (navigator.vibrate) navigator.vibrate(8);
  },

  answer(knew) {
    const w = this.words[this.idx];
    this._correct = this._correct ?? {};
    if (knew) {
      this._correct[this.idx] = true;
      const { xpEarned, mastered } = Progress.markWordCorrect(w.id);
      if (mastered) toast(`🌟 أتقنت: ${w.cn}! +${xpEarned} XP`);
    } else {
      this._correct[this.idx] = false;
      Progress.markWordIncorrect(w.id);
      // Move the word to the back of the queue to revisit
      this.words.push(w);
    }
    this.idx++;
    setTimeout(() => this.show(), 180);
  },

  finish() {
    // XP = 10 per correct self-assessment + 50 lesson-completion bonus (if first time)
    const correctCount = this.words.filter((_, i) => this._correct?.[i]).length;
    const baseXP       = Math.max(correctCount * 10, this.words.length * 5); // floor: 5 per card seen
    const { xpEarned: bonusXP } = Progress.completeLesson(this.lessonId);
    const xpEarned = baseXP + (bonusXP ?? 0);
    this.close();
    showResults({
      type:       'lesson',
      title:      '🎉 أتممت الدرس!',
      score:      this.words.length,
      total:      this.words.length,
      xpEarned,
      timeSec:    0,
      streakDays: Progress.getStats().streakDays,
    });
  },
};

document.getElementById('fc-scene').addEventListener('click',    () => FC.flip());
document.getElementById('fc-scene').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') FC.flip(); });
document.getElementById('fc-wrong').addEventListener('click',    () => FC.answer(false));
document.getElementById('fc-right').addEventListener('click',    () => FC.answer(true));
document.getElementById('fc-close').addEventListener('click',    () => FC.close());

// ===========================================================
// 9. QUIZ / TEST ENGINE
// ===========================================================
const Quiz = {
  overlay:   document.getElementById('overlay-quiz'),
  questions: [],
  idx:       0,
  score:     0,
  startTime: 0,
  answers:   [],
  timer:     null,
  timerSec:  30,
  timeLeft:  30,

  async open(questionCount = 40) {
    toast('⏳ جارٍ تحميل الأسئلة…');
    this.questions = await Data.getTestQuestions(questionCount);
    this._start();
  },

  /** Open quiz with pre-built questions array (grammar, story, custom). */
  openWithQuestions(questions, title = 'اختبار', onFinish = null) {
    this.questions = questions;
    this._onFinish = onFinish;
    this._title    = title;
    this._start();
  },

  _start() {
    this.idx       = 0;
    this.score     = 0;
    this.answers   = [];
    this.startTime = Date.now();
    this.overlay.classList.add('open');
    document.getElementById('quiz-close').focus();
    this.showQuestion();
  },

  close(save = false) {
    clearInterval(this.timer);
    this.overlay.classList.remove('open');
    if (save && this.idx > 0) this._savePartial();
    refreshUI();
  },

  _savePartial() {
    Progress.saveTestAttempt({
      score:   this.score,
      total:   this.idx,
      timeSec: Math.round((Date.now() - this.startTime) / 1000),
      answers: this.answers,
    });
  },

  showQuestion() {
    if (this.idx >= this.questions.length) { this.finish(); return; }
    const q = this.questions[this.idx];

    document.getElementById('quiz-counter').textContent   = `سؤال ${this.idx + 1} من ${this.questions.length}`;
    document.getElementById('quiz-score-live').textContent = `النتيجة: ${this.score}`;
    document.getElementById('quiz-cn').textContent     = q.cn;
    document.getElementById('quiz-pinyin').textContent = q.pinyin;
    // Dynamic prompt: Arabic for vocab questions, specific text for grammar/custom
    const promptEl = document.getElementById('quiz-prompt');
    if (promptEl) {
      if (q.question && q.cn === '') {
        promptEl.textContent = q.question; // grammar quiz uses q.question directly
      } else {
        promptEl.textContent = q.prompt ?? 'ماذا تعني هذه الكلمة؟'; // Arabic default
      }
    }

    const LETTERS = ['A','B','C','D'];
    const container = document.getElementById('quiz-options');
    container.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-opt rip';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML = `<span class="opt-letter">${LETTERS[i]}</span>${opt}`;
      btn.addEventListener('click', () => this.pick(btn, opt, q));
      container.appendChild(btn);
    });

    // Timer bar
    this.timeLeft = this.timerSec;
    clearInterval(this.timer);
    const bar = document.getElementById('quiz-timer-bar');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    bar.classList.remove('warn');

    requestAnimationFrame(() => {
      bar.style.transition = `width ${this.timerSec}s linear`;
      bar.style.width = '0%';
    });

    this.timer = setInterval(() => {
      this.timeLeft--;
      if (this.timeLeft <= 8) bar.classList.add('warn');
      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this._markAllDisabled();
        this._highlightCorrect(q.answer);
        setTimeout(() => { this.idx++; this.showQuestion(); }, 1200);
      }
    }, 1000);
  },

  pick(btn, chosen, q) {
    clearInterval(this.timer);
    this._markAllDisabled();

    const correct = chosen === q.answer;
    btn.classList.add(correct ? 'correct' : 'wrong');
    if (!correct) this._highlightCorrect(q.answer);
    if (navigator.vibrate) navigator.vibrate(correct ? [20] : [40, 30, 40]);

    this.answers.push({ wordId: q.id, correct });
    if (correct) this.score++;

    document.getElementById('quiz-score-live').textContent = `النتيجة: ${this.score}`;
    setTimeout(() => { this.idx++; this.showQuestion(); }, 900);
  },

  _markAllDisabled() {
    document.querySelectorAll('.quiz-opt').forEach(b => { b.disabled = true; });
  },

  _highlightCorrect(answer) {
    document.querySelectorAll('.quiz-opt').forEach(b => {
      if (b.textContent.trim().includes(answer)) b.classList.add('highlight');
    });
  },

  finish() {
    clearInterval(this.timer);
    const timeSec = Math.round((Date.now() - this.startTime) / 1000);

    // If a custom onFinish callback was set (grammar/story quiz), call it first
    if (typeof this._onFinish === 'function') {
      this._onFinish(this.score, this.questions.length);
      this._onFinish = null;
    }

    const { xpEarned, passed } = Progress.saveTestAttempt({
      score:   this.score,
      total:   this.questions.length,
      timeSec,
      answers: this.answers,
    });
    this.overlay.classList.remove('open');
    showResults({
      type:       'test',
      title:      passed ? `${this._title ?? 'الاختبار'} ناجح! 🎉` : 'واصل التدريب! 💪',
      score:      this.score,
      total:      this.questions.length,
      xpEarned,
      timeSec,
      streakDays: Progress.getStats().streakDays,
    });
    this._title = null;
  },
};

document.getElementById('quiz-close').addEventListener('click', () => Quiz.close(true));

// ===========================================================
// 10. RESULTS OVERLAY
// ===========================================================
let _lastResultRetryAction = null;

function showResults({ type, title, score, total, xpEarned, timeSec, streakDays }) {
  const overlay   = document.getElementById('overlay-results');
  // Sanitise all values — prevent NaN from appearing in the UI ever
  const safeScore  = Number.isFinite(+score)    ? +score    : 0;
  const safeTotal  = Number.isFinite(+total) && +total > 0 ? +total : 1;
  const safeXP     = Number.isFinite(+xpEarned) ? Math.max(0, +xpEarned) : 0;
  const safeTime   = Number.isFinite(+timeSec)  ? +timeSec  : 0;
  const safeStreak = Number.isFinite(+streakDays) ? +streakDays : 0;
  const pct        = Math.round((safeScore / safeTotal) * 100);
  const passed     = pct >= 60;
  const medals     = pct >= 90 ? '🏆' : pct >= 60 ? '🥇' : '📚';
  const RING_CIRCUM = 345.4; // 2π × 55

  document.getElementById('results-medal').textContent    = medals;
  document.getElementById('results-title').textContent    = 'النتائج';
  document.getElementById('results-headline').textContent = title;
  document.getElementById('results-sub').textContent      = `${safeScore} / ${safeTotal} صحيح · دقة ${pct}%`;
  document.getElementById('xp-badge').textContent         = `⭐ +${safeXP} نقطة خبرة`;
  document.getElementById('results-score').textContent    = safeScore;
  document.getElementById('results-total').textContent    = `/ ${safeTotal}`;
  document.getElementById('res-pct').textContent          = pct + '%';
  document.getElementById('res-time').textContent         = safeTime > 0 ? safeTime + 'ث' : '—';
  document.getElementById('res-streak').textContent       = safeStreak;

  const ring = document.getElementById('score-ring');
  ring.classList.toggle('pass', passed);
  ring.style.strokeDashoffset = RING_CIRCUM; // reset
  overlay.classList.add('open');

  // Animate the ring after the overlay opens
  setTimeout(() => {
    ring.style.strokeDashoffset = RING_CIRCUM * (1 - pct / 100);
  }, 200);

  refreshUI();

  _lastResultRetryAction = type;
}

document.getElementById('results-retry').addEventListener('click', () => {
  document.getElementById('overlay-results').classList.remove('open');
  if (_lastResultRetryAction === 'test') {
    setTimeout(() => Quiz.open(40), 200);
  } else if (_lastResultRetryAction === 'lesson') {
    // Re-open the lesson detail for flashcards
    if (LessonDetail.lessonId) setTimeout(() => openLesson(LessonDetail.lessonId), 200);
  }
});
document.getElementById('results-close').addEventListener('click', () => {
  document.getElementById('overlay-results').classList.remove('open');
  refreshUI();
});
document.getElementById('results-home').addEventListener('click', () => {
  document.getElementById('overlay-results').classList.remove('open');
  navigateTo('home');
  refreshUI();
});

// ===========================================================
// 11. LESSON ENGINE — card clicks, lesson detail, all 15 topics
// ===========================================================

// Map lesson number → category filter for vocab.json
// (covers all 15 topics defined in lessons.json TOPICS)
const LESSON_CATEGORY_MAP = {
  1:  'expressions',   // التحيات
  2:  'nouns',         // الأسرة  (family nouns from lesson 2)
  3:  'numbers',       // الأرقام
  4:  'nouns',         // اليوم الدراسي
  5:  'adjectives',    // الأوصاف
  6:  'places',        // الأماكن
  7:  'places',        // المدينة
  8:  'nouns',         // الطعام
  9:  'verbs',         // الأفعال الشائعة
  10: 'verbs',         // التسوق
  11: 'particles',     // الوقت والتاريخ
  12: 'adverbs',       // الطقس
  13: 'nouns',         // الهوايات
  14: 'verbs',         // الصحة
  15: 'other',         // مراجعة شاملة
};

// ── LESSON_PLAN: derived from lessons.json + vocab.json ──────
// 15 lessons · 500 words total · auto-chunked at 15 words/part
// Generated from uploaded JSON — DO NOT edit manually.
const LESSON_PLAN = [
  {"n":1,"h":"你好","t":"التحيات والتعارف","s":"Greetings & Introductions","tags":["تحية","تعارف","ضمائر","أدوات"],"total":85,"parts":[{"part":1,"of":6,"start":0,"end":15,"count":15},{"part":2,"of":6,"start":15,"end":30,"count":15},{"part":3,"of":6,"start":30,"end":45,"count":15},{"part":4,"of":6,"start":45,"end":60,"count":15},{"part":5,"of":6,"start":60,"end":75,"count":15},{"part":6,"of":6,"start":75,"end":85,"count":10}]},
  {"n":2,"h":"家人","t":"الأسرة والمنزل","s":"Family & Home","tags":["عائلة","منزل","أفراد"],"total":36,"parts":[{"part":1,"of":3,"start":0,"end":15,"count":15},{"part":2,"of":3,"start":15,"end":30,"count":15},{"part":3,"of":3,"start":30,"end":36,"count":6}]},
  {"n":3,"h":"数字","t":"الأرقام والكميات","s":"Numbers & Quantities","tags":["أرقام","وحدات عد","ترتيب"],"total":26,"parts":[{"part":1,"of":2,"start":0,"end":15,"count":15},{"part":2,"of":2,"start":15,"end":26,"count":11}]},
  {"n":4,"h":"时间","t":"الوقت والجدول","s":"Time & Schedule","tags":["وقت","تاريخ","مواعيد"],"total":46,"parts":[{"part":1,"of":4,"start":0,"end":15,"count":15},{"part":2,"of":4,"start":15,"end":30,"count":15},{"part":3,"of":4,"start":30,"end":45,"count":15},{"part":4,"of":4,"start":45,"end":46,"count":1}]},
  {"n":5,"h":"天气","t":"الطقس والطبيعة","s":"Weather & Nature","tags":["طقس","فصول","طبيعة"],"total":9,"parts":[{"part":1,"of":1,"start":0,"end":9,"count":9}]},
  {"n":6,"h":"外表","t":"الألوان والمظهر","s":"Colors & Appearance","tags":["ألوان","وصف","صفات"],"total":15,"parts":[{"part":1,"of":1,"start":0,"end":15,"count":15}]},
  {"n":7,"h":"吃饭","t":"الطعام والشراب","s":"Food & Drink","tags":["طعام","شراب","مطعم"],"total":23,"parts":[{"part":1,"of":2,"start":0,"end":15,"count":15},{"part":2,"of":2,"start":15,"end":23,"count":8}]},
  {"n":8,"h":"购物","t":"التسوق والمال","s":"Shopping & Money","tags":["تسوق","عملة","أسعار"],"total":19,"parts":[{"part":1,"of":2,"start":0,"end":15,"count":15},{"part":2,"of":2,"start":15,"end":19,"count":4}]},
  {"n":9,"h":"方向","t":"الاتجاهات والمكان","s":"Directions & Location","tags":["اتجاهات","مواقع","مكان"],"total":53,"parts":[{"part":1,"of":4,"start":0,"end":15,"count":15},{"part":2,"of":4,"start":15,"end":30,"count":15},{"part":3,"of":4,"start":30,"end":45,"count":15},{"part":4,"of":4,"start":45,"end":53,"count":8}]},
  {"n":10,"h":"交通","t":"المواصلات والسفر","s":"Transport & Travel","tags":["مواصلات","سفر","محطات"],"total":38,"parts":[{"part":1,"of":3,"start":0,"end":15,"count":15},{"part":2,"of":3,"start":15,"end":30,"count":15},{"part":3,"of":3,"start":30,"end":38,"count":8}]},
  {"n":11,"h":"学习","t":"التعليم والتعلم","s":"Education & Learning","tags":["مدرسة","دراسة","مهارات"],"total":59,"parts":[{"part":1,"of":4,"start":0,"end":15,"count":15},{"part":2,"of":4,"start":15,"end":30,"count":15},{"part":3,"of":4,"start":30,"end":45,"count":15},{"part":4,"of":4,"start":45,"end":59,"count":14}]},
  {"n":12,"h":"工作","t":"العمل والمهن","s":"Work & Occupations","tags":["مهن","عمل","مكان عمل"],"total":29,"parts":[{"part":1,"of":2,"start":0,"end":15,"count":15},{"part":2,"of":2,"start":15,"end":29,"count":14}]},
  {"n":13,"h":"爱好","t":"الهوايات والترفيه","s":"Hobbies & Leisure","tags":["هوايات","رياضة","فن"],"total":21,"parts":[{"part":1,"of":2,"start":0,"end":15,"count":15},{"part":2,"of":2,"start":15,"end":21,"count":6}]},
  {"n":14,"h":"健康","t":"الصحة والجسم","s":"Health & Body","tags":["صحة","جسم","مرض"],"total":17,"parts":[{"part":1,"of":2,"start":0,"end":15,"count":15},{"part":2,"of":2,"start":15,"end":17,"count":2}]},
  {"n":15,"h":"情感","t":"العواطف والآراء","s":"Emotions & Opinions","tags":["مشاعر","آراء","تعبير"],"total":24,"parts":[{"part":1,"of":2,"start":0,"end":15,"count":15},{"part":2,"of":2,"start":15,"end":24,"count":9}]}
];

// Quick lookup maps derived from LESSON_PLAN
const LESSON_TITLES = Object.fromEntries(LESSON_PLAN.map(l => [l.n, l.t]));
const LESSON_H      = Object.fromEntries(LESSON_PLAN.map(l => [l.n, l.h]));
const TOTAL_VOCAB   = 500; // derived from vocab.json

const LESSON_ICONS = {
  1:'👋',2:'👨‍👩‍👧',3:'🔢',4:'⏰',5:'🌤️',6:'🎨',7:'🍜',
  8:'🛍️',9:'🗺️',10:'🚌',11:'🎓',12:'💼',13:'🎮',14:'💊',15:'💙',
};

// Grammar rule id N maps to lesson N (both 1-indexed, 15 rules, 15 lessons)
const GRAMMAR_FOR_LESSON = {
  1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,11:11,12:12,13:13,14:14,15:15
};

// ── Lesson Detail Overlay ──────────────────────────────────

const LessonDetail = {
  overlay:    document.getElementById('overlay-lesson-detail'),
  lessonId:   null,

  currentPart: 1,

  async open(lessonId, partNumber) {
    this.lessonId    = lessonId;
    const plan       = LESSON_PLAN.find(l => l.n === lessonId);
    const totalParts = plan?.parts?.length ?? 1;
    this.currentPart = Math.max(1, Math.min(partNumber ?? 1, totalParts));

    this.overlay.classList.add('open');
    document.getElementById('ld-close').focus();

    // Title: real Arabic + 汉字 from LESSON_PLAN (lessons.json)
    const titleText = plan
      ? `${plan.h}  ${plan.t}`
      : (LESSON_TITLES[lessonId] ?? `Lesson ${lessonId}`);
    document.getElementById('ld-lesson-title').textContent = titleText;

    // Render the part-navigator strip if this lesson is chunked
    this._renderPartNav(plan, this.currentPart);

    // Load all three panels in parallel
    await Promise.all([
      this.renderVocab(lessonId, this.currentPart),
      this.renderDialogue(lessonId),
      this.renderSentences(lessonId),
    ]);

    const wordCount = document.querySelectorAll('#ld-vocab-grid .ld-word-card').length;
    const sentCount = document.querySelectorAll('#ld-sentence-list .ld-sent').length;
    const partLabel = totalParts > 1 ? ` · الجزء ${this.currentPart}/${totalParts}` : '';
    document.getElementById('ld-lesson-sub').textContent =
      `${wordCount} كلمة${partLabel} · ${sentCount} جملة`;

    Progress.updateVocabSeen?.(lessonId, wordCount);
  },

  /** Builds the part-number pill strip above vocab, or removes it for single-part lessons. */
  _renderPartNav(plan, currentPart) {
    document.getElementById('ld-part-nav')?.remove();
    if (!plan || plan.parts.length <= 1) return;

    const nav = document.createElement('div');
    nav.id = 'ld-part-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'اختر الجزء');
    nav.style.cssText =
      'display:flex;gap:6px;padding:10px 16px 2px;flex-wrap:wrap;flex-shrink:0;' +
      'border-bottom:1px solid var(--frost-border);margin-bottom:0;background:var(--bg-surface)';

    const self = this;
    plan.parts.forEach(p => {
      const btn   = document.createElement('button');
      const active = p.part === currentPart;
      btn.textContent = `${p.part}`;
      btn.title = `الجزء ${p.part}: ${p.count} كلمة`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      Object.assign(btn.style, {
        padding: '5px 13px', borderRadius: '20px', fontSize: '12px',
        fontWeight: '700', cursor: 'pointer', transition: 'all 0.15s ease',
        background:  active ? 'rgba(30,144,255,0.18)' : 'var(--bg-elevated)',
        border:      `1px solid ${active ? 'var(--blue-400)' : 'var(--frost-border)'}`,
        color:       active ? 'var(--accent)' : 'var(--text-3)',
      });
      btn.addEventListener('click', () => {
        self.overlay.classList.remove('open');
        setTimeout(() => self.open(plan.n, p.part), 60);
      });
      nav.appendChild(btn);
    });

    const tabBar = this.overlay.querySelector('.ld-tab-bar');
    if (tabBar) tabBar.after(nav);
  },

  close() {
    this.overlay.classList.remove('open');
    // Reset tabs to Vocab
    document.querySelectorAll('.ld-tab').forEach(t => t.classList.toggle('active', t.dataset.ldTab === 'vocab'));
    document.querySelectorAll('.ld-panel').forEach(p => p.classList.toggle('active', p.id === 'ld-panel-vocab'));
  },

  async renderVocab(lessonId, partNumber) {
    const grid = document.getElementById('ld-vocab-grid');

    // Show spinner immediately — never leave grid blank during fetch
    grid.innerHTML = Array(4).fill(
      '<div class="ld-word-card" style="background:var(--frost-dim);border-color:transparent;animation:skeleton-pulse 1.2s ease-in-out infinite"></div>'
    ).join('');

    // Always fetch via DataManager — uses KG cache (O(1)) or network fetch.
    // getWordsForLesson() is guaranteed to return an Array by data.js v3.0.
    let allWords;
    try {
      allWords = await Data.getWordsForLesson(lessonId);
    } catch (e) {
      console.error('[ui] renderVocab fetch failed:', e);
      allWords = [];
    }

    if (!Array.isArray(allWords) || !allWords.length) {
      grid.innerHTML =
        '<p style="color:var(--text-3);font-size:13px;padding:14px;grid-column:1/-1">' +
        'لا توجد مفردات لهذا الدرس — تحقق من اتصال الإنترنت أو ملفات JSON. 📁</p>';
      return;
    }

    // Apply chunk slice from LESSON_PLAN
    const plan     = LESSON_PLAN.find(l => l.n === lessonId);
    const part     = plan?.parts?.find(p => p.part === (partNumber ?? 1));
    const rawSlice = part ? allWords.slice(part.start, part.end) : allWords;

    // ── Sort by word type for pedagogical grouping (NOT alphabetically) ──
    const TYPE_ORDER = {
      'تحية':10,'ضمير':20,'اسم':30,'فعل':40,'صفة':50,
      'ظرف':60,'رقم':70,'وحدة عد':80,'أداة':90,'حرف جر':100,
      'فعل مساعد':110,'لاحقة':120,'حرف':130,
    };
    const words = [...rawSlice].sort((a, b) => {
      const oa = TYPE_ORDER[a.type] ?? 999;
      const ob = TYPE_ORDER[b.type] ?? 999;
      return oa !== ob ? oa - ob : a.pinyin.localeCompare(b.pinyin);
    });

    // "Show All" toggle banner (only for chunked lessons)
    const showAllBanner = (plan?.parts?.length ?? 1) > 1 ? `
      <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;
        padding:8px 12px;background:rgba(100,181,246,0.07);border:1px solid var(--frost-border);
        border-radius:var(--r-sm);margin-bottom:4px;font-size:12px;color:var(--text-3)">
        <span>عرض: الجزء ${partNumber ?? 1} — ${words.length} كلمة</span>
        <button id="btn-show-all-vocab" style="font-size:11px;font-weight:700;color:var(--accent);
          background:none;border:none;cursor:pointer;padding:2px 6px">
          عرض الكل (${allWords.length}) ›
        </button>
      </div>` : '';

    const TYPE_LABELS = {
      'تحية':'تحيات 👋','ضمير':'ضمائر 🗣️','اسم':'أسماء 📦','فعل':'أفعال ⚡',
      'صفة':'صفات ✨','ظرف':'ظروف 🔗','رقم':'أرقام 🔢','وحدة عد':'وحدات عد 📏',
      'أداة':'أدوات 🔧','حرف جر':'حروف جر 📍','فعل مساعد':'أفعال مساعدة 🤝',
    };
    const renderWords = (list) => {
      let lastType = null;
      let cardsHtml = '';
      list.forEach(w => {
        if (w.type !== lastType) {
          const label = TYPE_LABELS[w.type] ?? w.type;
          cardsHtml += `<div class="ld-type-header" style="grid-column:1/-1">${label}</div>`;
          lastType = w.type;
        }
        cardsHtml += `
        <div class="ld-word-card rip" data-word-cn="${w.cn}">
          <div class="ld-word-cn">${w.cn}</div>
          <div class="ld-word-py">${w.pinyin}</div>
          <div class="ld-word-ar">${w.ar}</div>
          <span class="ld-word-type">${w.type}</span>
        </div>`;
      });
      grid.innerHTML = showAllBanner + cardsHtml;

      // Tap → single-word flashcard
      grid.querySelectorAll('.ld-word-card').forEach(card => {
        card.addEventListener('click', () => {
          const w = list.find(x => x.cn === card.dataset.wordCn);
          if (w) { Progress.markWordSeen?.(w.id); FC.open(lessonId, w.cn, [w]); }
        });
      });

      // Wire "Show All" button if present
      document.getElementById('btn-show-all-vocab')?.addEventListener('click', () => {
        renderWords(allWords);
      });
    };

    renderWords(words);
  },

  async renderDialogue(lessonId) {
    const container = document.getElementById('ld-dialogue-container');
    container.innerHTML = '<div class="skeleton" style="height:60px"></div>';

    const dlg = KG?.dialogues?.[lessonId] ?? await Data.getDialogueForLesson(lessonId);
    if (!dlg) {
      container.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:14px">لا يوجد حوار لهذا الدرس بعد. 💬</p>';
      return;
    }

    const speakers = dlg.speakers ?? ['A','B'];
    container.innerHTML = `
      <div class="ld-dialogue-title">${dlg.title ?? 'Dialogue'}</div>
      <div class="ld-dialogue-lines">
        ${(dlg.lines ?? []).map(line => `
          <div class="ld-line sp-${line.sp}">
            <div class="ld-speaker">${speakers[line.sp] ?? 'Speaker'}</div>
            <div class="ld-line-body">
              <div class="ld-line-zh">${line.zh}</div>
              <div class="ld-line-py bm-pinyin">${line.py}</div>
              <div class="ld-line-ar">${line.ar}</div>
            </div>
            <button class="tts-btn rip" data-tts="${line.zh}" title="استمع">🔊</button>
          </div>`).join('')}
      </div>`;
    container.querySelectorAll('.tts-btn').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        _speakZh(btn.dataset.tts, btn);
      });
    });
    Progress.markDialogueRead?.(lessonId);
  },

  async renderSentences(lessonId) {
    const list = document.getElementById('ld-sentence-list');
    list.innerHTML = '<div class="skeleton" style="height:60px"></div>'.repeat(3);

    const sents = KG?.sentences?.[lessonId] ?? await Data.getSentencesForLesson(lessonId);
    if (!sents.length) {
      list.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:14px">لا توجد جمل لهذا الدرس بعد. 🗣️</p>';
      return;
    }
    list.innerHTML = sents.map(s => `
      <div class="ld-sent">
        <div class="ld-sent-top">
          <div class="ld-sent-col">
            <div class="ld-sent-zh">${s.zh}</div>
            <div class="ld-sent-py bm-pinyin">${s.pinyin}</div>
            <div class="ld-sent-ar">${s.ar}</div>
            ${s.tip ? `<div class="ld-sent-tip">${s.tip}</div>` : ''}
          </div>
          <button class="tts-btn rip" data-tts="${s.zh}" title="استمع">🔊</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('.tts-btn').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        _speakZh(btn.dataset.tts, btn);
      });
    });
    Progress.updateSentencesDone?.(lessonId, sents.length);
  },
};

// Tab switching inside lesson detail overlay
document.querySelectorAll('.ld-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.ldTab;
    document.querySelectorAll('.ld-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.ld-panel').forEach(p =>
      p.classList.toggle('active', p.id === `ld-panel-${id}`));
  });
});
document.getElementById('ld-close').addEventListener('click', () => LessonDetail.close());
document.getElementById('ld-flashcard-btn').addEventListener('click', () => {
  const lid  = LessonDetail.lessonId;
  const part = LessonDetail.currentPart ?? 1;
  LessonDetail.close();
  if (lid) openFlashcardsForLesson(lid, part);
});

// ── Lesson Intro — shows curriculum theory before lesson detail ─
async function _showLessonIntro(lessonId, onContinue) {
  const CE = window.BM?.Curriculum;
  if (!CE) { onContinue(); return; }
  const cur = await CE.loadCurriculum().catch(() => null);
  if (!cur) { onContinue(); return; }
  let introContent = null;
  for (const unit of cur.units) {
    for (const lesson of unit.lessons) {
      const gi = cur.units.slice(0, cur.units.indexOf(unit))
        .reduce((s, u) => s + u.lessons.length, 0) + unit.lessons.indexOf(lesson);
      if (gi + 1 === lessonId) {
        const intro = lesson.steps.find(s => s.type === 'intro');
        if (intro) introContent = {
          tipTitle: intro.title_ar ?? 'مقدمة الدرس',
          title:    lesson.title_ar,
          hook:     unit.hook_ar ?? '',
          body:     intro.body_ar ?? '',
        };
        break;
      }
    }
    if (introContent) break;
  }
  if (!introContent) { onContinue(); return; }
  const ov = document.getElementById('overlay-lesson-intro');
  if (!ov) { onContinue(); return; }
  document.getElementById('li-title').textContent = introContent.tipTitle;
  document.getElementById('li-sub').textContent   = introContent.title;
  const md = t => t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/
/g,'<br>');
  document.getElementById('li-body').innerHTML = `
    <div class="li-hook">${introContent.hook}</div>
    <div class="li-body-text">${md(introContent.body)}</div>`;
  const cb = document.getElementById('li-close');
  const sb = document.getElementById('li-start-btn');
  [cb, sb].forEach(b => {
    const n = b.cloneNode(true); b.replaceWith(n);
    n.addEventListener('pointerdown', e => {
      e.preventDefault(); ov.classList.remove('open'); onContinue();
    });
  });
  ov.classList.add('open');
}

// ── openLesson: shows intro then Lesson Detail ────────────────

async function openLesson(lessonId) {
  if (!Array.isArray(ALL_WORDS) || ALL_WORDS.length === 0) {
    toast('⏳ يا حسام، جارٍ تحميل الكلمات… Loading words…');
    try {
      const fetched = await Data.getWords();
      ALL_WORDS = Array.isArray(fetched) && fetched.length > 0
        ? fetched : (Data.getFallbackWords?.() ?? []);
    } catch (_) { ALL_WORDS = Data.getFallbackWords?.() ?? []; }
  }
  if (!Array.isArray(ALL_WORDS)) { ALL_WORDS = []; }

  // Show curriculum intro if available, then open lesson detail
  _showLessonIntro(lessonId, () => LessonDetail.open(lessonId, 1));
}

// Wire static lesson cards — pointerdown for instant mobile response
function _wireTap(el, handler) {
  let _tapped = false;
  el.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    e.preventDefault();
    _tapped = true;
    handler();
  });
  el.addEventListener('click', e => {
    if (_tapped) { _tapped = false; return; }   // already handled
    handler();
  });
}

document.querySelectorAll('.lesson-card[data-lesson-id]').forEach(card => {
  _wireTap(card, () => openLesson(+card.dataset.lessonId));
});
document.querySelectorAll('.path-node[data-lesson-id]').forEach(node => {
  _wireTap(node, () => openLesson(+node.dataset.lessonId));
});

// FC.open standalone (called from LessonDetail "▶ Cards")
// Wraps the existing FC engine with KG-aware word loading
async function openFlashcardsForLesson(lessonId, partNumber) {
  // Get all words for the lesson
  const allWords = (KG?.vocab?.byLesson?.[lessonId] ?? []).length > 0
    ? KG.vocab.byLesson[lessonId]
    : (Array.isArray(ALL_WORDS) ? ALL_WORDS.filter(w => w.lessonId === lessonId) : []);
  if (!allWords.length) { toast('⚠️ لا توجد كلمات لهذا الدرس'); return; }

  // Apply chunk slice if a part is specified
  const plan  = LESSON_PLAN.find(l => l.n === lessonId);
  const part  = plan?.parts?.find(p => p.part === (partNumber ?? LessonDetail.currentPart ?? 1));
  const words = part ? allWords.slice(part.start, part.end) : allWords;

  const lesson = LESSON_PLAN.find(l => l.n === lessonId);
  const partSuffix = lesson?.parts?.length > 1 ? ` — الجزء ${part?.part ?? 1}` : '';
  const title = (LESSON_TITLES[lessonId] ?? `Lesson ${lessonId}`) + partSuffix;
  FC.open(lessonId, title, words);
}

/**
 * openLessonTest — launches a lesson-specific MCQ quiz.
 * Generates questions dynamically from vocab.json filtered by lessonId.
 * The "▶ ابدأ" button on each lesson card calls this.
 */
async function openLessonTest(lessonId) {
  toast('⏳ جارٍ تحضير الأسئلة…');

  // Fetch all words for this lesson (uses KG cache or network)
  const words = await Data.getWordsForLesson(lessonId);
  if (!words || words.length < 2) {
    toast('⚠️ لا تتوفر مفردات كافية لهذا الدرس بعد');
    return;
  }

  // Build MCQ questions from the lesson's own vocabulary
  // Distractors come from the same lesson first, then other lessons
  const otherPool  = Array.isArray(ALL_WORDS) ? ALL_WORDS.filter(w => w.lessonId !== lessonId) : [];
  const questions  = Data.shuffle([...words]).map(word => {
    const sameLesson     = words.filter(w => w.id !== word.id);
    const crossLesson    = Data.shuffle([...otherPool]);
    const distractorPool = [...Data.shuffle(sameLesson), ...crossLesson];
    const distractors    = distractorPool.slice(0, 3).map(w => w.ar);
    const options        = Data.shuffle([word.ar, ...distractors]);
    return {
      id:          word.id,
      cn:          word.cn,
      pinyin:      word.pinyin,
      prompt:      'ماذا تعني هذه الكلمة؟',
      question:    'ماذا تعني هذه الكلمة؟',
      options,
      answer:      word.ar,
      answerIdx:   options.indexOf(word.ar),
      explanation: `${word.cn} (${word.pinyin}) = ${word.ar}`,
      category:    'lesson',
    };
  });

  const lesson = LESSON_PLAN.find(l => l.n === lessonId);
  const title  = lesson ? `${lesson.h} — ${lesson.t}` : `Lesson ${lessonId}`;

  Quiz.openWithQuestions(questions, title, (score, total) => {
    // Save as a test attempt and complete the lesson if passed
    if (score / total >= 0.6) {
      Progress.completeLesson(lessonId);
      renderLessonGrid();   // refresh card badges
      renderHomePath();     // update path node
    }
  });
}

// Test CTA
document.getElementById('test-cta').addEventListener('click', async () => {
  if (!Array.isArray(ALL_WORDS) || ALL_WORDS.length === 0) {
    try {
      const f = await Data.getWords();
      ALL_WORDS = Array.isArray(f) && f.length ? f : (Data.getFallbackWords?.() ?? []);
    } catch (_) { ALL_WORDS = Data.getFallbackWords?.() ?? []; }
  }
  Quiz.open(Math.min(ALL_WORDS.length, 40));
});

// Daily challenge → 10-question quiz
document.getElementById('daily-banner').addEventListener('click', async () => {
  if (Progress.isDailyChallengeComplete()) {
    toast('✅ تم التحدي اليومي! أحسنت يا حسام 🏆'); return;
  }

  // Load all words if not already available
  if (!Array.isArray(ALL_WORDS) || ALL_WORDS.length === 0) {
    try {
      const f = await Data.getWords();
      ALL_WORDS = Array.isArray(f) && f.length ? f : (Data.getFallbackWords?.() ?? []);
    } catch (_) { ALL_WORDS = Data.getFallbackWords?.() ?? []; }
  }

  // Only quiz on words the student has ALREADY studied (seenWords)
  // This prevents showing unknown words in the daily challenge
  const progress   = Progress.getProgress?.() ?? {};
  const seenIds    = new Set(progress.seenWords ?? []);
  const studiedWords = ALL_WORDS.filter(w => seenIds.has(w.id));

  // Need at least 4 words for MCQ options; if fewer studied, fall back to first lesson
  const pool = studiedWords.length >= 4 ? studiedWords
    : ALL_WORDS.filter(w => w.lessonId === 1); // lesson 1 as starter pool

  if (!pool.length) { toast('⚠️ ابدأ درساً أولاً لفتح التحدي اليومي!'); return; }

  // Build vocabulary MCQ questions from the pool
  const shuffled   = Data.shuffle([...pool]);
  const questions  = shuffled.slice(0, 10).map((word, i) => {
    const distractors = Data.shuffle(pool.filter(w => w.id !== word.id))
      .slice(0, 3).map(w => w.ar);
    const options = Data.shuffle([word.ar, ...distractors]);
    return {
      id:       word.id,
      cn:       word.cn,
      pinyin:   word.pinyin,
      prompt:   'ماذا تعني هذه الكلمة؟',   // Arabic localization
      question: 'ماذا تعني هذه الكلمة؟',
      options,
      answer:   word.ar,
      answerIdx: options.indexOf(word.ar),
      explanation: word.ar,
      category: 'daily',
    };
  });

  Quiz.openWithQuestions(questions, '📅 التحدي اليومي', (score, total) => {
    if (score / total >= 0.6) Progress.completeDailyChallenge?.();
  });
});

// ===========================================================
// 13A. READING CENTER — Tab Switcher
// ===========================================================
// Tabs use pointerdown for instant mobile response
document.querySelectorAll('.read-tab').forEach(tab => {
  let _tabTapped = false;
  tab.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    e.preventDefault();
    _tabTapped = true;
    const id = tab.dataset.readTab;
    // Route through switchPage for guaranteed rendering
    switchPage(id === 'grammar' ? 'grammar' : 'stories');
  });
  tab.addEventListener('click', e => {
    if (_tabTapped) { _tabTapped = false; return; }
    const id = tab.dataset.readTab;
    switchPage(id === 'grammar' ? 'grammar' : 'stories');
  });
});

// ===========================================================
// 13B. STORY READER ENGINE
// ===========================================================
const StoryReader = {
  overlay:    document.getElementById('overlay-story'),
  story:      null,
  quiz:       null,
  paragraphs: [],
  current:    0,
  quizMode:   false,
  quizIdx:    0,
  quizScore:  0,
  quizAnswers:[],

  async open(storyNumber) {
    // Load from KG or fetch
    const story = KG?.stories?.byNumber?.[storyNumber] ?? null;
    const quiz  = KG?.storyQuiz?.[storyNumber]         ?? null;
    if (!story) { toast('⚠️ Story not found'); return; }

    this.story      = story;
    this.quiz       = quiz;
    this.paragraphs = story.story ?? [];
    this.current    = 0;
    this.quizMode   = false;
    this.quizIdx    = 0;
    this.quizScore  = 0;
    this.quizAnswers = [];

    // Header
    document.getElementById('story-title').textContent     = story.title_zh;
    document.getElementById('story-level-badge').textContent = `${story.title_ar} · ${story.level}`;

    // Show quiz toggle only if quiz data exists
    const qBtn = document.getElementById('story-quiz-toggle');
    qBtn.style.display = quiz ? 'block' : 'none';

    // Build vocab chips from new_words
    this._renderVocabChips(story);

    // Render all paragraphs
    this._renderParagraphs();
    this._showReadMode();
    this.overlay.classList.add('open');
    document.getElementById('story-close').focus();

    // Mark as read in progress
    Progress.markStoryRead?.(storyNumber);
    refreshUI();
  },

  _renderVocabChips(story) {
    const bar   = document.getElementById('sr-new-words-bar');
    const chips = document.getElementById('sr-vocab-chips');
    const vocab = KG?.vocab?.all ?? [];

    // Find words mentioned in the story text
    const storyText = (story.story ?? []).map(p => p.chinese).join('');
    const matchedWords = vocab.filter(w => storyText.includes(w.cn)).slice(0, 12);

    if (!matchedWords.length) { bar.style.display = 'none'; return; }

    bar.style.display = 'block';
    chips.innerHTML = matchedWords.map(w => `
      <div class="sr-vocab-chip rip">
        <span class="svc-cn">${w.cn}</span>
        <span class="svc-py">${w.pinyin}</span>
        <span class="svc-ar">${w.ar}</span>
      </div>`).join('');
  },

  _renderParagraphs() {
    const container = document.getElementById('sr-content');
    container.innerHTML = this.paragraphs.map((p, i) => `
      <div class="sr-paragraph ${i === 0 ? 'current' : ''}" data-para="${i}">
        <button class="tts-btn sr-tts rip" data-tts="${p.chinese}" title="استمع">🔊</button>
        <div class="sr-cn">${p.chinese}</div>
        <div class="sr-py bm-pinyin">${p.pinyin}</div>
        <div class="sr-ar">${p.translation}</div>
      </div>`).join('');
    container.querySelectorAll('.tts-btn').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        _speakZh(btn.dataset.tts, btn);
      });
    });
    this._updateNav();
  },

  _updateNav() {
    const total = this.paragraphs.length;
    document.getElementById('sr-counter').textContent = `${this.current + 1}/${total}`;
    const pct = total > 1 ? Math.round(((this.current + 1) / total) * 100) : 100;
    document.getElementById('sr-progress').style.width = pct + '%';
    document.getElementById('sr-prev').disabled = this.current === 0;
    document.getElementById('sr-next').textContent =
      this.current >= total - 1 ? (this.quiz ? '📝 Take Quiz' : '✓ Done') : 'Next →';
  },

  navigate(dir) {
    const total = this.paragraphs.length;
    if (dir === 1 && this.current >= total - 1) {
      // Last paragraph — go to quiz or close
      if (this.quiz) { this._startQuiz(); return; }
      this.overlay.classList.remove('open');
      return;
    }
    const prev = this.current;
    this.current = Math.max(0, Math.min(total - 1, this.current + dir));
    const paras = document.querySelectorAll('.sr-paragraph');
    paras.forEach((p, i) => {
      p.classList.toggle('current', i === this.current);
      p.classList.toggle('done', i < this.current);
    });
    // Scroll current paragraph into view
    paras[this.current]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    this._updateNav();
  },

  _showReadMode() {
    document.getElementById('story-read-mode').style.display  = 'flex';
    document.getElementById('story-quiz-mode').style.display  = 'none';
    this.quizMode = false;
  },

  _startQuiz() {
    if (!this.quiz) return;
    this.quizIdx    = 0;
    this.quizScore  = 0;
    this.quizAnswers = [];
    document.getElementById('story-read-mode').style.display  = 'none';
    document.getElementById('story-quiz-mode').style.display  = 'flex';
    this.quizMode = true;
    this._renderQuizQuestion();
  },

  _renderQuizQuestion() {
    const questions = this.quiz.questions ?? [];
    if (this.quizIdx >= questions.length) { this._finishQuiz(); return; }
    const q     = questions[this.quizIdx];
    const total = questions.length;

    document.getElementById('sq-progress-label').textContent =
      `Question ${this.quizIdx + 1} of ${total}`;
    document.getElementById('sq-progress-bar').style.width =
      Math.round(((this.quizIdx + 1) / total) * 100) + '%';

    const body = document.getElementById('sq-body');
    body.innerHTML = '';

    // Question box
    const qBox = document.createElement('div');
    qBox.className = 'sq-question-box';
    qBox.innerHTML = `
      <div class="sq-q-zh">${q.question_zh}</div>
      <div class="sq-q-ar">${q.question_ar}</div>`;
    body.appendChild(qBox);

    // Options (type-dependent)
    const optContainer = document.createElement('div');
    optContainer.className = 'sq-options';
    body.appendChild(optContainer);

    // Explanation box (hidden until answered)
    const expEl = document.createElement('div');
    expEl.className = 'sq-exp';
    body.appendChild(expEl);

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'sq-next-btn rip';
    nextBtn.textContent = this.quizIdx < total - 1 ? 'Next Question →' : 'See Results ✓';
    nextBtn.addEventListener('click', () => { this.quizIdx++; this._renderQuizQuestion(); });
    body.appendChild(nextBtn);

    const LETTERS = ['A','B','C','D'];

    const revealAndNext = (correct, explanation) => {
      expEl.textContent = explanation ?? '';
      expEl.classList.add('show');
      nextBtn.classList.add('show');
      this.quizAnswers.push({ questionId: q.id, correct });
      if (correct) this.quizScore++;
    };

    if (q.type === 'multiple_choice') {
      (q.options ?? []).forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'sq-opt rip';
        btn.innerHTML = `<span class="sq-opt-letter">${LETTERS[i]}</span>${opt.text_ar}`;
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          optContainer.querySelectorAll('.sq-opt').forEach(b => { b.disabled = true; });
          const correct = opt.id === q.correct_answer;
          btn.classList.add(correct ? 'correct' : 'wrong');
          if (!correct) {
            optContainer.querySelectorAll('.sq-opt').forEach((b, j) => {
              if ((q.options[j])?.id === q.correct_answer) b.classList.add('reveal');
            });
          }
          revealAndNext(correct, q.explanation_ar);
        });
        optContainer.appendChild(btn);
      });

    } else if (q.type === 'true_false') {
      const row = document.createElement('div');
      row.className = 'sq-tf-row';
      ['صح ✓', 'خطأ ✗'].forEach((label, i) => {
        const answer = i === 0; // true = index 0
        const btn = document.createElement('button');
        btn.className = `sq-tf-btn rip ${i===0?'true-btn':'false-btn'}`;
        btn.textContent = label;
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          row.querySelectorAll('.sq-tf-btn').forEach(b => { b.disabled = true; });
          const correct = answer === q.correct_answer;
          btn.classList.add(correct ? 'correct' : 'wrong');
          revealAndNext(correct, q.explanation_ar);
        });
        row.appendChild(btn);
      });
      optContainer.appendChild(row);

    } else {
      // open-ended: show expected answer
      const ansEl = document.createElement('div');
      ansEl.style.cssText = 'padding:14px;background:var(--bg-elevated);border-radius:12px;' +
        'border:1px solid var(--frost-border);direction:rtl;text-align:right;';
      ansEl.innerHTML =
        `<div style="font-size:11px;color:var(--text-4);margin-bottom:4px;">الإجابة المتوقعة:</div>` +
        `<div style="font-family:\'Noto Sans SC\',sans-serif;font-size:15px;font-weight:700;color:var(--text-1)">` +
        `${q.expected_answer_zh}</div>` +
        `<div style="font-size:13px;color:var(--text-2);margin-top:3px">${q.expected_answer_ar}</div>`;
      optContainer.appendChild(ansEl);
      // open-ended: always "correct" (self-assessed)
      revealAndNext(true, q.explanation_ar);
    }
  },

  _finishQuiz() {
    const total = this.quiz.questions.length;
    const { xpEarned, passed } = Progress.saveStoryQuizAttempt?.(
      this.story.story_number, this.quizScore, total, this.quizAnswers
    ) ?? { xpEarned: 0, passed: false };

    const pct    = Math.round((this.quizScore / total) * 100);
    const medals = pct >= 80 ? '🏆' : pct >= 60 ? '🥇' : '📚';
    showResults({
      type:       'story',
      title:      passed ? `${medals} رائع يا حسام!` : `${medals} حاول مجدداً!`,
      score:      this.quizScore,
      total,
      xpEarned,
      timeSec:    0,
      streakDays: Progress.getProfile().streakDays,
    });
    this.overlay.classList.remove('open');
    refreshUI();
  },
};

// Wire Story Reader controls
document.getElementById('story-close').addEventListener('click', () => {
  document.getElementById('overlay-story').classList.remove('open');
});
document.getElementById('sr-prev').addEventListener('click',  () => StoryReader.navigate(-1));
document.getElementById('sr-next').addEventListener('click',  () => StoryReader.navigate(1));
document.getElementById('story-quiz-toggle').addEventListener('click', () => StoryReader._startQuiz());

// ===========================================================
// 13C. GRAMMAR VIEWER ENGINE
// ===========================================================
const GrammarViewer = {
  _rendered: false,

  async render() {
    // Only skip re-render if the list already has real content (not skeletons)
    const list = document.getElementById('grammar-list');
    if (this._rendered && list && list.querySelector('.grammar-card')) return;
    // (list already declared above — removed duplicate declaration)
    const grammar = KG?.grammar?.all ?? await Data.getGrammar();
    if (!Array.isArray(grammar) || !grammar.length) {
      list.innerHTML = '<p style="color:var(--text-3);padding:14px">Grammar data not loaded yet.</p>';
      return;
    }
    list.innerHTML = grammar.map(g => `
      <div class="grammar-card rip" data-gid="${g.id}">
        <div class="gc-header">
          <span class="gc-color-dot" style="background:${g.color ?? 'var(--blue-400)'}"></span>
          <span class="gc-title">${g.title}</span>
          <span class="gc-formula">${g.formula}</span>
          <span class="gc-chevron">›</span>
        </div>
        <div class="gc-body">
          <div class="gc-exp">${g.exp}</div>
          <div class="gc-rules">${(g.rules ?? []).map(r => `<div class="gc-rule">${r}</div>`).join('')}</div>
          <div class="gc-examples">${(g.ex ?? []).map(ex => `
            <div class="gc-ex">
              <div class="gc-ex-cn">${ex[0]}</div>
              <div class="gc-ex-py">${ex[1]}</div>
              <div class="gc-ex-ar">${ex[2]}</div>
            </div>`).join('')}
          </div>
          ${(g.q?.length) ? `<button class="gc-quiz-btn rip" data-gid="${g.id}">
            📝 اختبار: ${g.title}</button>` : ''}
        </div>
      </div>`).join('');

    // Expand/collapse
    list.querySelectorAll('.grammar-card').forEach(card => {
      card.querySelector('.gc-header').addEventListener('click', () => {
        card.classList.toggle('expanded');
      });
    });

    // Grammar mini-quiz buttons
    list.querySelectorAll('.gc-quiz-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const gid = +btn.dataset.gid;
        const g   = (KG?.grammar?.all ?? grammar).find(x => x.id === gid);
        if (g?.q) this._runMiniQuiz(g);
      });
    });

    this._rendered = true;
  },

  _runMiniQuiz(grammarRule) {
    const questions = grammarRule.q ?? [];
    if (!questions.length) return;
    // Reuse Quiz engine with grammar-shaped questions
    const mapped = questions.map((q, i) => ({
      id:       i + 1,
      cn:       q.zh ?? '',
      pinyin:   '',
      question: q.q,
      options:  q.opts,
      answer:   q.opts[q.a],
      answerIdx:q.a,
      explanation: q.exp ?? '',
      category: 'grammar',
      _grammarId: grammarRule.id,
    }));
    Quiz.openWithQuestions(mapped, `📐 ${grammarRule.title}`, (score, total) => {
      Progress.saveGrammarQuizAttempt?.(grammarRule.id, score, total);
    });
  },
};
const chatLog   = document.getElementById('chat-log');
const chatField = document.getElementById('chat-field');

function appendBubble(html, role) {
  const div = document.createElement('div');
  div.className = `bubble ${role}`;
  div.innerHTML = html;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function showTyping() {
  const el = document.createElement('div');
  el.className = 'typing-dots';
  el.innerHTML = '<span></span><span></span><span></span>';
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

async function sendChat() {
  const msg = chatField.value.trim();
  if (!msg) return;
  chatField.value = '';
  appendBubble(msg, 'usr');

  const shelly_status = document.getElementById('shelly-status');
  shelly_status.textContent = '● Thinking…';
  shelly_status.style.color = 'var(--gold)';

  const dots = showTyping();
  const { text, error } = await Shelly.talkToShelly(msg);
  dots.remove();

  appendBubble(text, error ? 'bot err' : 'bot');
  shelly_status.textContent = navigator.onLine ? '● Online · Powered by Gemini Flash' : '● Offline';
  shelly_status.style.color = navigator.onLine ? 'var(--jade)' : 'var(--coral)';
}

document.getElementById('chat-send').addEventListener('click', sendChat);
chatField.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// Prime Shelly with a study tip when the view is first visited
let shellyInitialised = false;
document.querySelector('[data-view="shelly"]').addEventListener('click', () => {
  if (shellyInitialised) return;
  shellyInitialised = true;
  const { text } = Shelly.getStudyTip();
  appendBubble(`مرحبا يا حسام! 🐚 I'm <strong>Shelly</strong>, your AI Mandarin tutor.<br><br>${text}`, 'bot');
});

// Connectivity indicator
window.addEventListener('offline', () => {
  toast('📡 You are offline. Shelly will use fallback responses.');
  document.getElementById('shelly-status').textContent = '● Offline';
  document.getElementById('shelly-status').style.color = 'var(--coral)';
});
window.addEventListener('online', () => {
  toast('✅ Back online!');
  document.getElementById('shelly-status').textContent = '● Online · Powered by Gemini Flash';
  document.getElementById('shelly-status').style.color = 'var(--jade)';
});

// ===========================================================
// 13. TOPIC CHIP FILTER
// Chips carry data-filter="lessonNumber" (1-15) matching
// data-tag="N" on dynamically-rendered lesson cards.
// ===========================================================
document.getElementById('topic-chips')?.addEventListener('click', e => {
  const chip = e.target.closest('.cat-chip');
  if (!chip) return;
  document.querySelectorAll('#topic-chips .cat-chip').forEach(c => c.classList.remove('on'));
  chip.classList.add('on');
  const filter = chip.dataset.filter;
  document.querySelectorAll('#lessons-grid .lesson-card').forEach(card => {
    card.style.display = (filter === 'all' || card.dataset.tag === filter) ? '' : 'none';
  });
});

// ===========================================================
// 14. PROFILE – RESET PROGRESS
// ===========================================================
// Final exam → 100-question test
document.getElementById('final-exam-row')?.addEventListener('pointerdown', e => {
  e.preventDefault();
  Data.getTestQuestions(100).then(qs => {
    if (!qs.length) { toast('⚠️ لا توجد أسئلة بعد'); return; }
    Quiz.openWithQuestions(qs, 'الاختبار النهائي HSK 1 📝');
  });
});

document.getElementById('reset-row').addEventListener('click', () => {
  if (confirm('Reset ALL progress? This cannot be undone.')) {
    Progress.__hardReset();
    Shelly.clearHistory();
    chatLog.innerHTML = '';
    shellyInitialised = false;
    refreshUI();
    toast('🔄 Progress reset.');
  }
});

// ===========================================================
// 15. SWIPE NAVIGATION — DISABLED (v1.7.0)
// Swipe removed: navigation is strictly via the bottom nav bar.
// Keyboard ArrowLeft/Right still works on desktop.
// ===========================================================

// ===========================================================
// 16. KEYBOARD NAVIGATION
// ===========================================================
document.addEventListener('keydown', e => {
  if (document.querySelector('.overlay.open')) {
    if (e.key === 'Escape') document.querySelector('.overlay.open')?.classList.remove('open');
    return;
  }
  const idx = VIEW_ORDER.indexOf(activeView);
  if (e.key === 'ArrowRight' && idx < VIEW_ORDER.length - 1) navigateTo(VIEW_ORDER[idx + 1]);
  if (e.key === 'ArrowLeft'  && idx > 0)                     navigateTo(VIEW_ORDER[idx - 1]);
});

// ===========================================================
// 17. NOTIFICATION BUTTON
// ===========================================================
document.getElementById('notif-btn').addEventListener('click', () => toast('🔔 لا توجد إشعارات جديدة'));

// ===========================================================
// 18. PWA INSTALL — BLOCKED (install via browser menu only)
// ===========================================================
// The beforeinstallprompt event is intentionally NOT handled.
// This prevents the app from showing an install banner that
// covers the navigation bar. Users can install via the browser's
// "Add to Home Screen" option in the menu.
window.addEventListener('beforeinstallprompt', e => {
  // Prevent the mini-infobar and automatic prompts completely
  e.preventDefault();
  // Do NOT store deferredInstall — we never call .prompt()
});
// Still listen for appinstalled to show a welcome toast
window.addEventListener('appinstalled', () => {
  toast('✅ تم تثبيت Blue Mandarin — أهلاً بك! ❄️');
});
console.log('PWA Prompt Blocked 🛑 | Navigation Initialized 📱');

// ===========================================================
// 19. DEEP LINK SUPPORT
// ===========================================================
(function handleDeepLink() {
  const v = new URLSearchParams(window.location.search).get('view');
  if (v && VIEW_ORDER.includes(v)) setTimeout(() => navigateTo(v), 120);
})();

// ===========================================================
// 20. PHASE 4 PREP — BM.reinit() cleanup method
//
//  Call window.BM.reinit() from the browser console (or from
//  Phase 4 code) to fully reset the app to a clean slate:
//    · Clears localStorage progress (optional — pass true)
//    · Re-initialises DataManager word cache
//    · Resets Shelly conversation history
//    · Refreshes all UI counters and the greeting
//    · Re-renders the lesson-path progress bar
// ===========================================================
window.BM = window.BM ?? {};

/**
 * Full app reinitialisation.
 * @param {boolean} [hardReset=false] – also wipe localStorage progress.
 */
window.BM.reinit = async function reinit(hardReset = false) {
  console.log('%c[BM] reinit() called — hardReset:', 'color:#64B5F6', hardReset);

  // 1. Optionally wipe stored progress
  if (hardReset && window.BM.ProgressManager?.__hardReset) {
    window.BM.ProgressManager.__hardReset();
  }

  // 2. Invalidate DataManager in-memory cache so next fetches hit network
  Data.invalidate?.();

  // 3. Reset all in-memory app state
  ALL_WORDS         = [];
  KG                = null;
  shellyInitialised = false;

  // 4. Full parallel re-fetch of all 8 datasets + rebuild KnowledgeGraph
  let allData;
  try {
    allData = await Data.prefetchAll();
    KG      = window.BM.KnowledgeGraph;
    ALL_WORDS = Array.isArray(allData.vocab) && allData.vocab.length
      ? allData.vocab : (Data.getFallbackWords?.() ?? []);
  } catch (_) {
    ALL_WORDS = Data.getFallbackWords?.() ?? [];
  }
  if (!Array.isArray(ALL_WORDS)) ALL_WORDS = [];

  // 5. Clear Shelly chat and reset history
  if (window.BM.ShellyAI?.clearHistory) window.BM.ShellyAI.clearHistory();
  if (chatLog) chatLog.innerHTML = '';

  // 6. Re-render lesson grid, home-path, and story list with fresh data
  renderLessonGrid(allData?.lessons ?? null);
  renderHomePath();
  if (allData?.stories) renderStoryList(allData.stories);

  // 7. Refresh greeting with stored profile name
  const profileName = window.BM.ProgressManager?.getProfile?.()?.name ?? 'Hossam';
  const homeNameEl  = document.getElementById('home-name');
  if (homeNameEl) homeNameEl.textContent = profileName;

  // 8. Re-render all stat counters and progress rings/bars
  refreshUI();

  // 9. Update test CTA word count
  const testMeta = document.getElementById('test-cta-meta');
  if (testMeta) testMeta.textContent = `${Math.min(ALL_WORDS.length, 40)} questions · All categories`;

  // 10. Lesson-path nodes: mark completed ones
  const completed = window.BM.ProgressManager?.getProgress?.()?.completedLessons ?? [];
  document.querySelectorAll('.path-node[data-lesson-id]').forEach(node => {
    const id = +node.dataset.lessonId;
    if (completed.includes(id)) {
      node.classList.remove('current-node', 'locked-node');
      node.classList.add('done-node');
      const lbl = node.querySelector('.node-lbl');
      if (lbl) lbl.textContent = 'Done ✓';
    }
  });

  console.log('%c[BM] ✓ reinit complete — words loaded:', 'color:#26D97F', ALL_WORDS.length);
  toast('🔄 App reloaded — مرحبًا يا حسام! ❄️');
};

// ===========================================================
// 21. LIVE-RELOAD SAFETY NET
//
//  VS Code Live Server (and similar) injects a <script> that
//  opens a WebSocket; when that socket drops it throws uncaught
//  errors unrelated to the PWA.  We absorb them here so they
//  don't pollute your console with false positives.
// ===========================================================
window.addEventListener('error', evt => {
  const msg = evt.message ?? '';
  // Absorb only the well-known Live Server / browser-sync noise
  if (
    msg.includes('Receiving end does not exist') ||
    msg.includes('tabs:outgoing.message.ready')  ||
    msg.includes('useCache')
  ) {
    // These come from browser extensions or live-reload clients,
    // NOT from Blue Mandarin code — silently swallow.
    evt.preventDefault();
  }
}, true);

window.addEventListener('unhandledrejection', evt => {
  const msg = String(evt.reason ?? '');
  if (
    msg.includes('Receiving end does not exist') ||
    msg.includes('No Listener')                  ||
    msg.includes('message channel closed')
  ) {
    evt.preventDefault();
  }
});

// ===========================================================
// 22. INITIALISATION — content-complete prefetch
// ===========================================================
async function init() {
  // 1. Render UI immediately from cached localStorage (zero-wait)
  refreshUI();

  // 2. Parallel prefetch of ALL 8 data files + KnowledgeGraph build
  let allData;
  try {
    allData = await Data.prefetchAll();
    KG      = window.BM.KnowledgeGraph;
  } catch (e) {
    console.warn('[BM] prefetchAll failed, falling back to vocab only:', e.message);
    // Vocab-only fallback so flashcards still work
    try {
      const fetched = await Data.getWords();
      ALL_WORDS = Array.isArray(fetched) && fetched.length ? fetched
                : (Data.getFallbackWords?.() ?? []);
    } catch (_) { ALL_WORDS = Data.getFallbackWords?.() ?? []; }
    if (!Array.isArray(ALL_WORDS)) ALL_WORDS = [];
    // Even on fallback, render lesson grid (uses LESSON_PLAN, needs no network)
    renderLessonGrid(null);
    renderHomePath();
    refreshUI();
    return;
  }

  // 3. Set ALL_WORDS for backwards-compat with flashcard / quiz engines
  ALL_WORDS = Array.isArray(allData.vocab) && allData.vocab.length
    ? allData.vocab
    : (Data.getFallbackWords?.() ?? []);

  // 4. Render the lesson grid dynamically from real topics
  renderLessonGrid(allData.lessons);

  // 4b. Sync home-path nodes with stored progress
  renderHomePath();

  // 5. Render the story list in the Reading Center
  //    allData.stories is the flat array built by DataManager.T.stories
  if (Array.isArray(allData.stories) && allData.stories.length) {
    renderStoryList(allData.stories);
    console.log('[BM] Stories rendered:', allData.stories.length);
  } else {
    console.warn('[BM] No stories data to render');
  }

  // 6. Grammar renders lazily when user opens the Grammar tab (avoid paint block)
  document.querySelector('[data-read-tab="grammar"]')?.addEventListener('click', () => {
    GrammarViewer.render();
  }, { once: true });

  // 7. Update test CTA word count
  const testMeta = document.getElementById('test-cta-meta');
  if (testMeta) testMeta.textContent = `${Math.min(ALL_WORDS.length, 40)} questions · All categories`;

  // 8. Final UI refresh with real stats
  refreshUI();

  // 9. Pre-warm TTS voices (browsers load voices asynchronously)
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {};
  }

  console.log('%c❄ Blue Mandarin v1.7.0 — Hossam Aldeen Hassan 2026',
    'color:#64B5F6;font-size:12px;font-weight:bold');
}

/**
 * _triggerLessonStart(lid) — called by lc-start-btn pointerdown/click.
 * Opens the curriculum guided lesson if available, otherwise the vocab quiz.
 */
function _triggerLessonStart(lid) {
  const CE = window.BM?.Curriculum;
  if (CE) {
    CE.loadCurriculum().then(cur => {
      if (!cur) { openLessonTest(lid); return; }
      for (const unit of cur.units) {
        const lesson = unit.lessons.find((_, i) => {
          const globalIdx = cur.units.slice(0, cur.units.indexOf(unit))
            .reduce((s, u) => s + u.lessons.length, 0) + unit.lessons.indexOf(_);
          return globalIdx + 1 === lid;
        });
        if (lesson) { CE.openLesson(unit.id, lesson.id); return; }
      }
      openLessonTest(lid);
    });
  } else {
    openLessonTest(lid);
  }
}

/**
 * renderLessonGrid — driven by LESSON_PLAN (from lessons.json + vocab.json).
 * Each card shows:
 *   · Real Arabic title from lessons.json
 *   · 汉字 headword · English subtitle
 *   · Word count + number of parts if chunked
 *   · A "START ▶" call-to-action button
 *   · Progress bar from localStorage
 * Accepts optional lessonsMeta from prefetchAll (used as fallback for
 * dialogue/sentence counts), but renders from LESSON_PLAN regardless.
 */
function renderLessonGrid(lessonsMeta) {
  const grid     = document.getElementById('lessons-grid');
  if (!grid) return;
  const ldProgress = Progress.getLessonDetailProgress?.() ?? {};
  const completed  = Progress.getProgress?.()?.completedLessons ?? [];
  const COLORS     = ['u-blue','u-gold','u-jade','u-violet','u-coral'];

  grid.innerHTML = LESSON_PLAN.map(lesson => {
    const lp    = ldProgress[lesson.n] ?? {};
    const isDone = completed.includes(lesson.n);
    // Progress: completed=100 | vocabSeen as fraction of lesson total (capped at 95%)
    const seenPct = isDone ? 100
      : lp.vocabSeen ? Math.min(Math.round((lp.vocabSeen / lesson.total) * 100), 95) : 0;

    const icon  = LESSON_ICONS[lesson.n] ?? '📚';
    const clr   = COLORS[(lesson.n - 1) % COLORS.length];
    const parts = lesson.parts.length;
    const partsBadge = parts > 1
      ? `<span style="font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:20px;
           background:rgba(100,181,246,0.12);border:1px solid rgba(100,181,246,0.2);
           color:var(--accent);margin-right:4px">${parts} أجزاء</span>` : '';
    const doneBadge = isDone
      ? `<span style="font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:20px;
           background:rgba(38,217,127,0.12);border:1px solid rgba(38,217,127,0.25);
           color:var(--jade)">✓ مكتمل</span>` : '';
    // Lock lessons beyond current progress (only lock if > 2 lessons ahead of last completed)
    const lastDone = Math.max(0, ...completed.filter(n => typeof n==='number'));
    const isLocked = lesson.n > lastDone + 3 && !isDone && seenPct === 0;

    return `
      <div class="lesson-card rip" data-lesson-id="${lesson.n}" data-lesson-num="${lesson.n}"
           data-cn="${lesson.h}" data-tag="${lesson.n}"
           role="button" tabindex="0" style="${isLocked?'opacity:0.55':''}">
        <div class="lc-icon ${clr}">${icon}</div>
        <div class="lc-name">${lesson.t}</div>
        <div class="lc-meta" style="margin-bottom:5px">
          <span style="font-family:'Noto Sans SC',sans-serif;font-weight:700">${lesson.h}</span>
          &nbsp;·&nbsp;${lesson.total} كلمة
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
          ${partsBadge}${doneBadge}
        </div>
        <div class="lc-bar"><div class="lc-bar-fill" style="width:${seenPct}%"></div></div>
        <div style="display:flex;gap:6px;margin-top:9px">
          <button class="lc-start-btn" data-lesson-id="${lesson.n}"
            style="flex:1;padding:8px 0;border-radius:var(--r-sm);
            font-size:12px;font-weight:800;letter-spacing:0.04em;cursor:pointer;
            touch-action:manipulation;
            background:${isDone?'rgba(38,217,127,0.10)':'rgba(30,144,255,0.12)'};
            border:1px solid ${isDone?'rgba(38,217,127,0.28)':'rgba(100,181,246,0.22)'};
            color:${isDone?'var(--jade)':'var(--accent)'};">
            ${isDone ? '↩ مراجعة' : isLocked ? '🔒 مقفل' : '▶ ابدأ'}
          </button>
          <button class="lc-challenge-btn rip" data-lesson-id="${lesson.n}"
            title="تحدي الدرس"
            style="padding:8px 10px;border-radius:var(--r-sm);font-size:14px;
            cursor:pointer;touch-action:manipulation;flex-shrink:0;
            background:rgba(255,202,64,0.10);border:1px solid rgba(255,202,64,0.28);
            color:var(--gold);">⚡</button>
        </div>
      </div>`;
  }).join('');

  // Wire touch handlers — both card and button open LessonDetail
  // Use _wireTap for instant pointerdown response on mobile
  grid.querySelectorAll('.lesson-card[data-lesson-id]').forEach(card => {
    _wireTap(card, () => {
      // Don't double-fire if the inner start button was tapped
      // (start button has its own handler below)
    });
    // Also keep a click handler that checks for button target
    card.addEventListener('click', e => {
      if (e.target.closest('.lc-start-btn') || e.target.closest('.lc-challenge-btn')) return;
      openLesson(+card.dataset.lessonId);
    });
  });
  // ⚡ Challenge buttons → ChallengeEngine.open()
  grid.querySelectorAll('.lc-challenge-btn').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      window.BM?.ChallengeEngine?.open(+btn.dataset.lessonId);
    });
  });

  grid.querySelectorAll('.lc-start-btn').forEach(btn => {
    // pointerdown: instant tap response, no 300ms delay
    btn.addEventListener('pointerdown', e => {
      if (!e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      const lid = +btn.dataset.lessonId;
      _triggerLessonStart(lid);
    });
    btn.addEventListener('click', e => {
      if (e.pointerType) { e.stopPropagation(); return; } // handled by pointerdown
      e.stopPropagation();
      const lid = +btn.dataset.lessonId;
      _triggerLessonStart(lid);
    });
  });
}

/**
 * renderHomePath — syncs all 15 lesson-path nodes in the scrollable
 * carousel with live progress from localStorage.
 */
function renderHomePath() {
  const completed = Progress.getProgress?.()?.completedLessons ?? [];
  const allIds    = LESSON_PLAN.map(l => l.n);  // [1..15]

  // First incomplete lesson = the "current" one
  const currentId = allIds.find(id => !completed.includes(id)) ?? null;

  document.querySelectorAll('#home-path-container .path-node[data-lesson-id]').forEach(node => {
    const id     = +node.dataset.lessonId;
    const lesson = LESSON_PLAN.find(l => l.n === id);
    if (!lesson) return;

    const lbl = node.querySelector('.node-lbl');
    const cn  = node.querySelector('.node-cn');
    if (cn) cn.textContent = lesson.h;

    const isDone    = completed.includes(id);
    const isCurrent = id === currentId;
    const isLocked  = !isDone && !isCurrent;

    node.classList.remove('done-node', 'current-node', 'locked-node');
    node.classList.add(isDone ? 'done-node' : isCurrent ? 'current-node' : 'locked-node');
    if (lbl) lbl.textContent = isDone ? '✓' : isCurrent ? '▶' : '🔒';
    node.toggleAttribute('aria-disabled', isLocked);
    node.style.cursor = isLocked ? 'default' : 'pointer';
  });

  // Colour connector lines: done = blue gradient, pending = frost
  document.querySelectorAll('#home-path-container .path-line').forEach((line, i) => {
    const leftNodeId = allIds[i]; // line[i] connects lesson i to lesson i+1
    line.classList.toggle('done', completed.includes(leftNodeId));
  });

  // Auto-scroll to bring the current lesson into view after a short delay
  setTimeout(() => {
    const currentNode = document.querySelector(
      `#home-path-container .path-node[data-lesson-id="${currentId}"]`
    );
    currentNode?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, 350);
}

/** Render story cards in the Reading Center stories panel. */
function renderStoryList(stories) {
  const list = document.getElementById('story-list');
  if (!list || !Array.isArray(stories) || !stories.length) return;
  const sp = Progress.getStoryProgress?.() ?? {};

  const LEVEL_COLORS = { beginner:'beginner', intermediate:'intermediate', advanced:'advanced' };
  const LEVEL_ICONS  = { beginner:'📖', intermediate:'📗', advanced:'📕' };

  list.innerHTML = stories.map((s, i) => {
    const storyProgress = sp[s.story_number] ?? {};
    const isRead   = !!storyProgress.read;
    const bestScore = storyProgress.quizAttempts?.length
      ? Math.max(...storyProgress.quizAttempts.map(a => a.score)) : null;
    const lk = LEVEL_COLORS[s.levelKey] ?? 'beginner';
    return `
      <div class="story-card rip ${isRead ? 'read-done' : ''}"
           data-story-num="${s.story_number}" data-num="${s.story_number}" role="button" tabindex="0">
        <div class="sc-icon ${isRead ? 'u-jade' : 'u-blue'}" style="font-size:26px">
          ${LEVEL_ICONS[s.levelKey] ?? '📖'}
        </div>
        <div class="sc-body">
          <div class="sc-title">${s.title_zh}</div>
          <div class="sc-title-ar">${s.title_ar}</div>
          <div class="sc-meta">
            <span class="sc-badge ${lk}">${s.level ?? s.levelKey}</span>
            ${bestScore !== null ? `<span class="sc-badge" style="background:rgba(255,202,64,0.10);border-color:rgba(255,202,64,0.28);color:var(--gold)">Best: ${bestScore}/${(sp[s.story_number]?.quizAttempts?.[0]?.total??'?')}</span>` : ''}
          </div>
        </div>
        <div class="sc-check">${isRead ? '✅' : '○'}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.story-card').forEach(card => {
    card.addEventListener('click', () => StoryReader.open(+card.dataset.storyNum));
  });
}

// When القصص nav tab is tapped → always show stories (not grammar)
// This makes the nav tab consistently open stories as the landing panel.
document.querySelector('.nav-item[data-view="read"]')?.addEventListener('pointerdown', e => {
  if (!e.isPrimary) return;
  e.preventDefault();
  switchPage('stories');        // navigate + activate stories panel + render
});
document.querySelector('.nav-item[data-view="read"]')?.addEventListener('click', e => {
  if (e.pointerType) return;    // already handled by pointerdown
  switchPage('stories');
});

// Auto-start
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

console.log('%c❄ Blue Mandarin v1.7.0 | Hossam Aldeen Hassan 2026 | HSK 1 Platform',
  'color:#64B5F6;font-size:12px;font-weight:bold;');
console.log('%cTones ✓  VocabPage ✓  Challenges ✓  TTS ✓  4-Type Quizzes ✓  Swipe Fixed ✓',
  'color:#26D97F;font-size:10px;');
