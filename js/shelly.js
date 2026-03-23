/**
 * ================================================================
 *  BLUE MANDARIN — ShellyAI  (js/shelly.js)
 *
 *  Wraps the Gemini 1.5 Flash REST API with:
 *    · AbortController timeout (12 s)
 *    · Offline detection before the request is even issued
 *    · Typed error branches: offline / timeout / rate-limit / HTTP / TypeError
 *    · Arabic + English fallback messages for each failure mode
 *    · Rotating conversation history (last 10 turns) for context
 *    · API-key and unconfigured-key guards
 * ================================================================
 */

const ShellyAI = (() => {

  // ── 1. Configuration ─────────────────────────────────────────
  //
  //  Replace [YOUR_API_KEY] with your Gemini API key.
  //  ⚠ SECURITY NOTE: Exposing an API key in client-side JS is only
  //  acceptable for local development. For production, proxy all
  //  Gemini calls through your own backend endpoint so the key
  //  stays server-side and never reaches the browser bundle.
  //
  const API_KEY  = '[YOUR_API_KEY]';
  const MODEL    = 'gemini-1.5-flash';
  const API_URL  = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const TIMEOUT_MS     = 12_000;  // 12 seconds before aborting
  const MAX_HISTORY    = 10;      // keep the last 10 turns (5 exchanges)
  const MAX_OUT_TOKENS = 512;     // keeps responses mobile-friendly

  // ── 2. System prompt ─────────────────────────────────────────
  //
  //  Injected as the first user/model exchange so Gemini Flash
  //  understands the persona before the real conversation starts.
  //
  const SYSTEM_PROMPT = `
You are Shelly (شيلي), the AI Mandarin tutor mascot of "Blue Mandarin" —
a winter-themed PWA for learning HSK 1 Mandarin (Version 3.0, 160 words).

Your student is Hossam, from Egypt. He is an Arabic speaker learning Mandarin.

Your personality rules:
1. Warm, patient, and encouraging — like a friendly teacher on a snowy day.
2. Keep every reply short and mobile-friendly (≤ 4 short paragraphs or ≤ 200 words).
3. For every Chinese term you mention, always show: 汉字 (pīnyīn) = English meaning.
4. Sprinkle encouraging Arabic phrases naturally:
   "ممتاز يا حسام!" · "استمر!" · "أنت رائع!" · "بالتوفيق!"
5. When explaining grammar, draw analogies to Arabic/Egyptian culture where helpful.
6. Only teach verified HSK 1 vocabulary — never fabricate characters or tones.
7. Tone: calm and clear, like a crisp winter morning. Never rushed.
`.trim();

  // ── 3. Arabic + English failure messages ─────────────────────
  //
  //  Each mode has its own set of messages so responses feel varied
  //  and contextually appropriate, not repetitive.
  //
  const FALLBACKS = {

    offline: [
      '❄️ أحتاج اتصالاً بالإنترنت لأفكر يا حسام!\nI need an internet connection to think! Come back online and I\'ll be right here — في أقرب وقت! 🌊',
      '🌨️ يبدو أنني في عاصفة ثلجية الآن!\nI\'m caught in a snowstorm — no connection detected. While you\'re offline, review your flashcards! 📖',
      '🐚 شيلي غير متصلة الآن يا حسام!\nShelly is offline right now. Practice the words you already know — أنت قادر! 💪',
    ],

    timeout: [
      '⌛ استغرق الأمر وقتاً طويلاً يا حسام!\nShelly timed out after 12 seconds. Check your connection and try again — حاول مرة أخرى! ❄️',
      '⏳ الاستجابة بطيئة جداً هذه المرة!\nThe server is taking too long. A slow connection may be the cause — جرب مجدداً! 🌐',
    ],

    rateLimit: [
      '⏳ Shelly is catching her breath!\nطلبات كثيرة يا حسام — please wait a moment then try again. (Rate limited) 🌊',
    ],

    fetchError: [
      '📡 الاتصال بالخادم فشل يا حسام.\nI couldn\'t reach the Gemini server. This can happen if the Service Worker intercepted the request unexpectedly — تحقق من الاتصال! 🔧',
      '❄️ أحتاج اتصالاً بالإنترنت لأفكر يا حسام!\nConnection to the AI server failed. Check your network and try again — في أقرب وقت! 🌊',
    ],

    notConfigured: [
      '🔑 مفتاح API غير مُعدَّل بعد يا حسام!\nThe Gemini API key has not been set. Open `js/shelly.js` and replace `[YOUR_API_KEY]` with your real key to activate me. Until then — keep practising your flashcards! 📖❄️',
    ],

    generic: [
      '🐚 حدث خطأ غير متوقع يا حسام!\nSomething unexpected went wrong on my end. Please try again in a moment — معلش! ❄️',
    ],
  };

  // Round-robin counters per category so messages cycle rather than repeat
  const _counters = {};

  function _pickFallback(category) {
    const pool = FALLBACKS[category] ?? FALLBACKS.generic;
    _counters[category] = ((_counters[category] ?? 0) + 1) % pool.length;
    return pool[_counters[category]];
  }

  // ── 4. Conversation history ───────────────────────────────────
  let _history = []; // Array of { role: 'user'|'model', parts: [{ text }] }

  // ── 5. Request builder ────────────────────────────────────────

  /**
   * Constructs the full Gemini `contents` array, inserting:
   *   1. A system-context exchange (user prompt + model acknowledgement)
   *   2. Up to MAX_HISTORY recent turns from the conversation
   *   3. The new user message
   */
  function _buildRequestBody(userMessage) {
    const contents = [
      // System context injected as a synthetic turn
      {
        role:  'user',
        parts: [{ text: `[CONTEXT]\n${SYSTEM_PROMPT}` }],
      },
      {
        role:  'model',
        parts: [{ text: 'Understood! I\'m Shelly, Blue Mandarin\'s AI tutor. I\'m ready to help Hossam learn HSK 1. 你好！❄️' }],
      },
      // Recent history (bounded to avoid token overflow)
      ..._history.slice(-MAX_HISTORY),
      // New user turn
      { role: 'user', parts: [{ text: userMessage }] },
    ];

    return {
      contents,
      generationConfig: {
        temperature:     0.75,
        topK:            40,
        topP:            0.95,
        maxOutputTokens: MAX_OUT_TOKENS,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    };
  }

  // ── 6. Response parser ────────────────────────────────────────

  function _extractText(responseData) {
    // Surface any API-level error object
    if (responseData.error) {
      throw new Error(`Gemini error ${responseData.error.code}: ${responseData.error.message}`);
    }

    const candidate = responseData.candidates?.[0];
    if (!candidate) throw new Error('No candidates in response.');

    // Content was blocked by safety filters
    if (candidate.finishReason === 'SAFETY') {
      return '🐚 I couldn\'t answer that safely, Hossam. Please ask me about Mandarin learning! 📖';
    }

    const text = candidate.content?.parts
      ?.map(p => p.text ?? '')
      .join('')
      .trim();

    if (!text) throw new Error('Empty text in response.');
    return text;
  }

  // ── 7. Fetch with AbortController timeout ────────────────────

  function _fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  // ── 8. Response shape ─────────────────────────────────────────
  //
  //  Every public method resolves with this object so the UI
  //  can handle errors uniformly without catching exceptions.
  //
  //  { text: string, error: boolean, errorType: string|null }
  //
  function _ok(text) {
    return { text, error: false, errorType: null };
  }

  function _err(category) {
    return { text: _pickFallback(category), error: true, errorType: category };
  }

  // ── 9. Public API ─────────────────────────────────────────────
  return {

    /**
     * Sends `userMessage` to Gemini 1.5 Flash and resolves with the
     * AI reply. Never rejects — all failure paths return a friendly
     * fallback message in Arabic + English instead.
     *
     * @param   {string}  userMessage
     * @returns {Promise<{ text: string, error: boolean, errorType: string|null }>}
     */
    async talkToShelly(userMessage) {
      if (!userMessage?.trim()) {
        return _ok('(Empty message — please type something first!)');
      }

      // ── Guard: API key not configured ──────────────────────
      if (API_KEY === '[YOUR_API_KEY]') {
        return _err('notConfigured');
      }

      // ── Guard: device is offline ────────────────────────────
      if (!navigator.onLine) {
        return _err('offline');
      }

      const body = JSON.stringify(_buildRequestBody(userMessage));

      try {
        const response = await _fetchWithTimeout(API_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        // ── HTTP error branches ─────────────────────────────
        if (!response.ok) {
          if (response.status === 429) return _err('rateLimit');

          // Try to surface the Gemini error message
          const errBody = await response.json().catch(() => ({}));
          const msg     = errBody.error?.message ?? `HTTP ${response.status}`;
          throw new Error(msg);
        }

        // ── Happy path ──────────────────────────────────────
        const data = await response.json();
        const text = _extractText(data);

        // Persist this exchange to history
        _history.push({ role: 'user',  parts: [{ text: userMessage }] });
        _history.push({ role: 'model', parts: [{ text }] });

        // Trim history to stay within token budget
        if (_history.length > MAX_HISTORY * 2) {
          _history = _history.slice(-MAX_HISTORY * 2);
        }

        return _ok(text);

      } catch (err) {

        // ── AbortError → timeout ────────────────────────────
        if (err.name === 'AbortError') {
          console.warn('[ShellyAI] Request aborted (timeout).');
          return _err('timeout');
        }

        // ── TypeError: Failed to fetch
        //    Root causes: Service Worker intercepted the POST and
        //    returned a non-OK response, network dropped mid-request,
        //    CORS pre-flight failure, DNS failure, etc.
        if (err instanceof TypeError) {
          console.error('[ShellyAI] TypeError (Failed to fetch):', err.message);
          return _err('fetchError');
        }

        // ── All other errors ────────────────────────────────
        console.error('[ShellyAI] Unexpected error:', err);
        return _err('generic');
      }
    },

    /**
     * Returns a curated offline study tip without calling the API.
     * Useful as a friendly first-load message when the key is not yet set.
     */
    getStudyTip() {
      const TIPS = [
        'بالتوفيق يا حسام! 🎵 Mandarin has 4 tones: flat (ā), rising (á), dipping (ǎ), and falling (à). Tone 3 dips before rising — like a question in Arabic!',
        '好 (hǎo) means "good". It combines 女 (woman) + 子 (child) — a mother with her child. Beautiful, right? 👨‍👩‍👧',
        '的 (de) works like the Arabic possessive marker. 我的书 = My book — literally "I de book". Easy! 📚',
        'ممتاز يا حسام! The word 你好 is just 你 (you) + 好 (good). Saying hello in Chinese literally means "You good!" 😊',
        'Practice tip: Write each character 5 times. Your hand memory will do the rest — الممارسة تصنع الإتقان! ✍️',
      ];
      const i = Math.floor(Math.random() * TIPS.length);
      return _ok(TIPS[i]);
    },

    /** Clears the in-memory conversation history (e.g. "New Chat" button). */
    clearHistory() {
      _history = [];
    },

    /** Returns the number of completed exchanges (user + model pairs). */
    getTurnCount() {
      return Math.floor(_history.length / 2);
    },
  };

})();

window.BM = window.BM || {};
window.BM.ShellyAI = ShellyAI;
