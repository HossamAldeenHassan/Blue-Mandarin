/**
 * ================================================================
 *  BLUE MANDARIN — challenges.js  (Lesson Challenge Engine)
 *  Generates and renders 4-type quizzes per lesson from
 *  data/hsk1/challenges.json.
 *
 *  Question types (as per spec):
 *    1. mcq        — Multiple Choice: choose Arabic meaning
 *    2. truefalse  — صح / خطأ: does this pinyin match?
 *    3. build      — Sentence Construction: tap tiles in order
 *    4. listen     — Listening: play TTS, identify the character
 *
 *  Question types: MCQ | True-False | Sentence-Build | Listen. No pairing/drag-to-match questions.
 * ================================================================
 */
'use strict';

const ChallengeEngine = (() => {

  let _challenges = null;   // full parsed challenges.json
  let _active = null;       // { lessonId, questions[], idx, score, startTime }

  // ── Char→Pinyin lookup (for tile annotations) ─────────────────
  let _charPy = null;
  async function _loadCharPy() {
    if (_charPy) return _charPy;
    try {
      const r = await fetch('./data/hsk1/char_pinyin.json?_v=' + Date.now());
      _charPy = r.ok ? await r.json() : {};
    } catch (_) { _charPy = {}; }
    // Supplement from KG vocab
    const kg = window.BM?.KnowledgeGraph?.vocab?.all ?? [];
    kg.forEach(w => { if (!_charPy[w.cn]) _charPy[w.cn] = w.pinyin; });
    return _charPy;
  }
  function _getPy(char) { return (_charPy ?? {})[char] ?? ''; }

  // ── Load ──────────────────────────────────────────────────────
  async function _load() {
    if (_challenges) return _challenges;
    try {
      const r = await fetch(`./data/hsk1/challenges.json?_v=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _challenges = await r.json();
      console.log('[CE] challenges.json loaded:', Object.keys(_challenges).length, 'lessons');
    } catch (e) {
      console.error('[CE] load failed:', e);
      _challenges = {};
    }
    return _challenges;
  }

  // ── TTS helper ─────────────────────────────────────────────────
  function _speak(cn, rate = 0.8) {
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(cn);
    utt.lang   = 'zh-CN';
    utt.rate   = rate;
    utt.pitch  = 1;
    utt.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'));
    if (zh) utt.voice = zh;
    window.speechSynthesis.speak(utt);
  }

  // ── Overlay ────────────────────────────────────────────────────
  function _getOrCreateOverlay() {
    let ov = document.getElementById('overlay-challenge');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id        = 'overlay-challenge';
    ov.className = 'overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Lesson Challenge');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `
      <div class="overlay-header">
        <button class="overlay-close rip" id="ch-close">✕</button>
        <div style="flex:1">
          <div class="overlay-title" id="ch-title">تحدي الدرس</div>
          <div class="overlay-sub"   id="ch-sub">سؤال 1 من 15</div>
        </div>
        <div id="ch-score-live" style="font-size:13px;font-weight:700;color:var(--jade)">0 ✓</div>
      </div>
      <div class="ch-progress-bar-wrap">
        <div class="ch-progress-bar" id="ch-progress-bar"></div>
      </div>
      <div class="ch-body" id="ch-body"></div>`;
    document.body.appendChild(ov);
    document.getElementById('ch-close').addEventListener('pointerdown', e => {
      e.preventDefault();
      _close();
    });
    return ov;
  }

  function _close() {
    document.getElementById('overlay-challenge')?.classList.remove('open');
    _active = null;
  }

  // ── Question renderers ─────────────────────────────────────────
  function _renderQ() {
    if (!_active) return;
    const q     = _active.questions[_active.idx];
    const total = _active.questions.length;
    const pct   = Math.round((_active.idx / total) * 100);

    document.getElementById('ch-progress-bar').style.width = pct + '%';
    document.getElementById('ch-sub').textContent = `سؤال ${_active.idx + 1} من ${total}`;
    document.getElementById('ch-score-live').textContent = `${_active.score} ✓`;

    const body = document.getElementById('ch-body');
    body.innerHTML = '';

    const T = window.BM?.Tones;

    switch (q.type) {

      // ── MCQ ────────────────────────────────────────────────────
      case 'mcq': {
        const pyHtml = T ? T.wrapCompoundPinyin(q.pinyin) : q.pinyin;
        body.innerHTML = `
          <div class="ch-card">
            <div class="ch-type-badge">اختياري 🔤</div>
            <div class="ch-prompt">${q.prompt_ar}</div>
            <div class="ch-cn ${T ? T.getCls(T.getTone(q.pinyin)) : ''}">${q.cn}</div>
            <div class="ch-py bm-pinyin">${pyHtml}</div>
            <div class="ch-opts" id="ch-opts"></div>
            <div class="ch-explanation hidden" id="ch-exp"></div>
          </div>`;
        const opts = document.getElementById('ch-opts');
        q.options.forEach(opt => {
          const btn = document.createElement('button');
          btn.className = 'ch-opt rip';
          btn.textContent = opt;
          btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (opts.querySelector('.correct, .wrong')) return;
            const correct = opt === q.answer;
            btn.classList.add(correct ? 'correct' : 'wrong');
            opts.querySelectorAll('.ch-opt').forEach(b => {
              b.disabled = true;
              if (b.textContent === q.answer) b.classList.add('correct');
            });
            _showExp(q.explanation_ar, correct);
            if (correct) _active.score++;
            _scheduleNext(1400);
          });
          opts.appendChild(btn);
        });
        break;
      }

      // ── True/False ─────────────────────────────────────────────
      case 'truefalse': {
        const pyHtml = T ? T.wrapCompoundPinyin(q.shown_pinyin) : q.shown_pinyin;
        body.innerHTML = `
          <div class="ch-card">
            <div class="ch-type-badge">صح وخطأ ✅</div>
            <div class="ch-prompt">${q.prompt_ar}</div>
            <div class="ch-cn ${T ? T.getCls(T.getTone(q.shown_pinyin)) : ''}">${q.cn}</div>
            <div class="ch-py bm-pinyin">${pyHtml}</div>
            <div class="ch-tf-row">
              <button class="ch-tf-btn ch-tf-true rip" data-answer="true">✅ صحيح</button>
              <button class="ch-tf-btn ch-tf-false rip" data-answer="false">❌ خطأ</button>
            </div>
            <div class="ch-explanation hidden" id="ch-exp"></div>
          </div>`;
        body.querySelectorAll('.ch-tf-btn').forEach(btn => {
          btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (body.querySelector('.ch-tf-btn[disabled]')) return;
            const chosen  = btn.dataset.answer === 'true';
            const correct = chosen === q.answer;
            body.querySelectorAll('.ch-tf-btn').forEach(b => { b.disabled = true; });
            btn.classList.add(correct ? 'correct' : 'wrong');
            if (!correct) {
              const correctBtn = body.querySelector(`.ch-tf-btn[data-answer="${q.answer}"]`);
              correctBtn?.classList.add('correct');
            }
            _showExp(q.explanation_ar, correct);
            if (correct) _active.score++;
            _scheduleNext(1400);
          });
        });
        break;
      }

      // ── Sentence Build ─────────────────────────────────────────
      case 'build': {
        let placed = [];
        const tiles = [...q.tiles];
        body.innerHTML = `
          <div class="ch-card">
            <div class="ch-type-badge">تكوين جمل 🧩</div>
            <div class="ch-prompt">${q.prompt_ar}</div>
            <div class="ch-build-target-ar">${q.target_ar}</div>
            <div class="ch-build-stage" id="ch-stage">
              <span class="ch-stage-ph">اضغط الكلمات أدناه…</span>
            </div>
            <div class="ch-build-bank" id="ch-bank">
              ${tiles.map((t, i) => {
                const py = _getPy(t);
                const T  = window.BM?.Tones;
                const tc = T ? T.getCls(T.getTone(py)) : '';
                return `<button class="ch-tile rip" data-i="${i}" data-cn="${t}">
                  <span class="ch-tile-py ${tc}">${py}</span>
                  <span class="ch-tile-cn">${t}</span>
                </button>`;
              }).join('')}
            </div>
            <div class="ch-explanation hidden" id="ch-exp"></div>
            <button class="cta-btn cta-primary rip ch-check-btn" id="ch-check">تحقق ✓</button>
          </div>`;

        function _updateStage() {
          const stage = document.getElementById('ch-stage');
          if (!placed.length) {
            stage.innerHTML = '<span class="ch-stage-ph">اضغط الكلمات أدناه…</span>';
            return;
          }
          stage.innerHTML = placed.map((t, pos) =>
            `<button class="ch-tile placed rip" data-pos="${pos}">${t}</button>`
          ).join('');
          stage.querySelectorAll('.placed').forEach(b => {
            b.addEventListener('pointerdown', e => {
              e.preventDefault();
              const pos = +b.dataset.pos;
              const removed = placed.splice(pos, 1)[0];
              // Un-use the corresponding bank tile
              document.querySelectorAll('.ch-tile:not(.placed)').forEach(bt => {
                if (bt.dataset.cn === removed && bt.classList.contains('used')) {
                  bt.classList.remove('used');
                  return;
                }
              });
              _updateStage();
            });
          });
        }

        document.getElementById('ch-bank').querySelectorAll('.ch-tile').forEach(btn => {
          btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (btn.classList.contains('used')) return;
            btn.classList.add('used');
            placed.push(btn.dataset.cn);
            _updateStage();
          });
        });

        document.getElementById('ch-check').addEventListener('pointerdown', e => {
          e.preventDefault();
          const answer = placed.join('');
          const correct = answer === q.target_cn;
          _showExp(
            correct ? `✅ ممتاز! ${q.target_cn} — ${q.target_ar}` : `❌ الصحيح: ${q.target_cn}`,
            correct
          );
          if (correct) { _active.score++; _scheduleNext(1200); }
          else {
            // Reset after 2 s
            setTimeout(() => {
              placed = [];
              document.querySelectorAll('.ch-tile').forEach(b => b.classList.remove('used'));
              _updateStage();
              document.getElementById('ch-exp')?.classList.add('hidden');
            }, 2000);
          }
        });
        break;
      }

      // ── Listen ─────────────────────────────────────────────────
      case 'listen': {
        body.innerHTML = `
          <div class="ch-card">
            <div class="ch-type-badge">سماع 🎧</div>
            <div class="ch-prompt">${q.prompt_ar}</div>
            <button class="ch-play-btn rip" id="ch-play-btn">
              🔊 استمع مرة أخرى
            </button>
            <div class="ch-opts" id="ch-opts">
              ${q.options_cn.map(opt => `
                <button class="ch-opt ch-opt-cn rip" data-cn="${opt}">${opt}</button>
              `).join('')}
            </div>
            <div class="ch-explanation hidden" id="ch-exp"></div>
          </div>`;
        // Auto-play on render
        setTimeout(() => _speak(q.audio_cn), 300);
        document.getElementById('ch-play-btn').addEventListener('pointerdown', e => {
          e.preventDefault();
          _speak(q.audio_cn);
        });
        const opts = document.getElementById('ch-opts');
        opts.querySelectorAll('.ch-opt').forEach(btn => {
          btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (opts.querySelector('.correct, .wrong')) return;
            const correct = btn.dataset.cn === q.answer_cn;
            btn.classList.add(correct ? 'correct' : 'wrong');
            opts.querySelectorAll('.ch-opt').forEach(b => {
              b.disabled = true;
              if (b.dataset.cn === q.answer_cn) b.classList.add('correct');
            });
            _showExp(q.explanation_ar, correct);
            if (correct) _active.score++;
            _scheduleNext(1400);
          });
        });
        break;
      }
    }
    // Apply pinyin visibility
    if (window.BM?.Tones && !window.BM.Tones.isPinyinVisible()) {
      body.querySelectorAll('.bm-pinyin').forEach(el => el.style.display = 'none');
    }
  }

  function _showExp(text, correct) {
    const el = document.getElementById('ch-exp');
    if (!el) return;
    el.textContent = text;
    el.className = `ch-explanation ${correct ? 'correct' : 'wrong'}`;
  }

  function _scheduleNext(ms) {
    setTimeout(() => {
      _active.idx++;
      if (_active.idx >= _active.questions.length) {
        _showResults();
      } else {
        _renderQ();
      }
    }, ms);
  }

  function _showResults() {
    const { score, questions, startTime, lessonId } = _active;
    const total   = questions.length;
    const pct     = Math.round((score / total) * 100);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const medal   = pct >= 90 ? '🏆' : pct >= 60 ? '🥇' : '📚';

    // Award XP via ProgressManager
    const xp = Math.round((score / total) * 50);
    window.BM?.ProgressManager?.saveTestAttempt?.({
      score, total, timeSec: elapsed, answers: []
    });

    const body = document.getElementById('ch-body');
    document.getElementById('ch-progress-bar').style.width = '100%';
    document.getElementById('ch-sub').textContent = 'انتهى التحدي!';

    body.innerHTML = `
      <div class="ch-results">
        <div class="ch-res-medal">${medal}</div>
        <div class="ch-res-score">${score} / ${total}</div>
        <div class="ch-res-pct">${pct}% دقة</div>
        <div class="ch-res-xp">⭐ +${xp} نقطة خبرة</div>
        <div class="ch-res-time">⏱ ${elapsed} ثانية</div>
        <button class="cta-btn cta-primary rip ch-retry-btn" id="ch-retry">🔄 حاول مرة أخرى</button>
        <button class="cta-btn cta-secondary rip" id="ch-done">🏠 العودة</button>
      </div>`;

    document.getElementById('ch-retry').addEventListener('pointerdown', e => {
      e.preventDefault();
      open(lessonId);
    });
    document.getElementById('ch-done').addEventListener('pointerdown', e => {
      e.preventDefault();
      _close();
    });
  }

  // ── Public API ─────────────────────────────────────────────────
  async function open(lessonId) {
    await _loadCharPy();   // ensure tile pinyin available
    const all = await _load();
    const ch  = all[lessonId];
    if (!ch) {
      if (typeof toast === 'function') toast(`⚠️ لا يوجد تحدي للدرس ${lessonId} بعد`);
      return;
    }

    // Shuffle question order for variety
    const questions = [...ch.questions].sort(() => Math.random() - 0.5);
    _active = {
      lessonId,
      questions,
      idx:       0,
      score:     0,
      startTime: Date.now(),
    };

    const ov = _getOrCreateOverlay();
    document.getElementById('ch-title').textContent =
      `تحدي: ${ch.title_ar}`;
    ov.classList.add('open');
    _renderQ();
  }

  return { open };
})();

window.BM = window.BM ?? {};
window.BM.ChallengeEngine = ChallengeEngine;
