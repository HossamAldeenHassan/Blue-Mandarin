/**
 * ================================================================
 *  BLUE MANDARIN — ProgressManager  (js/progress.js)
 *  All user state lives in localStorage.
 *  A sync-queue persists deltas for Background Sync (sw.js).
 * ================================================================
 */

const ProgressManager = (() => {

  // ── 1. Storage key constants ─────────────────────────────────
  const KEYS = {
    profile:       'bm:profile',
    progress:      'bm:progress',
    syncQueue:     'bm:sync_queue',
    lastSynced:    'bm:last_synced',
    // Content-complete additions (Phase 3.5+)
    storyProgress: 'bm:story_progress',  // {storyNumber: {read, quizAttempts:[{date,score,total,passed}]}}
    grammarQuiz:   'bm:grammar_quiz',    // {grammarId: {attempts:[{date,score}]}}
    lessonProgress:'bm:lesson_progress', // {lessonId: {vocabSeen, dialogueRead, sentencesDone, completed}}
  };

  // ── 2. Default state shapes ───────────────────────────────────

  const DEFAULT_PROFILE = {
    name:         'Hossam',          // ← personalised for our learner
    country:      'Egypt',
    level:        1,
    xp:           0,
    streakDays:   0,
    lastActivity: null,              // ISO date string of last session
    joinedAt:     new Date().toISOString(),
  };

  const DEFAULT_PROGRESS = {
    seenWords:        [],            // word IDs the user has viewed at least once
    masteredWords:    [],            // word IDs answered correctly ≥ 3 times
    completedLessons: [],            // lesson IDs fully completed
    testAttempts:     [],            // array of { date, score, total, timeSec, passed }
    questionStats:    {},            // { [wordId]: { correct: N, attempts: N } }
    dailyChallenges:  [],            // ISO date strings (YYYY-MM-DD) of completed days
  };

  // ── 3. localStorage helpers ───────────────────────────────────

  function _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn(`[ProgressManager] Read error for "${key}":`, e);
      return fallback;
    }
  }

  function _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // QuotaExceededError or similar — degrade gracefully
      console.error(`[ProgressManager] Write error for "${key}":`, e);
      return false;
    }
  }

  // ── 4. Sync queue helpers ─────────────────────────────────────

  /**
   * Appends a delta event to the persistent sync queue.
   * When the Service Worker fires a "sync-progress" Background Sync
   * event, flushSyncQueue() drains this array and ships it to a server.
   */
  function _enqueue(delta) {
    const queue = _read(KEYS.syncQueue, []);
    queue.push({ ...delta, ts: new Date().toISOString() });
    _write(KEYS.syncQueue, queue);

    // Ask the SW to schedule a background sync if online
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready
        .then(reg => reg.sync.register('sync-progress'))
        .catch(() => {/* Background Sync not available — queue persists until flush */});
    }
  }

  // ── 5. XP & level helpers ─────────────────────────────────────

  const XP_PER_LEVEL = 300; // XP needed to level up

  /**
   * Calculates XP reward for a single correct answer.
   * First-time bonus: +5. Active-streak bonus: +2 per day, capped at +20.
   */
  function _calcXP(isFirstTime, streak) {
    return 10 + (isFirstTime ? 5 : 0) + Math.min(streak * 2, 20);
  }

  /** Applies XP, checks for level-up, and saves the updated profile. */
  function _applyXP(profile, amount) {
    profile.xp += amount;
    while (profile.xp >= profile.level * XP_PER_LEVEL) {
      profile.xp    -= profile.level * XP_PER_LEVEL;
      profile.level +=  1;
    }
    return profile;
  }

  // ── 6. Streak helpers ─────────────────────────────────────────

  /**
   * Computes today's ISO date string (YYYY-MM-DD).
   * Avoids timezone edge-cases by using local date parts.
   */
  function _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  /** Updates streakDays and lastActivity based on the current date. */
  function _tickStreak(profile) {
    const today     = _today();
    const lastDate  = profile.lastActivity ? profile.lastActivity.split('T')[0] : null;

    if (lastDate === today) return profile; // already active today — no change

    const d = new Date();
    const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
      .toISOString().split('T')[0];

    // Streak continues if the last activity was yesterday; otherwise reset to 1
    profile.streakDays  = (lastDate === yesterday) ? profile.streakDays + 1 : 1;
    profile.lastActivity = new Date().toISOString();
    return profile;
  }

  // ── 7. Public API ─────────────────────────────────────────────
  return {

    // ───── Profile ─────────────────────────────────────────────

    getProfile() {
      return _read(KEYS.profile, { ...DEFAULT_PROFILE });
    },

    /** Merges a partial patch into the stored profile. */
    saveProfile(patch = {}) {
      const profile = { ...this.getProfile(), ...patch };
      _write(KEYS.profile, profile);
      _enqueue({ type: 'PROFILE_UPDATE', patch });
      return profile;
    },

    // ───── Progress ────────────────────────────────────────────

    getProgress() {
      return _read(KEYS.progress, { ...DEFAULT_PROGRESS });
    },

    _saveProgress(p) {
      return _write(KEYS.progress, p);
    },

    // ───── Flashcard / Word interactions ───────────────────────

    /**
     * Records that a flashcard has been shown to the user.
     * Called when the card is first displayed, regardless of outcome.
     */
    markWordSeen(wordId) {
      const p = this.getProgress();
      if (!p.seenWords.includes(wordId)) {
        p.seenWords.push(wordId);
        this._saveProgress(p);
        _enqueue({ type: 'WORD_SEEN', wordId });
      }
    },

    /**
     * Records a correct self-assessment on a flashcard.
     * Returns the XP earned and whether the word is newly mastered.
     *
     * @param {number} wordId
     * @returns {{ xpEarned: number, mastered: boolean, levelUp: boolean }}
     */
    markWordCorrect(wordId) {
      const p        = this.getProgress();
      const oldLevel = this.getProfile().level;

      // Update per-word stats
      p.questionStats[wordId] = p.questionStats[wordId] ?? { correct: 0, attempts: 0 };
      const stat       = p.questionStats[wordId];
      const firstTime  = stat.attempts === 0;
      stat.correct++;
      stat.attempts++;

      // Mastery threshold: 3 correct answers
      const mastered = stat.correct >= 3 && !p.masteredWords.includes(wordId);
      if (mastered) p.masteredWords.push(wordId);
      this._saveProgress(p);

      // Update profile XP + streak
      let profile  = _tickStreak(this.getProfile());
      const xp     = _calcXP(firstTime, profile.streakDays);
      profile      = _applyXP(profile, xp);
      _write(KEYS.profile, profile);

      _enqueue({ type: 'WORD_CORRECT', wordId, mastered });
      return { xpEarned: xp, mastered, levelUp: profile.level > oldLevel };
    },

    /**
     * Records an incorrect self-assessment on a flashcard.
     * No XP awarded; the word stays in the review pool.
     */
    markWordIncorrect(wordId) {
      const p = this.getProgress();
      p.questionStats[wordId] = p.questionStats[wordId] ?? { correct: 0, attempts: 0 };
      p.questionStats[wordId].attempts++;
      // Remove from mastered if previously marked (regression)
      p.masteredWords = p.masteredWords.filter(id => id !== wordId);
      this._saveProgress(p);
      _enqueue({ type: 'WORD_INCORRECT', wordId });
    },

    // ───── Lessons ─────────────────────────────────────────────

    /**
     * Marks a lesson as completed and awards a 50 XP bonus.
     * @returns {{ xpEarned: number, alreadyDone: boolean }}
     */
    completeLesson(lessonId) {
      const p = this.getProgress();
      if (p.completedLessons.includes(lessonId)) {
        return { xpEarned: 0, alreadyDone: true };
      }

      p.completedLessons.push(lessonId);
      this._saveProgress(p);

      let profile = _tickStreak(this.getProfile());
      profile     = _applyXP(profile, 50);
      _write(KEYS.profile, profile);
      _enqueue({ type: 'LESSON_COMPLETE', lessonId });

      return { xpEarned: 50, alreadyDone: false };
    },

    // ───── Tests ───────────────────────────────────────────────

    /**
     * Persists a completed test result.
     *
     * @param {{ score: number, total: number, timeSec: number,
     *           answers: Array<{ wordId: number, correct: boolean }> }} result
     * @returns {{ xpEarned: number, passed: boolean, levelUp: boolean }}
     */
    saveTestAttempt(result) {
      const p        = this.getProgress();
      const oldLevel = this.getProfile().level;
      // Guard: coerce to numbers, protect against NaN and division-by-zero
      const score    = Number.isFinite(+result.score) ? +result.score : 0;
      const total    = Number.isFinite(+result.total) && +result.total > 0 ? +result.total : 1;
      const ratio    = score / total;
      const passed   = ratio >= 0.6;
      // 10 XP per correct answer, max 200 — always an integer, never NaN
      const xpEarned = Math.max(0, Math.round(ratio * 200));

      // Persist the attempt summary
      p.testAttempts.push({
        date:    new Date().toISOString(),
        score,
        total,
        timeSec: result.timeSec ?? 0,
        passed,
      });

      // Update per-question stats from the answers array
      (result.answers ?? []).forEach(({ wordId, correct }) => {
        p.questionStats[wordId] = p.questionStats[wordId] ?? { correct: 0, attempts: 0 };
        p.questionStats[wordId].attempts++;
        if (correct) p.questionStats[wordId].correct++;
      });

      this._saveProgress(p);

      let profile = _tickStreak(this.getProfile());
      profile     = _applyXP(profile, xpEarned);
      _write(KEYS.profile, profile);
      _enqueue({ type: 'TEST_ATTEMPT', score, total, passed });

      return { xpEarned, passed, levelUp: profile.level > oldLevel };
    },

    // ───── Daily challenge ─────────────────────────────────────

    isDailyChallengeComplete() {
      return this.getProgress().dailyChallenges.includes(_today());
    },

    completeDailyChallenge() {
      const t = _today();
      const p = this.getProgress();
      if (p.dailyChallenges.includes(t)) return false;

      p.dailyChallenges.push(t);
      this._saveProgress(p);

      let profile = _tickStreak(this.getProfile());
      profile     = _applyXP(profile, 50);
      _write(KEYS.profile, profile);
      _enqueue({ type: 'DAILY_CHALLENGE', date: t });
      return true;
    },

    // ───── Aggregated stats (for the UI) ───────────────────────

    /**
     * Returns a single, flat stats object ready to bind to the UI.
     * Call this whenever a view needs fresh numbers.
     */
    getStats() {
      const prof = this.getProfile();
      const prog = this.getProgress();
      const best = prog.testAttempts.reduce((b, a) => a.score > b ? a.score : b, 0);

      return {
        name:              prof.name,
        level:             prof.level,
        xp:                prof.xp,
        xpNeeded:          prof.level * XP_PER_LEVEL,
        xpPercent:         Math.round((prof.xp / (prof.level * XP_PER_LEVEL)) * 100),
        streakDays:        prof.streakDays,
        wordsLearned:      prog.seenWords.length,
        wordsMastered:     prog.masteredWords.length,
        lessonsCompleted:  prog.completedLessons.length,
        testAttempts:      prog.testAttempts.length,
        bestTestScore:     best,
        dailyDone:         this.isDailyChallengeComplete(),
        syncPending:       this.peekSyncQueue().length,
      };
    },

    // ───── Sync queue ──────────────────────────────────────────

    /** Called by the Service Worker sync handler — drains the queue. */
    flushSyncQueue() {
      const q = _read(KEYS.syncQueue, []);
      _write(KEYS.syncQueue, []);
      _write(KEYS.lastSynced, new Date().toISOString());
      console.log(`[ProgressManager] Flushed ${q.length} queued events.`);
      return q;
    },

    peekSyncQueue() {
      return _read(KEYS.syncQueue, []);
    },

    getLastSyncedAt() {
      return _read(KEYS.lastSynced, null);
    },

    // ───── Story progress ──────────────────────────────────────

    /**
     * Returns the full story progress map.
     * {storyNumber: {read:bool, quizAttempts:[{date,score,total,passed}]}}
     */
    getStoryProgress() {
      return _read(KEYS.storyProgress, {});
    },

    /** Marks a story as read (paragraphs completed). */
    markStoryRead(storyNumber) {
      const sp = this.getStoryProgress();
      sp[storyNumber] = sp[storyNumber] ?? { read: false, quizAttempts: [] };
      if (!sp[storyNumber].read) {
        sp[storyNumber].read = true;
        _write(KEYS.storyProgress, sp);
        // Award 20 XP for reading a story
        let profile = _tickStreak(this.getProfile());
        profile     = _applyXP(profile, 20);
        _write(KEYS.profile, profile);
        _enqueue({ type: 'STORY_READ', storyNumber });
      }
      return sp[storyNumber];
    },

    /**
     * Saves a story quiz attempt and awards XP.
     * @param {number} storyNumber
     * @param {number} score        — correct answers
     * @param {number} total        — total questions
     * @param {Array}  answers      — [{questionId, correct}]
     * @returns {{ xpEarned:number, passed:boolean }}
     */
    saveStoryQuizAttempt(storyNumber, score, total, answers = []) {
      const passed   = total > 0 && (score / total) >= 0.6;
      const xpEarned = Math.round((score / Math.max(total, 1)) * 30); // max 30 XP

      const sp = this.getStoryProgress();
      sp[storyNumber] = sp[storyNumber] ?? { read: false, quizAttempts: [] };
      sp[storyNumber].quizAttempts.push({
        date: new Date().toISOString(), score, total, passed,
      });
      _write(KEYS.storyProgress, sp);

      let profile = _tickStreak(this.getProfile());
      profile     = _applyXP(profile, xpEarned);
      _write(KEYS.profile, profile);
      _enqueue({ type: 'STORY_QUIZ', storyNumber, score, total, passed });

      return { xpEarned, passed };
    },

    isStoryRead(storyNumber) {
      return !!(this.getStoryProgress()[storyNumber]?.read);
    },

    getBestStoryQuizScore(storyNumber) {
      const attempts = this.getStoryProgress()[storyNumber]?.quizAttempts ?? [];
      return attempts.reduce((best, a) => a.score > best ? a.score : best, 0);
    },

    // ───── Grammar quiz progress ───────────────────────────────

    /**
     * Returns grammar quiz progress map.
     * {grammarId: {attempts:[{date,score,total}]}}
     */
    getGrammarProgress() {
      return _read(KEYS.grammarQuiz, {});
    },

    /**
     * Saves a single grammar rule quiz attempt.
     * @param {number} grammarId
     * @param {number} score
     * @param {number} total
     * @returns {{ xpEarned:number }}
     */
    saveGrammarQuizAttempt(grammarId, score, total) {
      const xpEarned = Math.round((score / Math.max(total, 1)) * 20); // max 20 XP
      const gp = this.getGrammarProgress();
      gp[grammarId] = gp[grammarId] ?? { attempts: [] };
      gp[grammarId].attempts.push({ date: new Date().toISOString(), score, total });
      _write(KEYS.grammarQuiz, gp);

      let profile = _tickStreak(this.getProfile());
      profile     = _applyXP(profile, xpEarned);
      _write(KEYS.profile, profile);
      _enqueue({ type: 'GRAMMAR_QUIZ', grammarId, score, total });
      return { xpEarned };
    },

    // ───── Lesson detail progress ──────────────────────────────

    /**
     * Returns per-lesson detail progress.
     * {lessonId: {vocabSeen:N, dialogueRead:bool, sentencesDone:N, completed:bool}}
     */
    getLessonDetailProgress() {
      return _read(KEYS.lessonProgress, {});
    },

    _ensureLesson(lessonId) {
      const lp = this.getLessonDetailProgress();
      lp[lessonId] = lp[lessonId] ?? {
        vocabSeen: 0, dialogueRead: false, sentencesDone: 0, completed: false
      };
      return lp;
    },

    markDialogueRead(lessonId) {
      const lp = this._ensureLesson(lessonId);
      lp[lessonId].dialogueRead = true;
      _write(KEYS.lessonProgress, lp);
      let profile = _tickStreak(this.getProfile());
      profile = _applyXP(profile, 5);
      _write(KEYS.profile, profile);
    },

    updateVocabSeen(lessonId, count) {
      const lp = this._ensureLesson(lessonId);
      lp[lessonId].vocabSeen = Math.max(lp[lessonId].vocabSeen, count);
      _write(KEYS.lessonProgress, lp);
    },

    updateSentencesDone(lessonId, count) {
      const lp = this._ensureLesson(lessonId);
      lp[lessonId].sentencesDone = Math.max(lp[lessonId].sentencesDone, count);
      _write(KEYS.lessonProgress, lp);
    },

    // ───── Extended stats ──────────────────────────────────────

    /**
     * Returns the extended stats object, including story/grammar progress.
     * Supersedes the base getStats() — UI should call this one.
     */
    getFullStats() {
      const base      = this.getStats();
      const sp        = this.getStoryProgress();
      const gp        = this.getGrammarProgress();
      const storiesRead    = Object.values(sp).filter(s => s.read).length;
      const storiesPassed  = Object.values(sp).filter(s =>
        s.quizAttempts?.some(a => a.passed)).length;
      const grammarPractised = Object.keys(gp).length;
      return { ...base, storiesRead, storiesPassed, grammarPractised };
    },

    // ───── Debug helpers ───────────────────────────────────────

    /** Wipes ALL stored progress (use during development only). */
    __hardReset() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      console.warn('[ProgressManager] Hard reset complete. All data cleared.');
    },
  };

})();

window.BM = window.BM || {};
window.BM.ProgressManager = ProgressManager;
