/**
 * ================================================================
 *  BLUE MANDARIN — translator.js  (المترجم — Translator Tab)
 *  Integrates the uploaded Chinese TTS + Pinyin tool into the
 *  Blue/Winter theme.
 *
 *  Features:
 *    · Text input → Pinyin conversion (pinyinDatabase)
 *    · Web Speech API  (zh-CN, rate 0.8)
 *    · Tonal colour coding via window.BM.Tones
 *    · Character analysis cards (each clickable to speak)
 *    · Quick example phrases
 *    · Arabic-labelled UI
 * ================================================================
 */
'use strict';

const TranslatorTool = (() => {

  // ── Pinyin database (from uploaded script.js, extended with KG words) ──
  const DB = {
    '你':'nǐ','好':'hǎo','谢':'xiè','谢谢':'xièxie','再':'zài','见':'jiàn',
    '再见':'zàijiàn','学':'xué','习':'xí','学习':'xuéxí','中':'zhōng','国':'guó',
    '中国':'zhōngguó','我':'wǒ','是':'shì','学生':'xuésheng','老':'lǎo','师':'shī',
    '老师':'lǎoshī','妈':'mā','爸':'bà','爸爸':'bàba','妈妈':'māma','哥':'gē',
    '姐':'jiě','弟':'dì','妹':'mèi','家':'jiā','学校':'xuéxiào','书':'shū',
    '笔':'bǐ','纸':'zhǐ','桌':'zhuō','椅':'yǐ','门':'mén','窗':'chuāng',
    '黑':'hēi','板':'bǎn','黑板':'hēibǎn','白':'bái','红':'hóng','绿':'lǜ',
    '蓝':'lán','黄':'huáng','紫':'zǐ','一':'yī','二':'èr','三':'sān','四':'sì',
    '五':'wǔ','六':'liù','七':'qī','八':'bā','九':'jiǔ','十':'shí','天':'tiān',
    '月':'yuè','日':'rì','星':'xīng','期':'qī','星期':'xīngqī','早':'zǎo',
    '上':'shàng','午':'wǔ','下':'xià','晚':'wǎn','早上':'zǎoshang',
    '下午':'xiàwǔ','晚上':'wǎnshang','吃':'chī','饭':'fàn','喝':'hē',
    '水':'shuǐ','茶':'chá','咖啡':'kāfēi','牛':'niú','奶':'nǎi',
    '牛奶':'niúnǎi','果':'guǒ','汁':'zhī','果汁':'guǒzhī','苹果':'píngguǒ',
    '香蕉':'xiāngjiāo','葡萄':'pútao','走':'zǒu','跑':'pǎo','跳':'tiào',
    '坐':'zuò','站':'zhàn','睡觉':'shuìjiào','睡':'shuì','觉':'jiào',
    '游戏':'yóuxì','唱歌':'chànggē','跳舞':'tiàowǔ','画画':'huàhuà',
    '读书':'dúshū','写字':'xiězì','数学':'shùxué','英文':'yīngwén',
    '科学':'kēxué','体育':'tǐyù','美术':'měishù','音乐':'yīnyuè',
    '电脑':'diànnǎo','手机':'shǒujī','电视':'diànshì','汽车':'qìchē',
    '火车':'huǒchē','飞机':'fēijī','船':'chuán','衣服':'yīfu','眼镜':'yǎnjìng',
    '手表':'shǒubiǎo','他':'tā','她':'tā','们':'men','我们':'wǒmen',
    '你们':'nǐmen','他们':'tāmen','不':'bù','有':'yǒu','的':'de','了':'le',
    '在':'zài','和':'hé','来':'lái','也':'yě','很':'hěn','都':'dōu',
    '说':'shuō','到':'dào','大':'dà','个':'gè','会':'huì','能':'néng',
    '多':'duō','小':'xiǎo','人':'rén','年':'nián','吧':'ba','呢':'ne',
    '吗':'ma','啊':'a','名字':'míngzi','叫':'jiào','什么':'shénme',
    '哪':'nǎ','哪里':'nǎlǐ','这':'zhè','那':'nà','谁':'shéi',
    '时候':'shíhou','怎么':'zěnme','为什么':'wèishénme','因为':'yīnwèi',
    '所以':'suǒyǐ','但是':'dànshì','如果':'rúguǒ','朋友':'péngyou',
    '汉语':'Hànyǔ','语言':'yǔyán',
  };

  // ── Extend DB from KnowledgeGraph when available ──────────────
  function _extendFromKG() {
    const kg = window.BM?.KnowledgeGraph?.vocab?.all;
    if (!kg) return;
    kg.forEach(w => { if (!DB[w.cn]) DB[w.cn] = w.pinyin; });
  }

  // ── TTS ────────────────────────────────────────────────────────
  let _activeSpeakBtn = null;

  function speak(text, btn = null) {
    window.speechSynthesis.cancel();
    if (_activeSpeakBtn) { _activeSpeakBtn.textContent = '🔊 استمع'; _activeSpeakBtn = null; }
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'zh-CN';
    utt.rate   = 0.8;
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'));
    if (zh) utt.voice = zh;
    if (btn) {
      _activeSpeakBtn = btn;
      utt.onstart = () => { btn.textContent = '🔊 ...'; };
      utt.onend   = () => { btn.textContent = '🔊 استمع'; _activeSpeakBtn = null; };
    }
    window.speechSynthesis.speak(utt);
  }

  // ── Pinyin conversion ──────────────────────────────────────────
  function convertPinyin(text) {
    // Greedy match: try 4-char, 3-char, 2-char, 1-char
    let result = [];
    let i = 0;
    while (i < text.length) {
      let matched = false;
      for (let len = Math.min(4, text.length - i); len >= 1; len--) {
        const sub = text.slice(i, i + len);
        if (DB[sub]) {
          result.push({ chars: sub, pinyin: DB[sub] });
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        result.push({ chars: text[i], pinyin: text[i] });
        i++;
      }
    }
    return result;
  }

  // ── Render functions ───────────────────────────────────────────
  function _renderPinyin(tokens) {
    const T = window.BM?.Tones;
    const pinyinDisplay = document.getElementById('tr-pinyin-display');
    if (!pinyinDisplay) return;
    pinyinDisplay.innerHTML = tokens.map(t => {
      const py = t.pinyin;
      const html = T ? T.wrapPinyin(py) : `<span>${py}</span>`;
      return html;
    }).join(' ');
  }

  function _renderAnalysis(tokens) {
    const T   = window.BM?.Tones;
    const box = document.getElementById('tr-analysis');
    if (!box) return;
    if (!tokens.length) {
      box.innerHTML = '<span style="color:var(--text-4);font-size:12px;direction:rtl">لا يوجد نص للتحليل</span>';
      return;
    }
    box.innerHTML = tokens.map(t => {
      const tone   = T ? T.getTone(t.pinyin) : 0;
      const cls    = T ? T.getCls(tone) : '';
      const color  = T ? T.getColor(tone) : '#666';
      return `
        <div class="tr-char-card rip" data-cn="${t.chars}" style="border-color:${color}30">
          <div class="tr-char-cn ${cls}" style="text-shadow:0 0 20px ${color}40">${t.chars}</div>
          <div class="tr-char-py ${cls}">${t.pinyin}</div>
        </div>`;
    }).join('');
    box.querySelectorAll('.tr-char-card').forEach(card => {
      card.addEventListener('pointerdown', e => {
        e.preventDefault();
        speak(card.dataset.cn);
      });
    });
  }

  // ── Wire the translator view ───────────────────────────────────
  function init() {
    const view = document.getElementById('view-translate');
    if (!view || view.dataset.trInit) return;
    view.dataset.trInit = '1';

    _extendFromKG();

    const inp     = document.getElementById('tr-input');
    const charCnt = document.getElementById('tr-char-count');
    const speakBt = document.getElementById('tr-speak-btn');
    const pinyinBt= document.getElementById('tr-pinyin-btn');
    const resetBt = document.getElementById('tr-reset-btn');

    if (!inp) return;

    // Live char count
    inp.addEventListener('input', () => {
      if (charCnt) charCnt.textContent = inp.value.length;
    });

    // Speak button
    speakBt?.addEventListener('pointerdown', e => {
      e.preventDefault();
      const text = inp.value.trim();
      if (!text) { if (typeof toast === 'function') toast('⚠️ أدخل نصاً أولاً'); return; }
      speak(text, speakBt);
    });

    // Show Pinyin + Analysis
    pinyinBt?.addEventListener('pointerdown', e => {
      e.preventDefault();
      const text = inp.value.trim();
      if (!text) { if (typeof toast === 'function') toast('⚠️ أدخل نصاً أولاً'); return; }
      _extendFromKG();
      const tokens = convertPinyin(text);
      _renderPinyin(tokens);
      _renderAnalysis(tokens);
    });

    // Reset
    resetBt?.addEventListener('pointerdown', e => {
      e.preventDefault();
      inp.value = '你好';
      if (charCnt) charCnt.textContent = '2';
      const tokens = convertPinyin('你好');
      _renderPinyin(tokens);
      _renderAnalysis(tokens);
      window.speechSynthesis.cancel();
    });

    // Example buttons
    view.querySelectorAll('.tr-example-btn').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        const text = btn.dataset.text;
        inp.value = text;
        if (charCnt) charCnt.textContent = text.length;
        const tokens = convertPinyin(text);
        _renderPinyin(tokens);
        _renderAnalysis(tokens);
      });
    });

    // Auto-init with 你好
    const initial = convertPinyin('你好');
    _renderPinyin(initial);
    _renderAnalysis(initial);
  }

  return { init, speak, convertPinyin };
})();

window.BM = window.BM ?? {};
window.BM.TranslatorTool = TranslatorTool;
