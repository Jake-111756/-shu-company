/**
 * 黍的节气信箱 · 交互逻辑
 *
 * 纯原生 JavaScript，无构建步骤，双击 index.html 即可运行。
 *
 * 状态说明（state）：
 *   todayMood       —— 今日心情（calm / tired / happy / down / rest）
 *   todayInput      —— 今日写下的那句话（最多 100 字）
 *   todayReply      —— 黍今天的回信
 *   todayStreakLine —— 当天触发的连续记录特殊台词
 *   todayMemoryHint —— 当天回信参考历史心情时的轻提示
 *   todayFamilyLine —— 当天偶尔出现的家人碎片
 *   streakDays      —— 当前连续记录天数（0 表示未开始或已中断）
 *   totalDays       —— 累计记录天数（中断不清零）
 *   lastRecordDate  —— 累计天数最后一次记录的日期
 *   lastFamilyDate  —— 家人碎片最后一次出现的日期（每天最多一次）
 *   diaries         —— 田垄日记数组，最新的排在最前面
 *
 * 存储说明（v2 命名空间）：
 *   shu_mailbox_diaries_v2        日记数组
 *   shu_mailbox_today_v2          今日心情 / 输入 / 回信（隔天自动重置）
 *   shu_mailbox_recent_picks_v2   各场景最近一次抽到的台词，避免连续重复
 *   shu_mailbox_streak_v2         连续记录 { lastDate, days }
 *   shu_mailbox_total_days_v2     累计记录 { totalDays, lastRecordDate, lastFamilyDate }
 *   shu_mailbox_monthly_v2        本月小结 { lastShownMonth }
 *   shu_mailbox_letter_v2         待看的节气信 { text, targetDate, targetTerm }
 *
 * 启动时会把旧的无版本 key 与 _v1 key 迁移到 _v2；迁移成功后删除旧 key。
 * 任一步失败都静默保留旧 key，页面继续使用新 key 的默认值。
 */
