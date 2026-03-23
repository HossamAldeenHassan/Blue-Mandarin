/**
 * ================================================================
 *  BLUE MANDARIN — CurriculumEngine  (js/curriculum.js)
 *  Parses curriculum.json and renders a step-by-step guided
 *  lesson flow instead of a flat flashcard grid.
 *
 *  Step types rendered:
 *    intro          → Hook card with body text
 *    teach_concept  → Concept explanation + examples table
 *    teach_word     → Single word card: hanzi + pinyin + tone badge
 *                     + Arabic meaning + breakdown + example
 *    teach_tones    → 5-tone reference cards with shape visuals
 *    practice_tones → MCQ on tone identification
 *    practice_mcq   → Multi-question MCQ with explanation
 *    practice_match → Matching pairs (tap to connect)
 *    practice_build → Drag/tap sentence builder (word bank)
 *    summary        → XP award + points recap + badge unlock
 *
 *  Public API (attached to window.BM.Curriculum):
 *    loadCurriculum()         → fetches curriculum.json, returns parsed data
 *    openUnit(unitId)         → renders unit overview modal
 *    openLesson(unitId, lessonId) → starts step flow
 *    getCurrentProgress()     → {unitId, lessonId, stepIdx} from localStorage
 * ================================================================
 */
'use strict';

