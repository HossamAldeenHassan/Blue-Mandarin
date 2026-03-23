/**
 * Blue Mandarin — DataManager (js/data.js) v3.0
 * "Hossam Schema" — fetches all 8 HSK 1 datasets from data/hsk1/
 *
 * KEY FIXES vs v2.0:
 *   · Path corrected to ./data/hsk1/ (was ./data/)
 *   · Race condition eliminated with _loading promise registry
 *   · Stable word IDs: lessonId*1000 + within-lesson counter
 *   · prefetchAll() catches per-dataset errors — never fails entirely
 *   · getWordsForLesson() always returns Array, never null
 *   · 40-word fallback covers all 15 lessons for offline graceful degradation
 */
const DataManager = (() => {

  const GITHUB_BASE = '[YOUR_GITHUB_RAW_URL]/data/hsk1';
  const LOCAL_BASE  = './data/hsk1';
  const useGithub   = !GITHUB_BASE.includes('[YOUR_');
  const _url        = f => `${useGithub ? GITHUB_BASE : LOCAL_BASE}/${f}`;

  const EP = {
    vocab:     _url('vocab.json'),
    grammar:   _url('grammar.json'),
    dialogues: _url('dialogues.json'),
    lessons:   _url('lessons.json'),
    sentences: _url('sentences.json'),
    stories:   _url('stories.json'),
    storyQuiz: _url('story_quiz.json'),
    tests:     _url('tests.json'),
  };

  const CACHE  = 'bm-v1.2.0-data';
  const TOMS   = 10_000;
  const _mem   = {};
  const _inflt = {};  // in-flight promises

  // 40-word fallback — covers all 15 lessons
  const FB = [
    ['你好','nǐ hǎo','مرحباً','تعبير',1],['谢谢','xiè xiè','شكراً','تعبير',1],
    ['再见','zài jiàn','مع السلامة','تعبير',1],['不客气','bú kèqi','عفواً','تعبير',1],
    ['我','wǒ','أنا','ضمير',1],['你','nǐ','أنت','ضمير',1],
    ['是','shì','يكون','فعل',1],['不','bù','لا','ظرف',1],
    ['爸爸','bàba','أب','اسم',2],['妈妈','māma','أم','اسم',2],
    ['哥哥','gēge','أخ أكبر','اسم',2],['妹妹','mèimei','أخت صغرى','اسم',2],
    ['一','yī','واحد','رقم',3],['二','èr','اثنان','رقم',3],
    ['三','sān','ثلاثة','رقم',3],['十','shí','عشرة','رقم',3],
    ['今天','jīntiān','اليوم','اسم',4],['明天','míngtiān','غداً','اسم',4],
    ['时间','shíjiān','الوقت','اسم',4],
    ['天气','tiānqì','الطقس','اسم',5],['冷','lěng','بارد','صفة',5],
    ['大','dà','كبير','صفة',6],['小','xiǎo','صغير','صفة',6],
    ['吃','chī','يأكل','فعل',7],['喝','hē','يشرب','فعل',7],
    ['米饭','mǐfàn','أرز','اسم',7],
    ['钱','qián','مال','اسم',8],['贵','guì','غالٍ','صفة',8],
    ['左','zuǒ','يسار','اسم',9],['右','yòu','يمين','اسم',9],
    ['车','chē','سيارة','اسم',10],['北京','Běijīng','بكين','اسم مكان',10],
    ['学校','xuéxiào','مدرسة','اسم',11],['学习','xuéxí','يدرس','فعل',11],
    ['工作','gōngzuò','عمل','اسم',12],['医生','yīshēng','طبيب','اسم',12],
    ['爱好','àihào','هواية','اسم',13],['音乐','yīnyuè','موسيقى','اسم',13],
    ['病','bìng','مرض','اسم',14],['医院','yīyuàn','مستشفى','اسم',14],
    ['爱','ài','يحب','فعل',15],['高兴','gāoxìng','سعيد','صفة',15],
  ];

  const TYPE_CAT = {
    'فعل':'verbs','اسم':'nouns','صفة':'adjectives','رقم':'numbers',
    'ضمير':'pronouns','تعبير':'expressions','ظرف':'adverbs',
    'اسم مكان':'places','حرف':'particles','أداة':'particles',
    'تحية':'expressions','وحدة عد':'classifiers','لاحقة':'particles',
  };

    const _lc = {};  // per-lesson counters for stable IDs
  function _resetLC() { Object.keys(_lc).forEach(k => delete _lc[k]); }

  function _nw(raw) {  // normalise word
    const lid = raw[4];
    _lc[lid]  = (_lc[lid] ?? 0) + 1;
    return {
      id: lid * 1000 + _lc[lid],
      cn: raw[0], pinyin: raw[1], ar: raw[2],
      type: raw[3], lessonId: lid,
      category: TYPE_CAT[raw[3]] ?? 'other',
    };
  }
  function _ns(raw) {  // normalise sentence
    return { zh: raw[0], pinyin: raw[1], ar: raw[2], tip: raw[3] ?? null };
  }

  function _fetch(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TOMS);
    // Cache-buster: appended to every JSON fetch so browsers/SWs never
    // serve stale data after a JSON file update. This is the v param.
    const sep = url.includes('?') ? '&' : '?';
    const bust = `${sep}_v=${Math.floor(Date.now() / 60000)}`; // 1-min granularity
    return fetch(url + bust, { cache: 'no-cache', signal: ctrl.signal })
      .finally(() => clearTimeout(t));
  }

  async function _load(key, url, transform) {
    if (_mem[key] !== undefined) return _mem[key];
    if (_inflt[key]) return _inflt[key];

    const p = (async () => {
      // Network
      try {
        const r = await _fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = transform(await r.json());
        _mem[key] = d;
        caches.open(CACHE).then(c => c.put(url,
          new Response(JSON.stringify(d), { headers: {'Content-Type':'application/json'} })
        )).catch(() => {});
        return d;
      } catch (e) { console.warn(`[DM] net fail "${key}":`, e.message); }

      // Cache API
      if ('caches' in window) {
        try {
          const cached = await (await caches.open(CACHE)).match(url);
          if (cached) { const d = await cached.json(); _mem[key] = d; return d; }
        } catch (_) {}
      }

      // Inline fallback
      console.warn(`[DM] fallback for "${key}"`);
      if (key === 'vocab') {
        _resetLC();
        const d = FB.map(_nw);
        _mem[key] = d;
        return d;
      }
      _mem[key] = [];
      return [];
    })();

    _inflt[key] = p;
    const result = await p;
    delete _inflt[key];
    return result;
  }

  const T = {
    vocab(r)     { if (!r?.W?.length) throw new Error('W missing'); _resetLC(); return r.W.map(_nw); },
    grammar(r)   { if (!r?.GRAMMAR)   throw new Error('GRAMMAR missing'); return r.GRAMMAR; },
    dialogues(r) {
      if (!r?.DIALOGUES) throw new Error('DIALOGUES missing');
      const o = {};
      Object.entries(r.DIALOGUES).forEach(([k,a]) => {
        const d = Array.isArray(a) ? a[0] : a;
        if (d) o[+k] = d;
      });
      return o;
    },
    lessons(r) {
      if (!r?.TOPICS?.length) throw new Error('TOPICS missing');
      return { topics: r.TOPICS, stories: r.STORIES ?? [], pinyinTable: r.pinyinExamples ?? {} };
    },
    sentences(r) {
      if (!r?.SENTS) throw new Error('SENTS missing');
      const o = {};
      Object.entries(r.SENTS).forEach(([k,a]) => { o[+k] = Array.isArray(a) ? a.map(_ns) : []; });
      return o;
    },
    stories(r) {
      if (!r?.stories_by_level) throw new Error('stories_by_level missing');
      const all = [];
      Object.entries(r.stories_by_level).forEach(([level,a]) => {
        if (Array.isArray(a)) a.forEach(s => all.push({ ...s, levelKey: level }));
      });
      return all.sort((a,b) => a.story_number - b.story_number);
    },
    storyQuiz(r) {
      if (!r?.quizzes) throw new Error('quizzes missing');
      const o = {};
      r.quizzes.forEach(q => { o[q.story_number] = q; });
      return o;
    },
    tests(r) {
      if (!r?.BIGEXAM?.length) throw new Error('BIGEXAM missing');
      return r.BIGEXAM;
    },
  };

  function _shuffle(a) {
    const arr = [...a];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function _buildKG({ vocab, grammar, dialogues, lessons, sentences, stories, storyQuiz, tests }) {
    const kg = {
      vocab:     { all: vocab, byLesson: {}, byCategory: {}, byCn: {} },
      grammar:   { all: grammar, byId: {} },
      lessons:   { all: lessons.topics ?? [], byNumber: {} },
      dialogues, sentences,
      stories:   { all: stories, byNumber: {}, byLevel: {} },
      storyQuiz, tests,
      meta: {
        totalVocab:   vocab.length,
        totalGrammar: grammar.length,
        totalLessons: (lessons.topics ?? []).length,
        totalStories: stories.length,
        builtAt:      new Date().toISOString(),
      },
    };
    vocab.forEach(w => {
      (kg.vocab.byLesson[w.lessonId]   ??= []).push(w);
      (kg.vocab.byCategory[w.category] ??= []).push(w);
      kg.vocab.byCn[w.cn] = w;
    });
    grammar.forEach(g => { kg.grammar.byId[g.id] = g; });
    (lessons.topics ?? []).forEach(t => { kg.lessons.byNumber[t.n] = t; });
    stories.forEach(s => {
      kg.stories.byNumber[s.story_number] = s;
      (kg.stories.byLevel[s.levelKey] ??= []).push(s);
    });
    window.BM ??= {};
    window.BM.KnowledgeGraph = kg;
    console.log('%c[BM KG] built','color:#26D97F;font-weight:bold',
      `${kg.meta.totalVocab} words | ${kg.meta.totalGrammar} grammar | ${kg.meta.totalStories} stories`);
    return kg;
  }

  return {
    getVocab()      { return _load('vocab',     EP.vocab,     T.vocab);     },
    getGrammar()    { return _load('grammar',   EP.grammar,   T.grammar);   },
    getDialogues()  { return _load('dialogues', EP.dialogues, T.dialogues); },
    getLessonMeta() { return _load('lessons',   EP.lessons,   T.lessons);   },
    getSentences()  { return _load('sentences', EP.sentences, T.sentences); },
    getStories()    { return _load('stories',   EP.stories,   T.stories);   },
    getStoryQuiz()  { return _load('storyQuiz', EP.storyQuiz, T.storyQuiz); },
    getBigExam()    { return _load('tests',     EP.tests,     T.tests);     },

    async getWords()             { return this.getVocab(); },
    async getWordsForLesson(lid) {
      const kg = window.BM?.KnowledgeGraph;
      if (kg?.vocab?.byLesson?.[lid]?.length) return kg.vocab.byLesson[lid];
      const all = await this.getVocab();
      return Array.isArray(all) ? all.filter(w => w.lessonId === lid) : [];
    },
    async getSentencesForLesson(lid) {
      const kg = window.BM?.KnowledgeGraph;
      if (kg?.sentences?.[lid]) return kg.sentences[lid];
      return (await this.getSentences())?.[lid] ?? [];
    },
    async getDialogueForLesson(lid) {
      const kg = window.BM?.KnowledgeGraph;
      if (kg?.dialogues?.[lid]) return kg.dialogues[lid];
      return (await this.getDialogues())?.[lid] ?? null;
    },
    async getStoryQuizForStory(n) {
      const kg = window.BM?.KnowledgeGraph;
      if (kg?.storyQuiz?.[n]) return kg.storyQuiz[n];
      return (await this.getStoryQuiz())?.[n] ?? null;
    },
    async getTestQuestions(limit = 40) {
      const raw = await this.getBigExam();
      const mapped = (Array.isArray(raw) ? raw : []).map((q, i) => ({
        id: i+1, cn: q.zh ?? '', pinyin: '',
        question: q.q, options: q.opts ?? [],
        answer: (q.opts ?? [])[q.a] ?? '',
        answerIdx: q.a, explanation: q.exp ?? '', category: 'test',
      }));
      return _shuffle(mapped).slice(0, limit);
    },
    async prefetchAll() {
      const err = e => { console.error('[DM]', e); return null; };
      const [vocab, grammar, dialogues, lessons, sentences, stories, storyQuiz, tests] =
        await Promise.all([
          this.getVocab().catch(err),
          this.getGrammar().catch(err),
          this.getDialogues().catch(err),
          this.getLessonMeta().catch(err),
          this.getSentences().catch(err),
          this.getStories().catch(err),
          this.getStoryQuiz().catch(err),
          this.getBigExam().catch(err),
        ]);
      const safe = (v, fb) => v ?? fb;
      _buildKG({
        vocab:     safe(vocab, []),
        grammar:   safe(grammar, []),
        dialogues: safe(dialogues, {}),
        lessons:   safe(lessons, { topics:[], stories:[], pinyinTable:{} }),
        sentences: safe(sentences, {}),
        stories:   safe(stories, []),
        storyQuiz: safe(storyQuiz, {}),
        tests:     safe(tests, []),
      });
      return { vocab, grammar, dialogues, lessons, sentences, stories, storyQuiz, tests };
    },
    shuffle: _shuffle,
    getFallbackWords() { _resetLC(); return FB.map(_nw); },
    invalidate(key = null) {
      if (key) { delete _mem[key]; delete _inflt[key]; }
      else {
        Object.keys(_mem).forEach(k => delete _mem[k]);
        Object.keys(_inflt).forEach(k => delete _inflt[k]);
      }
    },
    get urls() { return { ...EP }; },
  };
})();

window.BM ??= {};
window.BM.DataManager = DataManager;