(function () {
  'use strict';

  var dialogues = window.SHU_DIALOGUES;
  if (!dialogues) {
    console.error('台词库没有加载成功：请确认 data/dialogues.js 在 app.js 之前引入。');
    return;
  }

  // localStorage 异常时只提示一次，避免控制台被重复信息淹没
  var storageNoticeShown = false;

  // 尊重系统的减少动效设置，连 JS 触发的滚动也不做平滑动画
  var reduceMotionQuery = null;
  try {
    if (window.matchMedia) {
      reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    }
  } catch (err) {
    reduceMotionQuery = null;
  }

  function getScrollBehavior() {
    return reduceMotionQuery && reduceMotionQuery.matches ? 'auto' : 'smooth';
  }

  /* ============================================================
     常量
     ============================================================ */

  var STORAGE_KEYS = {
    diaries: 'shu_mailbox_diaries_v2',
    today: 'shu_mailbox_today_v2',
    recent: 'shu_mailbox_recent_picks_v2',
    streak: 'shu_mailbox_streak_v2',
    totalDays: 'shu_mailbox_total_days_v2',
    monthly: 'shu_mailbox_monthly_v2',
    letter: 'shu_mailbox_letter_v2'
  };

  // 只用于迁移；迁移成功后会被删除
  var LEGACY_STORAGE_KEYS = {
    diaries: 'shu_mailbox_diaries',
    today: 'shu_mailbox_today',
    recent: 'shu_mailbox_recent_picks',
    streak: 'shu_mailbox_streak_v1',
    totalDays: 'shu_mailbox_total_days_v1',
    monthly: 'shu_mailbox_monthly_v1',
    letter: 'shu_mailbox_letter_v1'
  };

  var MAX_NOTE_LENGTH = 100;
  var MAX_LETTER_LENGTH = 80;
  var LETTER_TERM_COUNT = 6;
  var FAMILY_FRAGMENT_CHANCE = 0.3; // 家人碎片每次机会 30%，且每天最多一次
  var BRIEF_ABSENCE_CHANCE = 0.2;    // 回信前的短暂离开概率
  var BRIEF_ABSENCE_DELAY = 1500;    // 等待句显示约 1.5 秒
  var DIARY_SHOW_LIMIT = 30;   // 页面最多显示最近 30 条
  var DIARY_STORE_LIMIT = 200; // 本地最多保留 200 条，避免无限增长

  var MOODS = [
    { key: 'calm', label: '平静' },
    { key: 'tired', label: '累' },
    { key: 'happy', label: '开心' },
    { key: 'down', label: '低落' },
    { key: 'rest', label: '想休息' }
  ];

  // 纯本地关键词表：以后扩充只改这两个数组。
  // 匹配时忽略大小写与首尾空格，只做 includes；负面优先于正面。
  var NEGATIVE_KEYWORDS = [
    '加班', '睡不好', '失眠', '考试', '吵架', '累', '烦', '压力', '难受', '不想动'
  ];
  var POSITIVE_KEYWORDS = [
    '开心', '顺利', '吃到了', '睡好了', '完成', '通过了', '放松', '不错'
  ];
  var KEYWORD_HINT = '黍好像听懂了这句话。';

  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  // 近似节气日期：真实节气每年会浮动一两天，这里按公历固定日期粗略估算
  var SOLAR_TERMS = [
    { name: '小寒', month: 1, day: 6 },
    { name: '大寒', month: 1, day: 20 },
    { name: '立春', month: 2, day: 4 },
    { name: '雨水', month: 2, day: 19 },
    { name: '惊蛰', month: 3, day: 6 },
    { name: '春分', month: 3, day: 21 },
    { name: '清明', month: 4, day: 5 },
    { name: '谷雨', month: 4, day: 20 },
    { name: '立夏', month: 5, day: 6 },
    { name: '小满', month: 5, day: 21 },
    { name: '芒种', month: 6, day: 6 },
    { name: '夏至', month: 6, day: 21 },
    { name: '小暑', month: 7, day: 7 },
    { name: '大暑', month: 7, day: 23 },
    { name: '立秋', month: 8, day: 8 },
    { name: '处暑', month: 8, day: 23 },
    { name: '白露', month: 9, day: 8 },
    { name: '秋分', month: 9, day: 23 },
    { name: '寒露', month: 10, day: 8 },
    { name: '霜降', month: 10, day: 23 },
    { name: '立冬', month: 11, day: 7 },
    { name: '小雪', month: 11, day: 22 },
    { name: '大雪', month: 12, day: 7 },
    { name: '冬至', month: 12, day: 22 }
  ];

  /* ============================================================
     本地数据：字段裁剪与 v2 迁移
     ============================================================ */

  /** 日记只保留列表、趋势、月度统计真正需要的字段 */
  function normalizeDiaryEntry(item) {
    if (!item || typeof item !== 'object' || typeof item.reply !== 'string') {
      return null;
    }
    return {
      dateKey: typeof item.dateKey === 'string' ? item.dateKey : '',
      dateLabel: typeof item.dateLabel === 'string' ? item.dateLabel : '',
      term: typeof item.term === 'string' ? item.term : '',
      mood: typeof item.mood === 'string' ? item.mood : '',
      moodLabel: typeof item.moodLabel === 'string' ? item.moodLabel : '',
      note: typeof item.note === 'string' ? item.note.slice(0, MAX_NOTE_LENGTH) : '',
      reply: item.reply
    };
  }

  /** 今日状态只保留隔天恢复所需的字段 */
  function normalizeTodayData(saved) {
    if (!saved || typeof saved !== 'object') {
      return null;
    }
    return {
      dateKey: typeof saved.dateKey === 'string' ? saved.dateKey : '',
      mood: typeof saved.mood === 'string' ? saved.mood : '',
      note: typeof saved.note === 'string' ? saved.note.slice(0, MAX_NOTE_LENGTH) : '',
      reply: typeof saved.reply === 'string' ? saved.reply : '',
      streakLine: typeof saved.streakLine === 'string' ? saved.streakLine : '',
      memoryHint: typeof saved.memoryHint === 'string' ? saved.memoryHint : '',
      familyLine: typeof saved.familyLine === 'string' ? saved.familyLine : ''
    };
  }

  /** 当前版本实际使用的抽签场景；旧场景缓存不再保存 */
  function isKnownSceneKey(key) {
    if (key === 'care' || key === 'lifeNote' || key === 'firewood' ||
      key === 'idle' || key === 'family' || key === 'revisit' ||
      key === 'monthly' || key === 'solarLetter' || key === 'briefAbsence') {
      return true;
    }
    return /^(mood|trend|keyword|streak):/.test(key);
  }

  /** 抽签记录只保留“场景 → 台词”的字符串映射 */
  function normalizeRecentPicks(saved) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      return null;
    }
    var result = {};
    Object.keys(saved).forEach(function (key) {
      if (typeof saved[key] === 'string' && isKnownSceneKey(key)) {
        result[key] = saved[key];
      }
    });
    return result;
  }

  function normalizeStreak(saved) {
    if (!saved || typeof saved !== 'object') {
      return null;
    }
    var lastDate = typeof saved.lastDate === 'string' ? saved.lastDate : '';
    var days = Number(saved.days);
    if (!parseDateKey(lastDate) || !isFinite(days) || days < 1) {
      return null;
    }
    return { lastDate: lastDate, days: Math.floor(days) };
  }

  function normalizeTotalDays(saved) {
    if (!saved || typeof saved !== 'object') {
      return null;
    }
    var totalDays = Number(saved.totalDays);
    var lastRecordDate = typeof saved.lastRecordDate === 'string' ? saved.lastRecordDate : '';
    var lastFamilyDate = typeof saved.lastFamilyDate === 'string' ? saved.lastFamilyDate : '';
    return {
      totalDays: isFinite(totalDays) && totalDays > 0 ? Math.floor(totalDays) : 0,
      lastRecordDate: parseDateKey(lastRecordDate) ? lastRecordDate : '',
      lastFamilyDate: parseDateKey(lastFamilyDate) ? lastFamilyDate : ''
    };
  }

  function normalizeMonthly(saved) {
    if (!saved || typeof saved !== 'object') {
      return null;
    }
    var lastShownMonth = typeof saved.lastShownMonth === 'string' ? saved.lastShownMonth : '';
    if (!/^\d{4}-\d{2}$/.test(lastShownMonth)) {
      return null;
    }
    return { lastShownMonth: lastShownMonth };
  }

  function normalizeLetter(saved) {
    if (!saved || typeof saved !== 'object') {
      return null;
    }
    var text = typeof saved.text === 'string' ? saved.text.trim().slice(0, MAX_LETTER_LENGTH) : '';
    var targetDate = typeof saved.targetDate === 'string' ? saved.targetDate : '';
    var targetTerm = typeof saved.targetTerm === 'string' ? saved.targetTerm : '';
    if (!text || !parseDateKey(targetDate)) {
      return null;
    }
    return { text: text, targetDate: targetDate, targetTerm: targetTerm };
  }

  /** 旧 key → 新 key；逐项失败互不影响，成功后才删除旧 key */
  function migrateLegacyStorage() {
    var migrations = [
      {
        oldKey: LEGACY_STORAGE_KEYS.diaries,
        newKey: STORAGE_KEYS.diaries,
        normalize: function (value) {
          if (!Array.isArray(value)) {
            return null;
          }
          return value.map(normalizeDiaryEntry).filter(Boolean).slice(0, DIARY_STORE_LIMIT);
        }
      },
      { oldKey: LEGACY_STORAGE_KEYS.today, newKey: STORAGE_KEYS.today, normalize: normalizeTodayData },
      { oldKey: LEGACY_STORAGE_KEYS.recent, newKey: STORAGE_KEYS.recent, normalize: normalizeRecentPicks },
      { oldKey: LEGACY_STORAGE_KEYS.streak, newKey: STORAGE_KEYS.streak, normalize: normalizeStreak },
      { oldKey: LEGACY_STORAGE_KEYS.totalDays, newKey: STORAGE_KEYS.totalDays, normalize: normalizeTotalDays },
      { oldKey: LEGACY_STORAGE_KEYS.monthly, newKey: STORAGE_KEYS.monthly, normalize: normalizeMonthly },
      { oldKey: LEGACY_STORAGE_KEYS.letter, newKey: STORAGE_KEYS.letter, normalize: normalizeLetter }
    ];

    try {
      if (!window.localStorage) {
        return;
      }
    } catch (err) {
      return;
    }

    migrations.forEach(function (migration) {
      try {
        var oldRaw = window.localStorage.getItem(migration.oldKey);
        if (oldRaw === null) {
          return;
        }

        // 新版本已有数据时不覆盖，也不删除旧数据
        if (window.localStorage.getItem(migration.newKey) !== null) {
          return;
        }

        var oldValue = JSON.parse(oldRaw);
        var newValue = migration.normalize(oldValue);
        if (newValue === null) {
          return;
        }

        window.localStorage.setItem(migration.newKey, JSON.stringify(newValue));
        window.localStorage.removeItem(migration.oldKey);
      } catch (err) {
        // 单项失败：静默保留旧 key，页面继续启动
      }
    });
  }

  migrateLegacyStorage();

  /* ============================================================
     日期与节气
     ============================================================ */

  var now = new Date();
  var todayKey = dateKey(now);
  var yesterdayKey = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  var termInfo = getSolarTermInfo(now);
  var timeSlot = getTimeSlot(now.getHours());
  var storedRecentPicks = readStore(STORAGE_KEYS.recent, {});
  var recentPicks = normalizeRecentPicks(storedRecentPicks) || {};

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  /** 生成 YYYY-MM-DD 形式的日期键，用于判断“今天” */
  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function formatDate(date) {
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' +
      date.getDate() + '日 ' + WEEKDAYS[date.getDay()];
  }

  function dayOfYear(date) {
    var start = new Date(date.getFullYear(), 0, 1);
    var current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((current - start) / 86400000) + 1;
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function termDayOfYear(year, term) {
    return dayOfYear(new Date(year, term.month - 1, term.day));
  }

  /** 粗略计算当前节气、下一个节气以及距离下一节气的天数 */
  function getSolarTermInfo(date) {
    var year = date.getFullYear();
    var today = dayOfYear(date);
    var index = -1;
    var i;

    for (i = 0; i < SOLAR_TERMS.length; i += 1) {
      if (termDayOfYear(year, SOLAR_TERMS[i]) <= today) {
        index = i;
      }
    }

    // 1 月 1 日至 1 月 5 日：仍属于上一年的冬至
    if (index === -1) {
      index = SOLAR_TERMS.length - 1;
    }

    var current = SOLAR_TERMS[index];
    var next = SOLAR_TERMS[(index + 1) % SOLAR_TERMS.length];
    var daysToNext = termDayOfYear(year, next) - today;

    if (daysToNext <= 0) {
      daysToNext += isLeapYear(year) ? 366 : 365;
    }

    return {
      name: current.name,
      nextName: next.name,
      daysToNext: daysToNext
    };
  }

  /** 未来 count 个节气（不含今天），用于“寄往”选择 */
  function getUpcomingTerms(count) {
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var terms = [];

    for (var y = now.getFullYear(); y <= now.getFullYear() + 1; y += 1) {
      SOLAR_TERMS.forEach(function (term) {
        var date = new Date(y, term.month - 1, term.day);
        if (date > todayStart) {
          terms.push({ name: term.name, date: date, dateKey: dateKey(date) });
        }
      });
    }

    terms.sort(function (a, b) {
      return a.date - b.date;
    });
    return terms.slice(0, count);
  }

  /** 5:00-10:59 早上，11:00-17:59 下午，其余晚上 */
  function getTimeSlot(hour) {
    if (hour >= 5 && hour < 11) {
      return { key: 'morning', label: '早上' };
    }
    if (hour >= 11 && hour < 18) {
      return { key: 'afternoon', label: '下午' };
    }
    return { key: 'evening', label: '晚上' };
  }

  function findTermGroup(termName) {
    for (var i = 0; i < dialogues.solarTermCare.length; i += 1) {
      if (dialogues.solarTermCare[i].terms.indexOf(termName) !== -1) {
        return dialogues.solarTermCare[i];
      }
    }
    return dialogues.solarTermCare[0];
  }

  function findMood(moodKey) {
    for (var i = 0; i < MOODS.length; i += 1) {
      if (MOODS[i].key === moodKey) {
        return MOODS[i];
      }
    }
    return null;
  }

  /* ============================================================
     localStorage 读写（失败时退回内存，页面仍可正常使用）
     ============================================================ */

  /** localStorage 异常时只提示一次；页面继续以无存档模式运行 */
  function reportStorageIssue(err) {
    if (storageNoticeShown) {
      return;
    }
    storageNoticeShown = true;
    if (window.console && typeof window.console.warn === 'function') {
      window.console.warn(
        '黍的节气信箱：本地存储不可用或读写失败。页面会继续以无存档模式运行，部分记录刷新后可能丢失。',
        err
      );
    }
  }

  function readStore(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }
      return JSON.parse(raw);
    } catch (err) {
      reportStorageIssue(err);
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      reportStorageIssue(err);
      if (!storageWarned) {
        storageWarned = true;
        showToast('这个浏览器不允许本地保存，刷新后记录会丢失。');
      }
      return false;
    }
  }

  function removeStore(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      reportStorageIssue(err);
    }
  }

  /* ============================================================
     台词抽取：同一场景避免连续重复
     ============================================================ */

  function pickLine(pool, sceneKey) {
    if (!pool || !pool.length) {
      return '';
    }

    var last = recentPicks[sceneKey];
    var candidates = pool.filter(function (line) {
      return line !== last;
    });
    if (!candidates.length) {
      candidates = pool;
    }

    var line = candidates[Math.floor(Math.random() * candidates.length)];
    recentPicks[sceneKey] = line;
    writeStore(STORAGE_KEYS.recent, recentPicks);
    return line;
  }

  /* ============================================================
     状态初始化
     ============================================================ */

  var state = {
    todayMood: '',
    todayInput: '',
    todayReply: '',
    todayStreakLine: '',
    todayMemoryHint: '',
    todayFamilyLine: '',
    streakDays: 0,
    totalDays: 0,
    lastRecordDate: '',
    lastFamilyDate: '',
    diaries: loadDiaries()
  };

  var els = {
    dateLabel: document.getElementById('dateLabel'),
    termLabel: document.getElementById('termLabel'),
    avatarButton: document.getElementById('avatarButton'),
    speechMeta: document.getElementById('speechMeta'),
    speechText: document.getElementById('speechText'),
    streakLabel: document.getElementById('streakLabel'),
    speechFamily: document.getElementById('speechFamily'),
    noteText: document.getElementById('noteText'),
    firewoodButton: document.getElementById('firewoodButton'),
    moodChips: document.getElementById('moodChips'),
    noteInput: document.getElementById('noteInput'),
    charCount: document.getElementById('charCount'),
    submitButton: document.getElementById('submitButton'),
    formStatus: document.getElementById('formStatus'),
    replyPanel: document.getElementById('replyPanel'),
    replyMeta: document.getElementById('replyMeta'),
    replyText: document.getElementById('replyText'),
    replyStreak: document.getElementById('replyStreak'),
    replyFamily: document.getElementById('replyFamily'),
    replyMemory: document.getElementById('replyMemory'),
    cardButton: document.getElementById('cardButton'),
    cardWrap: document.getElementById('cardWrap'),
    cardTerm: document.getElementById('cardTerm'),
    cardDate: document.getElementById('cardDate'),
    cardNote: document.getElementById('cardNote'),
    cardReply: document.getElementById('cardReply'),
    diaryList: document.getElementById('diaryList'),
    diaryEmpty: document.getElementById('diaryEmpty'),
    diaryHint: document.getElementById('diaryHint'),
    exportButton: document.getElementById('exportButton'),
    importButton: document.getElementById('importButton'),
    importFileInput: document.getElementById('importFileInput'),
    clearButton: document.getElementById('clearButton'),
    monthlyCard: document.getElementById('monthlyCard'),
    monthlyStat: document.getElementById('monthlyStat'),
    monthlyLine: document.getElementById('monthlyLine'),
    monthlyClose: document.getElementById('monthlyClose'),
    letterReveal: document.getElementById('letterReveal'),
    letterRevealMeta: document.getElementById('letterRevealMeta'),
    letterRevealText: document.getElementById('letterRevealText'),
    letterRevealReply: document.getElementById('letterRevealReply'),
    letterRevealClose: document.getElementById('letterRevealClose'),
    nextLetterInput: document.getElementById('nextLetterInput'),
    letterCount: document.getElementById('letterCount'),
    letterTermSelect: document.getElementById('letterTermSelect'),
    letterSaveButton: document.getElementById('letterSaveButton'),
    letterStatus: document.getElementById('letterStatus'),
    letterPending: document.getElementById('letterPending'),
    letterMissed: document.getElementById('letterMissed'),
    letterReadButton: document.getElementById('letterReadButton'),
    toast: document.getElementById('toast')
  };

  var toastTimer = null;
  var statusTimer = null;
  var letterStatusTimer = null;
  var submitReleaseTimer = null;
  var storageWarned = false;
  var isSubmitting = false;

  function loadDiaries() {
    var raw = readStore(STORAGE_KEYS.diaries, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map(normalizeDiaryEntry).filter(Boolean).slice(0, DIARY_STORE_LIMIT);
  }

  function loadToday() {
    var empty = { mood: '', note: '', reply: '', streakLine: '', memoryHint: '', familyLine: '' };
    var saved = normalizeTodayData(readStore(STORAGE_KEYS.today, null));

    if (!saved || saved.dateKey !== todayKey) {
      return empty;
    }

    return {
      mood: saved.mood && findMood(saved.mood) ? saved.mood : '',
      note: saved.note,
      reply: saved.reply,
      streakLine: saved.streakLine,
      memoryHint: saved.memoryHint,
      familyLine: saved.familyLine
    };
  }

  function saveToday() {
    writeStore(STORAGE_KEYS.today, {
      dateKey: todayKey,
      mood: state.todayMood,
      note: state.todayInput,
      reply: state.todayReply,
      streakLine: state.todayStreakLine,
      memoryHint: state.todayMemoryHint,
      familyLine: state.todayFamilyLine
    });
  }

  function saveDiaries() {
    writeStore(STORAGE_KEYS.diaries, state.diaries);
  }

  /* ============================================================
     累计记录天数与家人碎片
     ============================================================ */

  /** 读取累计记录；缺失或损坏时静默回到 0 */
  function loadTotalDays() {
    return normalizeTotalDays(readStore(STORAGE_KEYS.totalDays, null)) || {
      totalDays: 0,
      lastRecordDate: '',
      lastFamilyDate: ''
    };
  }

  function saveTotalDays() {
    writeStore(STORAGE_KEYS.totalDays, {
      totalDays: state.totalDays,
      lastRecordDate: state.lastRecordDate,
      lastFamilyDate: state.lastFamilyDate
    });
  }

  function initTotalDays() {
    var saved = loadTotalDays();
    state.totalDays = saved.totalDays;
    state.lastRecordDate = saved.lastRecordDate;
    state.lastFamilyDate = saved.lastFamilyDate;
  }

  /** 同一天只累计一次；中断不清零，只加不减 */
  function updateTotalDays() {
    if (state.lastRecordDate !== todayKey) {
      state.totalDays += 1;
      state.lastRecordDate = todayKey;
    }
    saveTotalDays();
  }

  /** 按累计天数解锁家人碎片；达到 7 天后，年和夕的碎片都在池子里 */
  function getFamilyPool() {
    var pool = [];
    var groups = dialogues.familyFragments;
    if (!groups || typeof groups !== 'object') {
      return pool;
    }

    if (state.totalDays >= 3) {
      pool = pool.concat(groups[3] || []);
    }
    if (state.totalDays >= 7) {
      pool = pool.concat(groups[7] || []);
    }
    if (state.totalDays >= 14) {
      pool = pool.concat(groups[14] || []);
    }
    return pool;
  }

  /** 偶尔出现：30% 概率，且每天最多一次；不显示任何进度或解锁提示 */
  function maybeFamilyFragment() {
    if (state.totalDays < 3) {
      return '';
    }
    if (state.lastFamilyDate === todayKey) {
      return '';
    }

    var pool = getFamilyPool();
    if (!pool.length) {
      return '';
    }
    if (Math.random() >= FAMILY_FRAGMENT_CHANCE) {
      return '';
    }

    var line = pickLine(pool, 'family');
    state.lastFamilyDate = todayKey;
    saveTotalDays();
    return line;
  }

  /* ============================================================
     连续记录与历史心情趋势
     ============================================================ */

  /** 校验 YYYY-MM-DD 键并转成本地日期；解析失败返回 null */
  function parseDateKey(key) {
    if (typeof key !== 'string') {
      return null;
    }
    var parts = key.split('-');
    if (parts.length !== 3) {
      return null;
    }

    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day)) {
      return null;
    }

    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 ||
      date.getDate() !== day) {
      return null;
    }
    return date;
  }

  /** 读取连续记录；键不存在或格式异常时静默返回 null */
  function loadStreak() {
    return normalizeStreak(readStore(STORAGE_KEYS.streak, null));
  }

  /** 上次记录是今天或昨天，连续记录才算还在延续 */
  function isStreakAlive(lastDate) {
    return lastDate === todayKey || lastDate === yesterdayKey;
  }

  function getVisibleStreakDays(streak) {
    if (!streak || !isStreakAlive(streak.lastDate)) {
      return 0;
    }
    return streak.days;
  }

  /**
   * 今天第一次提交时推进连续天数；同一天重复提交不重复累加。
   * 返回 { days, advanced }，advanced 表示今天是否是新的连续记录日。
   */
  function updateStreak() {
    var stored = loadStreak();
    var days;
    var advanced = false;

    if (stored && stored.lastDate === todayKey) {
      days = stored.days;
    } else if (stored && stored.lastDate === yesterdayKey) {
      days = stored.days + 1;
      advanced = true;
    } else {
      days = 1;
      advanced = true;
    }

    state.streakDays = days;
    writeStore(STORAGE_KEYS.streak, { lastDate: todayKey, days: days });
    renderStreak();
    return { days: days, advanced: advanced };
  }

  function renderStreak() {
    if (state.streakDays > 0) {
      els.streakLabel.textContent = '你已经和黍一起记录了 ' + state.streakDays + ' 天。';
      els.streakLabel.hidden = false;
    } else {
      els.streakLabel.textContent = '';
      els.streakLabel.hidden = true;
    }
  }

  /**
   * 最近 7 条日记里看最近 3 条：
   * 2 条以上「累 / 低落」→ 持续关心；2 条以上「开心 / 平静」→ 日常陪伴。
   * 读取失败或数量不足时返回 null，走普通心情回信。
   */
  function analyzeMoodTrend(diaries) {
    if (!Array.isArray(diaries) || !diaries.length) {
      return null;
    }

    var recentSeven = diaries.slice(0, 7);
    var recentThree = recentSeven.slice(0, 3);
    if (recentThree.length < 2) {
      return null;
    }

    var heavy = 0;
    var light = 0;

    recentThree.forEach(function (entry) {
      if (!entry) {
        return;
      }
      if (entry.mood === 'tired' || entry.mood === 'down') {
        heavy += 1;
      }
      if (entry.mood === 'happy' || entry.mood === 'calm') {
        light += 1;
      }
    });

    if (heavy >= 2) {
      return {
        key: 'heavy',
        pool: dialogues.persistentCare,
        hint: '黍好像记得你最近有点累。'
      };
    }

    if (light >= 2) {
      return {
        key: 'light',
        pool: dialogues.dailyCompanion,
        hint: '黍好像记得你最近心情不错。'
      };
    }

    return null;
  }

  /**
   * 本地关键词轻匹配：忽略大小写与首尾空格，只做 includes。
   * 负面优先于正面；未命中返回 null。
   * 以后扩充词表只需修改 NEGATIVE_KEYWORDS / POSITIVE_KEYWORDS。
   */
  function matchKeywordMood(text) {
    var normalized = typeof text === 'string' ? text.toLowerCase().trim() : '';
    if (!normalized) {
      return null;
    }

    var i;
    for (i = 0; i < NEGATIVE_KEYWORDS.length; i += 1) {
      if (normalized.indexOf(NEGATIVE_KEYWORDS[i].toLowerCase()) !== -1) {
        return {
          key: 'negative',
          pool: dialogues.persistentCare,
          hint: KEYWORD_HINT
        };
      }
    }

    for (i = 0; i < POSITIVE_KEYWORDS.length; i += 1) {
      if (normalized.indexOf(POSITIVE_KEYWORDS[i].toLowerCase()) !== -1) {
        return {
          key: 'positive',
          pool: dialogues.dailyCompanion,
          hint: KEYWORD_HINT
        };
      }
    }

    return null;
  }

  /** 回信下方的额外台词、家人碎片和记忆提示；没有内容时彻底隐藏 */
  function renderReplyExtras(streakLine, familyLine, memoryHint) {
    if (streakLine) {
      els.replyStreak.textContent = streakLine;
      els.replyStreak.hidden = false;
    } else {
      els.replyStreak.textContent = '';
      els.replyStreak.hidden = true;
    }

    if (familyLine) {
      els.replyFamily.textContent = familyLine;
      els.replyFamily.hidden = false;
    } else {
      els.replyFamily.textContent = '';
      els.replyFamily.hidden = true;
    }

    if (memoryHint) {
      els.replyMemory.textContent = memoryHint;
      els.replyMemory.hidden = false;
    } else {
      els.replyMemory.textContent = '';
      els.replyMemory.hidden = true;
    }
  }

  /* ============================================================
     渲染
     ============================================================ */

  function renderDate() {
    els.dateLabel.textContent = formatDate(now);
    els.termLabel.textContent = '节气 · ' + termInfo.name +
      '　距' + termInfo.nextName + '还有 ' + termInfo.daysToNext + ' 天';
  }

  function showSpeechLine(text, meta, familyLine) {
    // 先移除动画类并强制重排，让每句话都能重新播放淡入
    els.speechText.classList.remove('is-enter');
    void els.speechText.offsetWidth;
    els.speechText.textContent = text;
    els.speechText.classList.add('is-enter');
    if (meta) {
      els.speechMeta.textContent = meta;
    }

    if (familyLine) {
      els.speechFamily.textContent = familyLine;
      els.speechFamily.hidden = false;
    } else {
      els.speechFamily.textContent = '';
      els.speechFamily.hidden = true;
    }
  }

  function renderMoods() {
    els.moodChips.textContent = '';

    MOODS.forEach(function (mood) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'mood';
      button.dataset.mood = mood.key;
      button.textContent = mood.label;
      button.setAttribute('aria-pressed', String(state.todayMood === mood.key));
      button.addEventListener('click', function () {
        selectMood(mood.key);
      });
      els.moodChips.appendChild(button);
    });
  }

  function selectMood(moodKey) {
    state.todayMood = moodKey;

    var buttons = els.moodChips.querySelectorAll('.mood');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].dataset.mood === moodKey));
    }
    saveToday();
  }

  function updateCharCount() {
    var length = els.noteInput.value.length;
    var remaining = Math.max(0, MAX_NOTE_LENGTH - length);
    els.charCount.textContent = '剩余 ' + remaining + ' 字';
    els.charCount.classList.toggle('is-near', remaining <= 10);
  }

  function renderReply(entry) {
    if (!entry || !entry.reply) {
      els.replyPanel.hidden = true;
      renderReplyExtras('', '', '');
      return;
    }

    els.replyMeta.textContent = [entry.moodLabel, entry.term, entry.timeSlot]
      .filter(Boolean)
      .join(' · ');

    renderReplyExtras(entry.streakLine, entry.familyLine, entry.memoryHint);

    // 先让面板显示，再重新挂上淡入类，确保每次回信都是渐显而不是突然出现
    els.replyText.classList.remove('is-enter');
    els.replyText.classList.remove('is-waiting');
    els.replyText.textContent = entry.reply;
    els.replyPanel.hidden = false;
    void els.replyText.offsetWidth;
    els.replyText.classList.add('is-enter');
  }

  function renderDiaries() {
    els.diaryList.textContent = '';

    var items = state.diaries.slice(0, DIARY_SHOW_LIMIT);
    els.diaryEmpty.hidden = items.length > 0;
    els.clearButton.disabled = state.diaries.length === 0;

    if (!items.length) {
      els.diaryHint.textContent = '每次寄出心情，都会在这里留下一行田垄。';
    } else if (state.diaries.length > DIARY_SHOW_LIMIT) {
      els.diaryHint.textContent = '共 ' + state.diaries.length + ' 封，这里显示最近 ' +
        DIARY_SHOW_LIMIT + ' 封。';
    } else {
      els.diaryHint.textContent = '共 ' + state.diaries.length + ' 封，最新的在最上面。';
    }

    items.forEach(function (entry) {
      els.diaryList.appendChild(createDiaryItem(entry));
    });
  }

  /** 用 DOM API 逐块搭建可展开的日记条目，文本一律走 textContent，避免注入 */
  function createDiaryItem(entry) {
    var item = document.createElement('li');
    item.className = 'diary__item';

    var details = document.createElement('details');
    details.className = 'diary__details';

    var summary = document.createElement('summary');
    summary.className = 'diary__summary diary__head';

    var date = document.createElement('span');
    date.className = 'diary__date';
    date.textContent = entry.dateLabel || entry.dateKey || '';
    summary.appendChild(date);

    if (entry.term) {
      var term = document.createElement('span');
      term.className = 'diary__term';
      term.textContent = entry.term;
      summary.appendChild(term);
    }

    if (entry.moodLabel) {
      var mood = document.createElement('span');
      mood.className = 'diary__mood';
      mood.textContent = entry.moodLabel;
      summary.appendChild(mood);
    }

    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'diary__body';

    var note = document.createElement('p');
    note.className = 'diary__note';
    if (entry.note) {
      note.textContent = entry.note;
    } else {
      note.textContent = '（只寄来心情，没有写字）';
      note.classList.add('is-muted');
    }
    body.appendChild(note);

    var reply = document.createElement('p');
    reply.className = 'diary__reply';
    var who = document.createElement('span');
    who.className = 'diary__who';
    who.textContent = '黍';
    reply.appendChild(who);
    reply.appendChild(document.createTextNode('：' + entry.reply));
    body.appendChild(reply);

    var revisit = document.createElement('p');
    revisit.className = 'diary__revisit';
    revisit.hidden = true;

    var revisitTag = document.createElement('span');
    revisitTag.className = 'diary__revisit-tag';
    revisitTag.textContent = '回看';
    revisit.appendChild(revisitTag);

    var revisitText = document.createElement('span');
    revisitText.className = 'diary__revisit-text';
    revisit.appendChild(revisitText);

    body.appendChild(revisit);
    details.appendChild(body);
    item.appendChild(details);

    // 只有博士主动展开时才抽一句回看台词，并避免连续重复
    details.addEventListener('toggle', function () {
      if (!details.open) {
        revisit.hidden = true;
        revisitText.textContent = '';
        return;
      }

      var pool = dialogues.revisitReplies;
      if (Array.isArray(pool) && pool.length) {
        revisitText.textContent = pickLine(pool, 'revisit');
        revisit.hidden = false;
      }
    });

    return item;
  }

  /* ============================================================
     月度小结与节气信
     ============================================================ */

  function buildMonthlySummary() {
    var monthKey = todayKey.slice(0, 7);
    var monthEntries = state.diaries.filter(function (entry) {
      return entry && typeof entry.dateKey === 'string' &&
        entry.dateKey.slice(0, 7) === monthKey;
    });

    if (!monthEntries.length) {
      return null;
    }

    var days = {};
    var moodCounts = {};

    monthEntries.forEach(function (entry) {
      days[entry.dateKey] = true;
      if (entry.mood) {
        moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
      }
    });

    var dayCount = Object.keys(days).length;
    var topMood = null;
    var topCount = 0;

    MOODS.forEach(function (mood) {
      var count = moodCounts[mood.key] || 0;
      if (count > topCount) {
        topCount = count;
        topMood = mood;
      }
    });

    var stat = '这个月，你来了 ' + dayCount + ' 天。';
    if (topMood) {
      stat += '最常放在心上的，是「' + topMood.label + '」。';
    }

    var linePool = dialogues.monthlyReplies;
    var line = Array.isArray(linePool) && linePool.length ? pickLine(linePool, 'monthly') : '';

    return { stat: stat, line: line };
  }

  function initMonthlyCard() {
    var monthKey = todayKey.slice(0, 7);
    var saved = normalizeMonthly(readStore(STORAGE_KEYS.monthly, null));
    var lastShown = saved ? saved.lastShownMonth : '';

    if (lastShown === monthKey) {
      return;
    }

    var summary = buildMonthlySummary();
    if (!summary) {
      return;
    }

    els.monthlyStat.textContent = summary.stat;
    els.monthlyLine.textContent = summary.line;
    els.monthlyLine.hidden = !summary.line;
    els.monthlyCard.hidden = false;

    writeStore(STORAGE_KEYS.monthly, { lastShownMonth: monthKey });
  }

  function formatTermOption(term) {
    return term.name + ' · ' + (term.date.getMonth() + 1) + '月' + term.date.getDate() + '日';
  }

  function renderLetterTerms() {
    var terms = getUpcomingTerms(LETTER_TERM_COUNT);
    els.letterTermSelect.textContent = '';

    terms.forEach(function (term) {
      var option = document.createElement('option');
      option.value = term.dateKey + '|' + term.name;
      option.textContent = formatTermOption(term);
      els.letterTermSelect.appendChild(option);
    });
  }

  function formatLetterDate(key) {
    var date = parseDateKey(key);
    if (!date) {
      return '';
    }
    var yearPrefix = date.getFullYear() === now.getFullYear() ? '' : date.getFullYear() + '年';
    return yearPrefix + (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }

  function loadLetter() {
    return normalizeLetter(readStore(STORAGE_KEYS.letter, null));
  }

  function updateLetterCount() {
    var remaining = Math.max(0, MAX_LETTER_LENGTH - els.nextLetterInput.value.length);
    els.letterCount.textContent = '剩余 ' + remaining + ' 字';
    els.letterCount.classList.toggle('is-near', remaining <= 10);
  }

  function setLetterStatus(message) {
    els.letterStatus.textContent = message;
    window.clearTimeout(letterStatusTimer);
    letterStatusTimer = window.setTimeout(function () {
      els.letterStatus.textContent = '';
    }, 5000);
  }

  function revealLetter(letter, shouldScroll) {
    if (!letter) {
      return;
    }

    var linePool = dialogues.solarTermLetters;
    var line = Array.isArray(linePool) && linePool.length ?
      pickLine(linePool, 'solarLetter') : '';

    els.letterRevealMeta.textContent = '写给 ' + (letter.targetTerm || '那个节气') +
      ' · ' + formatLetterDate(letter.targetDate);
    els.letterRevealText.textContent = letter.text;
    els.letterRevealReply.textContent = line ? '黍：' + line : '';
    els.letterRevealReply.hidden = !line;
    els.letterReveal.hidden = false;

    if (shouldScroll && typeof els.letterReveal.scrollIntoView === 'function') {
      els.letterReveal.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
    }
  }

  function initLetter() {
    renderLetterTerms();
    updateLetterCount();

    var letter = loadLetter();
    if (!letter) {
      els.letterPending.hidden = true;
      els.letterMissed.hidden = true;
      return;
    }

    if (letter.targetDate === todayKey) {
      revealLetter(letter, false);
      removeStore(STORAGE_KEYS.letter);
      els.letterPending.hidden = true;
      els.letterMissed.hidden = true;
      return;
    }

    if (letter.targetDate < todayKey) {
      els.letterMissed.hidden = false;
      els.letterPending.hidden = true;
      return;
    }

    els.letterPending.textContent = '已经给' + (letter.targetTerm || '那个节气') +
      '留了句话，等那天再看。';
    els.letterPending.hidden = false;
    els.letterMissed.hidden = true;
  }

  function handleLetterSave() {
    var text = els.nextLetterInput.value.trim();
    if (!text) {
      setLetterStatus('写一句再收好，博士。');
      els.nextLetterInput.focus();
      return;
    }

    var parts = els.letterTermSelect.value.split('|');
    var targetDate = parts[0] || '';
    var targetTerm = parts[1] || '';

    if (!parseDateKey(targetDate)) {
      setLetterStatus('这个节气没能记下来，换一个试试。');
      return;
    }

    var existing = loadLetter();
    if (existing) {
      var confirmed = window.confirm('已经有一封给' + (existing.targetTerm || '那个节气') +
        '的信还没看。要换成这封吗？');
      if (!confirmed) {
        return;
      }
    }

    var saved = writeStore(STORAGE_KEYS.letter, {
      text: text,
      targetDate: targetDate,
      targetTerm: targetTerm
    });

    if (!saved) {
      setLetterStatus('这封信没能收好，换个时候再试试。');
      return;
    }

    els.nextLetterInput.value = '';
    updateLetterCount();
    els.letterPending.textContent = '已经给' + targetTerm + '留了句话，等那天再看。';
    els.letterPending.hidden = false;
    els.letterMissed.hidden = true;
    setLetterStatus('收好了。到「' + targetTerm + '」那天再打开。');
  }

  function readMissedLetter() {
    var letter = loadLetter();
    if (!letter) {
      els.letterMissed.hidden = true;
      return;
    }

    revealLetter(letter, true);
    removeStore(STORAGE_KEYS.letter);
    els.letterMissed.hidden = true;
    els.letterPending.hidden = true;
  }

  function fillCard() {
    els.cardTerm.textContent = termInfo.name + ' · ' + timeSlot.label;
    els.cardDate.textContent = formatDate(now);
    els.cardNote.textContent = state.todayInput.trim() || '今天没有留下文字，只把心情寄了过来。';
    els.cardReply.textContent = state.todayReply;
  }

  /* ============================================================
     提示
     ============================================================ */

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2800);
  }

  function setStatus(message) {
    els.formStatus.textContent = message;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(function () {
      els.formStatus.textContent = '';
    }, 4000);
  }

  /* ============================================================
     主要交互
     ============================================================ */

  function holdSubmit() {
    isSubmitting = true;
    els.submitButton.disabled = true;
    window.clearTimeout(submitReleaseTimer);
  }

  function releaseSubmit() {
    isSubmitting = false;
    els.submitButton.disabled = false;
  }

  /** 低概率选择一句“短暂离开”的等待句；没有数据就不等待 */
  function getBriefAbsenceLine() {
    var pool = dialogues.briefAbsence;
    if (!Array.isArray(pool) || !pool.length) {
      return '';
    }
    if (Math.random() >= BRIEF_ABSENCE_CHANCE) {
      return '';
    }
    return pickLine(pool, 'briefAbsence');
  }

  /** 在回信区先显示等待句，并把上一封回信的附加信息收起来 */
  function showBriefAbsence(line) {
    els.replyMeta.textContent = '黍 · 灶边';
    renderReplyExtras('', '', '');
    els.replyText.classList.remove('is-enter');
    els.replyText.classList.add('is-waiting');
    els.replyText.textContent = line;
    els.replyPanel.hidden = false;
    void els.replyText.offsetWidth;
    els.replyText.classList.add('is-enter');
  }

  function handleSubmit() {
    if (isSubmitting) {
      return;
    }

    var note = els.noteInput.value.trim();

    if (!state.todayMood) {
      if (!note) {
        setStatus('先写一句，或选个心情也可以');
        els.noteInput.focus();
      } else {
        setStatus('再选一个此刻的心情吧，博士。');
        var firstMood = els.moodChips.querySelector('.mood');
        if (firstMood) {
          firstMood.focus();
        }
      }
      return;
    }

    var mood = findMood(state.todayMood);
    if (!mood) {
      return;
    }

    // 20% 概率先显示短暂离开；等待期间按钮保持禁用，避免重复提交
    var waitingLine = getBriefAbsenceLine();
    holdSubmit();

    var keywordMatch = matchKeywordMood(note);
    var trend = analyzeMoodTrend(state.diaries);
    var replyPool;
    var replyScene;
    var memoryHint = '';

    // 关键词优先于历史趋势；只有关键词分组真的被用上时才显示轻提示
    if (keywordMatch && Array.isArray(keywordMatch.pool) && keywordMatch.pool.length) {
      replyPool = keywordMatch.pool;
      replyScene = 'keyword:' + keywordMatch.key;
      memoryHint = keywordMatch.hint;
    } else if (trend && Array.isArray(trend.pool) && trend.pool.length) {
      replyPool = trend.pool;
      replyScene = 'trend:' + trend.key;
      memoryHint = trend.hint;
    } else {
      replyPool = dialogues.moodReplies[state.todayMood] || dialogues.moodReplies.calm;
      replyScene = 'mood:' + state.todayMood;
    }

    var reply = pickLine(replyPool, replyScene);

    // 累计记录天数只增不减；家人碎片按累计天数解锁，每天最多出现一次
    updateTotalDays();
    var familyLine = maybeFamilyFragment();

    // 连续天数在“今天第一次提交”时推进；同一天重复提交不会重复加天
    var streakResult = updateStreak();
    var streakLine = state.todayStreakLine;

    if (streakResult.advanced) {
      streakLine = '';
      var milestonePool = dialogues.streakReplies && dialogues.streakReplies[streakResult.days];
      if (Array.isArray(milestonePool) && milestonePool.length) {
        streakLine = pickLine(milestonePool, 'streak:' + streakResult.days);
      }
    }

    state.todayReply = reply;
    state.todayInput = els.noteInput.value;
    state.todayStreakLine = streakLine;
    state.todayMemoryHint = memoryHint;
    state.todayFamilyLine = familyLine;

    var storedEntry = {
      dateKey: todayKey,
      dateLabel: formatDate(now),
      term: termInfo.name,
      mood: mood.key,
      moodLabel: mood.label,
      note: note,
      reply: reply
    };

    var replyView = {
      term: termInfo.name,
      timeSlot: timeSlot.label,
      moodLabel: mood.label,
      reply: reply,
      streakLine: streakLine,
      familyLine: familyLine,
      memoryHint: memoryHint
    };

    state.diaries.unshift(storedEntry);
    state.diaries = state.diaries.slice(0, DIARY_STORE_LIMIT);

    saveToday();
    saveDiaries();
    renderDiaries();
    setStatus('信已经放进信箱了，博士。');

    if (waitingLine) {
      // 先让等待句出现，约 1.5 秒后再显示真正的回信
      showBriefAbsence(waitingLine);
      submitReleaseTimer = window.setTimeout(function () {
        renderReply(replyView);
        if (!els.cardWrap.hidden) {
          fillCard();
        }
        releaseSubmit();
      }, BRIEF_ABSENCE_DELAY);
    } else {
      renderReply(replyView);
      if (!els.cardWrap.hidden) {
        fillCard();
      }
      submitReleaseTimer = window.setTimeout(releaseSubmit, 1000);
    }

    if (typeof els.replyPanel.scrollIntoView === 'function') {
      els.replyPanel.scrollIntoView({ behavior: getScrollBehavior(), block: 'nearest' });
    }
  }

  function generateCard() {
    if (!state.todayReply) {
      showToast('先寄一封信吧，博士，小卡才有话可写。');
      return;
    }

    fillCard();
    els.cardWrap.hidden = false;
    els.cardWrap.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
  }

  function clearDiaries() {
    if (!state.diaries.length) {
      return;
    }

    var confirmed = window.confirm('要清空田垄日记吗？清空之后，这些信就找不回来了。');
    if (!confirmed) {
      return;
    }

    var confirmedAgain = window.confirm('再确认一次：真的要把所有日记都删掉吗？删除后无法恢复。');
    if (!confirmedAgain) {
      return;
    }

    state.diaries = [];
    saveDiaries();
    renderDiaries();
    showToast('日记已清空，田垄重新空出来了。');
  }

  /* ============================================================
     日记导出 / 导入
     ============================================================ */

  /** 按日期倒序排列；同一天保持原有/文件内顺序 */
  function sortDiariesByDateDesc(diaries) {
    return diaries.map(function (entry, index) {
      return { entry: entry, index: index };
    }).sort(function (a, b) {
      if (a.entry.dateKey === b.entry.dateKey) {
        return a.index - b.index;
      }
      return a.entry.dateKey < b.entry.dateKey ? 1 : -1;
    }).map(function (item) {
      return item.entry;
    });
  }

  function exportDiaries() {
    try {
      var backup = {
        format: 'shu_mailbox_diaries',
        version: 2,
        exportedAt: new Date().toISOString(),
        diaries: state.diaries
      };
      var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      var url = window.URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'shu_mailbox_backup_' + dateKey(new Date()) + '.json';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(function () {
        window.URL.revokeObjectURL(url);
      }, 0);
      showToast('日记已导出。');
    } catch (err) {
      showToast('导出失败，请再试一次。');
    }
  }

  function handleImportFile() {
    var input = els.importFileInput;
    var file = input.files && input.files[0];
    if (!file) {
      return;
    }

    function resetInput() {
      input.value = '';
    }

    if (!window.FileReader) {
      showToast('文件格式不对');
      resetInput();
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () {
      showToast('文件格式不对');
      resetInput();
    };

    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ''));
        var rawDiaries = Array.isArray(data) ? data :
          (data && Array.isArray(data.diaries) ? data.diaries : null);

        if (!rawDiaries) {
          showToast('文件格式不对');
          return;
        }
        if (!rawDiaries.length) {
          showToast('这份备份里没有日记。');
          return;
        }

        var imported = [];
        rawDiaries.forEach(function (item) {
          var entry = normalizeDiaryEntry(item);
          if (entry && parseDateKey(entry.dateKey)) {
            imported.push(entry);
          }
        });

        if (!imported.length) {
          showToast('文件格式不对');
          return;
        }

        // 按日期去重：现有记录已覆盖的日期，整日跳过
        var existingDates = {};
        state.diaries.forEach(function (entry) {
          existingDates[entry.dateKey] = true;
        });
        var newEntries = imported.filter(function (entry) {
          return !existingDates[entry.dateKey];
        });

        if (!newEntries.length) {
          showToast('没有新的日记可导入。');
          return;
        }

        var confirmed = window.confirm(
          '这份备份有 ' + newEntries.length + ' 条新日记，现有 ' + state.diaries.length +
          ' 条。同日期以现有记录为准，要继续导入吗？'
        );
        if (!confirmed) {
          return;
        }

        state.diaries = sortDiariesByDateDesc(state.diaries.concat(newEntries))
          .slice(0, DIARY_STORE_LIMIT);
        saveDiaries();
        renderDiaries();
        showToast('已导入 ' + newEntries.length + ' 条日记。');
      } catch (err) {
        showToast('文件格式不对');
      } finally {
        resetInput();
      }
    };

    try {
      reader.readAsText(file, 'utf-8');
    } catch (err) {
      showToast('文件格式不对');
      resetInput();
    }
  }

  function bindEvents() {
    els.avatarButton.addEventListener('click', function () {
      var idleLine = pickLine(dialogues.idle, 'idle');
      var familyLine = maybeFamilyFragment();
      showSpeechLine(idleLine, '黍 · 闲话', familyLine);

      els.avatarButton.classList.remove('is-tapped');
      void els.avatarButton.offsetWidth;
      els.avatarButton.classList.add('is-tapped');
    });

    // 添柴只更新顶部对话，不写日记、不改变连续记录
    els.firewoodButton.addEventListener('click', function () {
      var firewoodPool = dialogues.firewood;
      if (!Array.isArray(firewoodPool) || !firewoodPool.length) {
        return;
      }
      showSpeechLine(pickLine(firewoodPool, 'firewood'), '黍 · 灶边');
    });

    els.noteInput.addEventListener('input', function () {
      if (els.noteInput.value.length > MAX_NOTE_LENGTH) {
        els.noteInput.value = els.noteInput.value.slice(0, MAX_NOTE_LENGTH);
      }
      state.todayInput = els.noteInput.value;
      updateCharCount();
      saveToday();
    });

    // Ctrl + Enter（Mac 上也支持 Cmd + Enter）直接寄信
    els.noteInput.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
      }
    });

    els.nextLetterInput.addEventListener('input', function () {
      if (els.nextLetterInput.value.length > MAX_LETTER_LENGTH) {
        els.nextLetterInput.value = els.nextLetterInput.value.slice(0, MAX_LETTER_LENGTH);
      }
      updateLetterCount();
    });

    els.letterSaveButton.addEventListener('click', handleLetterSave);
    els.letterReadButton.addEventListener('click', readMissedLetter);

    els.letterRevealClose.addEventListener('click', function () {
      els.letterReveal.hidden = true;
    });

    els.monthlyClose.addEventListener('click', function () {
      els.monthlyCard.hidden = true;
    });

    els.submitButton.addEventListener('click', handleSubmit);
    els.cardButton.addEventListener('click', generateCard);

    els.exportButton.addEventListener('click', exportDiaries);
    els.importButton.addEventListener('click', function () {
      els.importFileInput.click();
    });
    els.importFileInput.addEventListener('change', handleImportFile);

    els.clearButton.addEventListener('click', clearDiaries);
  }

  function init() {
    renderDate();

    var group = findTermGroup(termInfo.name);
    var carePool = group.lines.concat(dialogues[timeSlot.key] || []);
    if (Array.isArray(dialogues.careReminders)) {
      carePool = carePool.concat(dialogues.careReminders);
    }
    showSpeechLine(pickLine(carePool, 'care'), termInfo.name + ' · ' + timeSlot.label + '的问候');

    // 每次打开或刷新抽一句生活碎片，放在顶部右下角的便签上
    var lifePool = dialogues.lifeFragments;
    if (Array.isArray(lifePool) && lifePool.length) {
      els.noteText.textContent = pickLine(lifePool, 'lifeNote');
    }

    var saved = loadToday();
    state.todayMood = saved.mood;
    state.todayInput = saved.note;
    state.todayReply = saved.reply;
    state.todayStreakLine = saved.streakLine;
    state.todayMemoryHint = saved.memoryHint;
    state.todayFamilyLine = saved.familyLine;

    initTotalDays();

    var storedStreak = loadStreak();
    state.streakDays = getVisibleStreakDays(storedStreak);
    renderStreak();

    els.noteInput.value = state.todayInput;
    updateCharCount();
    renderMoods();

    if (state.todayReply) {
      var mood = findMood(state.todayMood);
      renderReply({
        moodLabel: mood ? mood.label : '',
        term: termInfo.name,
        timeSlot: timeSlot.label,
        reply: state.todayReply,
        streakLine: state.todayStreakLine,
        familyLine: state.todayFamilyLine,
        memoryHint: state.todayMemoryHint
      });
    }

    renderDiaries();
    initMonthlyCard();
    initLetter();
    bindEvents();
  }

  init();
}());