const CurriculumEngine = (() => {

  // ── 1. State ─────────────────────────────────────────────────
  let _curriculum    = null;    // parsed curriculum.json
  let _activeUnit    = null;
  let _activeLesson  = null;
  let _steps         = [];
  let _stepIdx       = 0;
  let _stepResults   = [];      // per-step scores for this lesson run
  const PROGRESS_KEY = 'bm:curriculum_progress';

  // ── 2. Fetch ──────────────────────────────────────────────────
  async function loadCurriculum() {
    if (_curriculum) return _curriculum;
    try {
      const bust = `?_v=${Math.floor(Date.now() / 60000)}`;
      const res = await fetch('./data/hsk1/curriculum.json' + bust, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _curriculum = await res.json();
      console.log('[CE] curriculum.json loaded:', _curriculum.units.length, 'units');
      return _curriculum;
    } catch (e) {
      console.error('[CE] Failed to load curriculum.json:', e);
      return null;
    }
  }

  // ── 3. Progress persistence ───────────────────────────────────
  function _saveProgress(unitId, lessonId, stepIdx) {
    try {
      const prog = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
      prog.lastUnit   = unitId;
      prog.lastLesson = lessonId;
      prog.lastStep   = stepIdx;
      prog.completedLessons = prog.completedLessons ?? [];
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog));
    } catch (_) {}
  }

  function _markLessonComplete(unitId, lessonId, xpEarned) {
    try {
      const prog = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
      prog.completedLessons = prog.completedLessons ?? [];
      const key = `${unitId}:${lessonId}`;
      if (!prog.completedLessons.includes(key)) {
        prog.completedLessons.push(key);
      }
      // Store per-lesson XP
      prog.lessonXP = prog.lessonXP ?? {};
      prog.lessonXP[key] = (prog.lessonXP[key] ?? 0) + xpEarned;
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog));
    } catch (_) {}
  }

  function isLessonComplete(unitId, lessonId) {
    try {
      const prog = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
      return (prog.completedLessons ?? []).includes(`${unitId}:${lessonId}`);
    } catch (_) { return false; }
  }

  function getCurrentProgress() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    } catch (_) { return {}; }
  }

  // ── 4. Overlay infrastructure ─────────────────────────────────
  function _getOrCreateOverlay() {
    let ov = document.getElementById('overlay-curriculum');
    if (ov) return ov;

    ov = document.createElement('div');
    ov.id        = 'overlay-curriculum';
    ov.className = 'overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Curriculum Lesson');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `
      <div class="overlay-header" id="ce-header">
        <button class="overlay-close rip" id="ce-close" aria-label="Close">✕</button>
        <div style="flex:1">
          <div class="overlay-title" id="ce-lesson-title">الدرس</div>
          <div class="overlay-sub"   id="ce-lesson-sub"></div>
        </div>
        <div id="ce-step-counter" style="font-size:12px;font-weight:700;color:var(--text-3)"></div>
      </div>
      <div class="ce-progress-bar-wrap">
        <div class="ce-progress-bar" id="ce-progress-bar"></div>
      </div>
      <div class="ce-body" id="ce-body"></div>
      <div class="ce-footer" id="ce-footer">
        <!-- populated by _addNextBtn / _addCheckBtn each step -->
      </div>`;
    document.body.appendChild(ov);

    document.getElementById('ce-close').addEventListener('click', _closeLesson);
    return ov;
  }

  function _openOverlay() {
    const ov = _getOrCreateOverlay();
    // Reset footer to empty for each new lesson
    const footer = document.getElementById('ce-footer');
    if (footer) footer.innerHTML = '';
    ov.classList.add('open');
    document.getElementById('ce-close').focus();
  }

  function _closeLesson() {
    const ov = document.getElementById('overlay-curriculum');
    if (ov) ov.classList.remove('open');
    _activeLesson = null;
    _steps        = [];
    _stepIdx      = 0;
    _stepResults  = [];
    // Refresh the home/learn UI
    if (typeof renderHomePath === 'function')    renderHomePath();
    if (typeof renderLessonGrid === 'function')  renderLessonGrid();
    if (typeof refreshUI === 'function')         refreshUI();
  }

  // ── 5. Lesson orchestration ───────────────────────────────────
  async function openLesson(unitId, lessonId) {
    const cur = _curriculum ?? await loadCurriculum();
    if (!cur) { _toast('⚠️ تعذّر تحميل المنهج'); return; }

    const unit   = cur.units.find(u => u.id === unitId);
    const lesson = unit?.lessons.find(l => l.id === lessonId);
    if (!lesson) { _toast('⚠️ الدرس غير موجود'); return; }

    _activeUnit   = unit;
    _activeLesson = lesson;
    _steps        = lesson.steps;
    _stepIdx      = 0;
    _stepResults  = [];

    _getOrCreateOverlay();
    document.getElementById('ce-lesson-title').textContent =
      `${lesson.key} · ${lesson.title_ar}`;
    document.getElementById('ce-lesson-sub').textContent = lesson.subtitle_ar ?? '';

    _openOverlay();
    _renderStep();
  }

  function _nextStep() {
    // Collect any pending answer from the current step before advancing
    const collected = _collectCurrentAnswer();
    if (collected === false) return; // validation failed — stay on step

    _stepIdx++;
    if (_stepIdx >= _steps.length) {
      _finishLesson();
    } else {
      _renderStep();
    }
  }

  // ── Helper: find the lesson that comes directly after the current one ─
  function _findNextLesson() {
    if (!_activeUnit || !_activeLesson || !_curriculum) return null;
    const lidx = _activeUnit.lessons.indexOf(_activeLesson);
    // Next lesson in same unit?
    if (lidx >= 0 && lidx < _activeUnit.lessons.length - 1) {
      return { unitId: _activeUnit.id, lessonId: _activeUnit.lessons[lidx + 1].id };
    }
    // First lesson of next unit?
    const uidx = _curriculum.units.indexOf(_activeUnit);
    if (uidx >= 0 && uidx < _curriculum.units.length - 1) {
      const nextUnit = _curriculum.units[uidx + 1];
      if (nextUnit.lessons.length > 0) {
        return { unitId: nextUnit.id, lessonId: nextUnit.lessons[0].id };
      }
    }
    return null; // reached end of curriculum
  }

  function _finishLesson() {
    const xp = _activeLesson.xp ?? 0;
    _markLessonComplete(_activeUnit.id, _activeLesson.id, xp);

    // Award XP via ProgressManager
    if (window.BM?.ProgressManager) {
      window.BM.ProgressManager.saveTestAttempt({
        score:   _stepResults.filter(r => r).length,
        total:   Math.max(_stepResults.length, 1),
        timeSec: 0,
        answers: [],
      });
    }
    _saveProgress(_activeUnit.id, _activeLesson.id, _stepIdx);

    // Find next lesson — update footer button to navigate there
    const next = _findNextLesson();
    const footer = document.getElementById('ce-footer');
    if (footer) {
      footer.innerHTML = '';
      const btn = document.createElement('button');
      btn.className = 'cta-btn cta-primary rip';
      btn.textContent = next ? 'إلى الدرس التالي ›' : '✓ إغلاق';
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        _closeLesson();
        if (next) {
          // Small delay so close animation plays first
          setTimeout(() => openLesson(next.unitId, next.lessonId), 320);
        }
      });
      footer.appendChild(btn);
    }
  }

  // ── 6. Step router ────────────────────────────────────────────
  function _renderStep() {
    const step = _steps[_stepIdx];
    if (!step) return;

    const total = _steps.length;
    const pct   = Math.round((_stepIdx / total) * 100);

    document.getElementById('ce-progress-bar').style.width = pct + '%';
    document.getElementById('ce-step-counter').textContent =
      `${_stepIdx + 1} / ${total}`;

    const body   = document.getElementById('ce-body');
    const footer = document.getElementById('ce-footer');
    body.innerHTML   = '';
    footer.innerHTML = '';

    switch (step.type) {
      case 'intro':          _renderIntro(step, body, footer);         break;
      case 'teach_concept':  _renderTeachConcept(step, body, footer);  break;
      case 'teach_word':     _renderTeachWord(step, body, footer);     break;
      case 'teach_tones':    _renderTeachTones(step, body, footer);    break;
      case 'practice_tones': _renderPracticeMCQ(step, body, footer);   break;
      case 'practice_mcq':   _renderPracticeMCQ(step, body, footer);   break;
      case 'practice_match': _renderPracticeMatch(step, body, footer); break;
      case 'practice_build': _renderPracticeBuild(step, body, footer); break;
      case 'summary':        _renderSummary(step, body, footer);       break;
      default:
        body.innerHTML = `<p style="color:var(--text-3);padding:20px">Step type: ${step.type}</p>`;
        _addNextBtn(footer);
    }

    body.scrollTop = 0;
  }

  // ── 7. Collect current answer (returns false to block advance) ─
  let _pendingValidate = null; // set by practice steps

  function _collectCurrentAnswer() {
    if (typeof _pendingValidate === 'function') {
      const ok = _pendingValidate();
      _pendingValidate = null;
      return ok;
    }
    return true;
  }

  // ── 8. Step renderers ─────────────────────────────────────────

  function _renderIntro(step, body, footer) {
    body.innerHTML = `
      <div class="ce-intro-card">
        <div class="ce-intro-title">${step.title_ar}</div>
        <div class="ce-intro-body">${_mdToHtml(step.body_ar)}</div>
      </div>`;
    _addNextBtn(footer, 'فهمت! هيا بنا ›');
  }

  function _renderTeachConcept(step, body, footer) {
    let html = `<div class="ce-concept-card">
      <div class="ce-concept-title">${step.title_ar}</div>
      <div class="ce-concept-body">${_mdToHtml(step.body_ar ?? '')}</div>`;

    // Examples table
    if (step.examples?.length) {
      html += `<div class="ce-examples-list">`;
      step.examples.forEach(ex => {
        const zh   = ex.zh   ?? ex.cn ?? '';
        const note = ex.note_ar ?? ex.visual_note_ar ?? '';
        html += `
          <div class="ce-example-row">
            <span class="ce-ex-cn">${zh}</span>
            <span class="ce-ex-py">${ex.pinyin ?? ''}</span>
            <span class="ce-ex-ar">${ex.ar ?? ''}</span>
            ${note ? `<span class="ce-ex-note">${note}</span>` : ''}
          </div>`;
      });
      html += `</div>`;
    }

    // Visual breakdown (for 你好 compound)
    if (step.visual) {
      const v = step.visual;
      html += `<div class="ce-visual-compound">
        <div class="ce-vc-main">
          <span class="ce-vc-cn">${v.cn}</span>
          <span class="ce-vc-py">${v.pinyin}</span>
          <span class="ce-vc-ar">${v.ar}</span>
        </div>
        <div class="ce-vc-parts">
          ${(v.breakdown ?? []).map(p => `
            <div class="ce-vc-part">
              <span class="ce-vc-cn" style="font-size:28px">${p.cn}</span>
              <span class="ce-vc-py">${p.pinyin}</span>
              <span class="ce-vc-ar">${p.ar}</span>
            </div>`).join('<span class="ce-vc-plus">+</span>')}
        </div>
      </div>`;
    }

    // Vocabulary list (for concept steps with vocab items)
    if (step.vocabulary?.length) {
      html += `<div class="ce-examples-list">`;
      step.vocabulary.forEach(w => {
        html += `<div class="ce-example-row">
          <span class="ce-ex-cn">${w.cn}</span>
          <span class="ce-ex-py">${w.pinyin}</span>
          <span class="ce-ex-ar">${w.ar}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // Dialogue
    if (step.dialogue?.length) {
      html += _renderDialogueHtml(step.dialogue);
    }

    // Useful phrase
    if (step.useful_phrase) {
      const p = step.useful_phrase;
      html += `<div class="ce-phrase-box">
        <div class="ce-phrase-cn">${p.cn}</div>
        <div class="ce-phrase-py">${p.pinyin}</div>
        <div class="ce-phrase-ar">${p.ar}</div>
      </div>`;
    }

    // Note
    if (step.note_ar) {
      html += `<div class="ce-note">${step.note_ar}</div>`;
    }

    html += `</div>`;
    body.innerHTML = html;
    _addNextBtn(footer);
  }

  function _renderTeachWord(step, body, footer) {
    const toneNum = Array.isArray(step.tones) ? step.tones[0] : (step.tone ?? 0);
    const toneColors = { 1:'#FF6B7A', 2:'#26D97F', 3:'#1E90FF', 4:'#FFCA40', 0:'#B388FF' };
    const toneColor  = toneColors[toneNum] ?? 'var(--accent)';

    // Compound word components
    const compHTML = step.is_compound && step.components?.length
      ? `<div class="ce-compound-parts">
          ${step.components.map(c => `
            <div class="ce-comp-part">
              <div class="ce-comp-cn">${c.cn}</div>
              <div class="ce-comp-py">${c.pinyin}</div>
              <div class="ce-comp-ar">${c.ar}</div>
            </div>`).join('<span class="ce-vc-plus">+</span>')}
        </div>`
      : '';

    // Tone badges
    const tonePY = Array.isArray(step.tones)
      ? step.pinyin
      : step.pinyin;
    const toneBadges = (Array.isArray(step.tones) ? step.tones : [toneNum])
      .map(t => `<span class="ce-tone-badge" style="background:${toneColors[t]}22;border-color:${toneColors[t]};color:${toneColors[t]}">声${t}</span>`)
      .join('');

    // Breakdown
    const breakdown = step.breakdown_ar
      ? `<div class="ce-word-breakdown">🔍 ${step.breakdown_ar}</div>` : '';

    // Example sentence
    const exHTML = step.example
      ? `<div class="ce-word-example">
          <div class="ce-ex-cn">${step.example.cn}</div>
          <div class="ce-ex-py">${step.example.pinyin}</div>
          <div class="ce-ex-ar">${step.example.ar}</div>
        </div>`
      : (step.examples ? step.examples.map(ex => `
          <div class="ce-word-example">
            <div class="ce-ex-cn">${ex.cn}</div>
            <div class="ce-ex-py">${ex.pinyin}</div>
            <div class="ce-ex-ar">${ex.ar}</div>
          </div>`).join('') : '');

    // Usage
    const usageHTML = step.usage_ar
      ? `<div class="ce-usage">💡 ${step.usage_ar}</div>` : '';

    // Memory trick
    const trickHTML = step.trick_ar || step.memory_trick_ar
      ? `<div class="ce-trick">🧠 ${step.trick_ar ?? step.memory_trick_ar}</div>` : '';

    // Tone note
    const toneNoteHTML = step.tone_note_ar
      ? `<div class="ce-note">${step.tone_note_ar}</div>` : '';

    body.innerHTML = `
      <div class="ce-word-card">
        <div class="ce-word-header">
          <div class="ce-word-cn">${step.cn}</div>
          <div class="ce-word-py">${tonePY}</div>
          <div class="ce-word-ar">${step.ar}</div>
          <div class="ce-tone-badges">${toneBadges}</div>
          <div class="ce-word-type">${step.type_ar ?? ''}</div>
        </div>
        ${compHTML}
        ${breakdown}
        ${usageHTML}
        ${exHTML}
        ${toneNoteHTML}
        ${trickHTML}
      </div>`;
    _addNextBtn(footer, 'فهمت! التالي ›');
  }

  function _renderTeachTones(step, body, footer) {
    const toneColors = { 1:'#FF6B7A', 2:'#26D97F', 3:'#1E90FF', 4:'#FFCA40', 0:'#B388FF' };
    const cards = (step.tones ?? []).map(t => `
      <div class="ce-tone-card" style="border-color:${toneColors[t.number]}44">
        <div class="ce-tc-number" style="color:${toneColors[t.number]}">声${t.number}</div>
        <div class="ce-tc-mark" style="color:${toneColors[t.number]}">${t.mark}</div>
        <div class="ce-tc-shape" style="color:${toneColors[t.number]};font-size:22px;font-weight:900">${t.shape_ar}</div>
        <div class="ce-tc-name">${t.name_ar}</div>
        <div class="ce-tc-desc">${t.description_ar}</div>
        <div class="ce-tc-example">
          <span class="ce-tc-cn">${t.example_cn}</span>
          <span class="ce-tc-py">${t.example_pinyin}</span>
          <span class="ce-tc-ar">${t.example_ar}</span>
        </div>
        <div class="ce-tc-trick">🧠 ${t.trick_ar}</div>
      </div>`).join('');

    body.innerHTML = `
      <div class="ce-concept-title">${step.title_ar}</div>
      <div class="ce-tones-grid">${cards}</div>`;
    _addNextBtn(footer, 'حفظت النغمات ›');
  }

  function _renderPracticeMCQ(step, body, footer) {
    const questions = step.questions ?? [];
    let qIdx     = 0;
    let score    = 0;
    let answered = false;

    function renderQ() {
      const q = questions[qIdx];
      if (!q) { finishMCQ(); return; }

      const opts = (q.options_ar ?? []).map((opt, i) => `
        <button class="ce-opt rip" data-idx="${i}">
          <span class="ce-opt-letter">${'ABCD'[i]}</span>${opt}
        </button>`).join('');

      body.innerHTML = `
        <div class="ce-mcq-wrap">
          <div class="ce-mcq-progress">${qIdx + 1} / ${questions.length}</div>
          ${q.cn ? `<div class="ce-mcq-cn">${q.cn}</div>` : ''}
          ${q.pinyin ? `<div class="ce-mcq-py">${q.pinyin}</div>` : ''}
          <div class="ce-mcq-prompt">${q.prompt_ar}</div>
          <div class="ce-opts" id="ce-opts-wrap">${opts}</div>
          <div class="ce-explanation hidden" id="ce-exp"></div>
        </div>`;

      answered = false;
      document.querySelectorAll('.ce-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const chosen = +btn.dataset.idx;
          const correct = chosen === q.answer_index;
          if (correct) score++;
          _stepResults.push(correct);

          document.querySelectorAll('.ce-opt').forEach(b => {
            b.disabled = true;
            if (+b.dataset.idx === q.answer_index) b.classList.add('correct');
            else if (+b.dataset.idx === chosen)     b.classList.add('wrong');
          });

          const exp = document.getElementById('ce-exp');
          exp.textContent = q.explanation_ar ?? '';
          exp.classList.remove('hidden');
          if (navigator.vibrate) navigator.vibrate(correct ? [20] : [40,30,40]);

          // Auto-advance to next question after brief pause
          setTimeout(() => {
            qIdx++;
            renderQ();
          }, 1400);
        });
      });
    }

    function finishMCQ() {
      const pct = Math.round((score / questions.length) * 100);
      body.innerHTML = `
        <div class="ce-mcq-result">
          <div class="ce-result-emoji">${pct >= 70 ? '🎉' : '💪'}</div>
          <div class="ce-result-score">${score} / ${questions.length}</div>
          <div class="ce-result-label">${pct >= 70 ? 'ممتاز يا حسام!' : 'واصل التدريب!'}</div>
        </div>`;
      _addNextBtn(footer);
    }

    _pendingValidate = () => true; // MCQ handles its own flow
    renderQ();
    footer.innerHTML = ''; // hide footer during MCQ (auto-advances)
  }

  function _renderPracticeMatch(step, body, footer) {
    const pairs = step.pairs ?? [];
    const shuffledRight = [...pairs].sort(() => Math.random() - 0.5);
    let selected = null;
    let matched  = 0;

    body.innerHTML = `
      <div class="ce-match-title">${step.title_ar}</div>
      ${step.instruction_ar ? `<div class="ce-match-inst">${step.instruction_ar}</div>` : ''}
      <div class="ce-match-grid">
        <div class="ce-match-col" id="ce-match-left">
          ${pairs.map((p, i) => `
            <button class="ce-match-btn left rip" data-idx="${i}" data-side="left">
              <span class="ce-match-cn">${p.cn}</span>
              <span class="ce-match-py">${p.pinyin ?? ''}</span>
            </button>`).join('')}
        </div>
        <div class="ce-match-col" id="ce-match-right">
          ${shuffledRight.map((p, i) => {
            const origIdx = pairs.indexOf(p);
            return `<button class="ce-match-btn right rip" data-orig="${origIdx}" data-side="right">
              ${p.right_ar ?? p.ar}
            </button>`;
          }).join('')}
        </div>
      </div>`;

    function handleClick(btn) {
      if (btn.classList.contains('matched')) return;
      if (!selected) {
        if (btn.dataset.side === 'left') {
          document.querySelectorAll('.ce-match-btn.selected').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          selected = btn;
        }
        return;
      }
      if (btn.dataset.side === 'left') {
        document.querySelectorAll('.ce-match-btn.selected').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selected = btn;
        return;
      }
      // Attempt match
      const leftIdx  = +selected.dataset.idx;
      const rightOrig = +btn.dataset.orig;
      const correct  = leftIdx === rightOrig;

      if (correct) {
        selected.classList.add('matched');
        btn.classList.add('matched');
        matched++;
        _stepResults.push(true);
        if (navigator.vibrate) navigator.vibrate([20]);
        if (matched === pairs.length) {
          setTimeout(() => _addNextBtn(footer), 400);
        }
      } else {
        selected.classList.add('wrong-flash');
        btn.classList.add('wrong-flash');
        _stepResults.push(false);
        setTimeout(() => {
          selected?.classList.remove('wrong-flash', 'selected');
          btn.classList.remove('wrong-flash');
        }, 600);
      }
      selected = null;
    }

    document.querySelectorAll('.ce-match-btn').forEach(btn => {
      btn.addEventListener('click', () => handleClick(btn));
    });

    _pendingValidate = () => true; // Match handles own completion
    footer.innerHTML = ''; // revealed after all pairs matched
  }

  function _renderPracticeBuild(step, body, footer) {
    const target   = step.target ?? {};
    const wordBank = [...(step.word_bank ?? [])].sort(() => Math.random() - 0.5);
    let built      = [];  // array of word bank indices in order chosen

    body.innerHTML = `
      <div class="ce-build-wrap">
        <div class="ce-build-title">${step.title_ar}</div>
        <div class="ce-build-inst">${step.instruction_ar ?? ''}</div>
        <div class="ce-build-target-ar">${target.ar}</div>
        <div class="ce-build-stage" id="ce-build-stage">
          <div class="ce-stage-placeholder">اضغط الكلمات أدناه لترتيبها…</div>
        </div>
        <div class="ce-build-bank" id="ce-build-bank">
          ${wordBank.map((w, i) => `
            <button class="ce-bank-word rip" data-i="${i}">
              <span class="ce-bw-cn">${w.cn}</span>
              <span class="ce-bw-py">${w.pinyin}</span>
            </button>`).join('')}
        </div>
        <div class="ce-build-feedback hidden" id="ce-build-fb"></div>
      </div>`;

    function updateStage() {
      const stage = document.getElementById('ce-build-stage');
      if (!built.length) {
        stage.innerHTML = '<div class="ce-stage-placeholder">اضغط الكلمات أدناه لترتيبها…</div>';
        return;
      }
      stage.innerHTML = built.map((i, pos) => `
        <button class="ce-stage-word rip" data-pos="${pos}">
          <span>${wordBank[i].cn}</span>
          <span style="font-size:10px;color:var(--text-3)">${wordBank[i].pinyin}</span>
        </button>`).join('');

      // Tap stage word to remove
      stage.querySelectorAll('.ce-stage-word').forEach(btn => {
        btn.addEventListener('click', () => {
          const pos = +btn.dataset.pos;
          const wi  = built[pos];
          built.splice(pos, 1);
          document.querySelector(`.ce-bank-word[data-i="${wi}"]`)?.classList.remove('used');
          updateStage();
        });
      });
    }

    document.querySelectorAll('.ce-bank-word').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('used')) return;
        btn.classList.add('used');
        built.push(+btn.dataset.i);
        updateStage();
      });
    });

    _pendingValidate = () => false; // block auto-next; check button triggers
    _addCheckBtn(footer, () => {
      const answer   = built.map(i => wordBank[i].cn).join('');
      const correct  = answer === target.cn;
      const fb = document.getElementById('ce-build-fb');
      fb.classList.remove('hidden');
      if (correct) {
        fb.className = 'ce-build-feedback correct';
        fb.innerHTML = `✅ ممتاز! ${target.cn} — ${target.ar}`;
        _stepResults.push(true);
        if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
        setTimeout(() => {
          _pendingValidate = null;
          _nextStep();
        }, 900);
      } else {
        fb.className = 'ce-build-feedback wrong';
        fb.innerHTML = `❌ الترتيب الصحيح: <strong>${target.cn}</strong> (${target.ar})`;
        _stepResults.push(false);
        // Reset stage
        setTimeout(() => {
          built = [];
          document.querySelectorAll('.ce-bank-word').forEach(b => b.classList.remove('used'));
          updateStage();
          fb.classList.add('hidden');
        }, 2000);
      }
    });
  }

  function _renderSummary(step, body, footer) {
    const badge = step.badge_unlocked;
    const words = step.new_words ?? [];

    body.innerHTML = `
      <div class="ce-summary-wrap">
        <div class="ce-sum-title">${step.title_ar}</div>
        ${badge ? `<div class="ce-sum-badge">🏅 ${badge.name_ar}</div>` : ''}
        <div class="ce-sum-xp">⭐ +${step.xp_earned ?? 0} نقطة خبرة</div>
        <div class="ce-sum-points">
          ${(step.points_ar ?? []).map(p => `<div class="ce-sum-point">✓ ${p}</div>`).join('')}
        </div>
        ${words.length ? `
          <div class="ce-sum-words-title">الكلمات الجديدة:</div>
          <div class="ce-sum-words">
            ${words.map(w => `<span class="ce-sum-word">${w}</span>`).join('')}
          </div>` : ''}
      </div>`;

    _addNextBtn(footer, 'إلى الدرس التالي ›');

    // Award XP
    if (step.xp_earned && window.BM?.ProgressManager) {
      const pm = window.BM.ProgressManager;
      pm.completeLesson?.(_activeLesson.id);
    }
  }

  // ── 9. Footer button helpers ─────────────────────────────────
  function _addNextBtn(footer, label = 'التالي ›') {
    footer.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'cta-btn cta-primary rip';
    btn.textContent = label;
    // Use direct reference — avoids getElementById race and duplicate-ID issues
    btn.addEventListener('pointerdown', e => { e.preventDefault(); _nextStep(); });
    footer.appendChild(btn);
  }

  function _addCheckBtn(footer, onCheck) {
    footer.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'cta-btn cta-primary rip';
    btn.textContent = 'تحقق ✓';
    btn.addEventListener('pointerdown', e => { e.preventDefault(); onCheck(); });
    footer.appendChild(btn);
  }

  // ── 10. Unit overview ─────────────────────────────────────────
  async function openUnit(unitId) {
    const cur = _curriculum ?? await loadCurriculum();
    if (!cur) return;
    const unit = cur.units.find(u => u.id === unitId);
    if (!unit) return;

    // Build or reuse unit overview overlay
    let ov = document.getElementById('overlay-unit');
    if (!ov) {
      ov = document.createElement('div');
      ov.id        = 'overlay-unit';
      ov.className = 'overlay';
      document.body.appendChild(ov);
    }

    ov.innerHTML = `
      <div class="overlay-header">
        <button class="overlay-close rip" id="unit-close">✕</button>
        <div style="flex:1">
          <div class="overlay-title">${unit.icon} ${unit.title_ar}</div>
          <div class="overlay-sub">${unit.title_zh}</div>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px">
        <div class="ce-unit-hook">${unit.hook_ar}</div>
        <div class="ce-unit-lessons">
          ${unit.lessons.map(l => {
            const done = isLessonComplete(unit.id, l.id);
            return `
              <div class="ce-unit-lesson-row rip" data-uid="${unit.id}" data-lid="${l.id}">
                <div class="ce-ul-icon">${done ? '✅' : '○'}</div>
                <div class="ce-ul-body">
                  <div class="ce-ul-key">${l.key}</div>
                  <div class="ce-ul-title">${l.title_ar}</div>
                  <div class="ce-ul-sub">${l.subtitle_ar ?? ''}</div>
                </div>
                <div class="ce-ul-xp">+${l.xp} XP</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;

    ov.classList.add('open');
    document.getElementById('unit-close').addEventListener('click', () => {
      ov.classList.remove('open');
    });
    ov.querySelectorAll('.ce-unit-lesson-row').forEach(row => {
      row.addEventListener('click', () => {
        ov.classList.remove('open');
        openLesson(row.dataset.uid, row.dataset.lid);
      });
    });
  }

  // ── 11. Utilities ─────────────────────────────────────────────
  function _mdToHtml(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function _renderDialogueHtml(lines) {
    return `<div class="ce-dialogue">
      ${lines.map(l => `
        <div class="ce-dl-line ${l.speaker === 'A' ? 'dl-a' : 'dl-b'}">
          <div class="ce-dl-speaker">${l.speaker}</div>
          <div class="ce-dl-content">
            <div class="ce-dl-cn">${l.cn}</div>
            <div class="ce-dl-py">${l.pinyin}</div>
            <div class="ce-dl-ar">${l.ar}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  function _toast(msg) {
    if (typeof toast === 'function') toast(msg);
    else console.warn('[CE]', msg);
  }

  // ── 12. Public API ────────────────────────────────────────────
  return {
    loadCurriculum,
    openUnit,
    openLesson,
    isLessonComplete,
    getCurrentProgress,
  };

})();

window.BM = window.BM ?? {};
window.BM.Curriculum = CurriculumEngine;
