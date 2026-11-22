/* Spend Note — core logic
 * Pure functions only: no DOM, no storage. Everything the app computes
 * (month totals, cash flow, card performance, calendar cells, backup
 * validation) lives here so it can be tested on its own.
 */
(function (root) {
  'use strict';

  var VERSION = 2;
  var WEEKS_PER_MONTH = 4.33; // (월 고정비 + 카드 목표 실적) ÷ 4.33 = 주간 필요 수입

  var DEFAULT_CATEGORIES = [
    { id: 'food', name: '식비', emoji: '🍚' },
    { id: 'cafe', name: '카페·간식', emoji: '☕' },
    { id: 'shop', name: '쇼핑', emoji: '🛍️' },
    { id: 'life', name: '생활·마트', emoji: '🧺' },
    { id: 'transit', name: '교통', emoji: '🚌' },
    { id: 'fixed', name: '고정비', emoji: '📅' },
    { id: 'etc', name: '기타', emoji: '📌' }
  ];

  var DEFAULT_INCOME_CATEGORIES = [
    { id: 'inc_online', name: '온라인 수입', emoji: '💻' },
    { id: 'inc_pay', name: '급여', emoji: '💰' },
    { id: 'inc_side', name: '부수입', emoji: '🧾' },
    { id: 'inc_etc', name: '기타 수입', emoji: '📌' }
  ];

  var FIXED_CATEGORY_ID = 'fixed';
  var ETC_CATEGORY_ID = 'etc';
  var ETC_INCOME_CATEGORY_ID = 'inc_etc';
  var DEFAULT_CARD_ID = 'card_hyundai';
  var DEFAULT_CARD_NAME = '현대카드';
  var DEFAULT_CARD_GOAL = 300000;

  /* ---------- date helpers (all local time) ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDateKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], da = +m[3];
    var d = new Date(y, mo - 1, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  }

  function isDateKey(key) { return !!parseDateKey(key); }

  function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }

  function monthKeyOf(key) { return String(key || '').slice(0, 7); }

  function isMonthKey(mk) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mk || '')); }

  function addMonths(mk, delta) {
    var y = +mk.slice(0, 4);
    var m = +mk.slice(5, 7) - 1 + delta;
    return monthKey(new Date(y, m, 1));
  }

  function daysInMonth(mk) {
    return new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0).getDate();
  }

  function monthLabel(mk) {
    return +mk.slice(0, 4) + '년 ' + +mk.slice(5, 7) + '월';
  }

  function weekdayLabels() { return ['일', '월', '화', '수', '목', '금', '토']; }

  /* Calendar cells for a month, Sunday-first, trimmed to whole weeks. */
  function monthGrid(mk, todayKey) {
    var first = new Date(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1);
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay() + i);
      cells.push({
        key: dateKey(d),
        day: d.getDate(),
        inMonth: monthKey(d) === mk,
        isToday: dateKey(d) === todayKey
      });
    }
    while (cells.length > 35 && cells.slice(-7).every(function (c) { return !c.inMonth; })) {
      cells = cells.slice(0, -7);
    }
    return cells;
  }

  /* ---------- formatting ---------- */

  function formatNumber(n) {
    n = Math.round(+n || 0);
    var neg = n < 0;
    if (neg) n = -n;
    var s = String(n), out = '';
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += ',';
      out += s.charAt(i);
    }
    return (neg ? '-' : '') + out;
  }

  function won(n) { return formatNumber(n) + '원'; }

  /* Short form for calendar cells: 4,500 → "4,500", 12,000 → "1.2만", 1,234,000 → "123만" */
  function compactWon(n) {
    n = Math.round(+n || 0);
    if (n <= 0) return '';
    if (n < 10000) return formatNumber(n);
    if (n < 1000000) {
      var one = Math.round(n / 1000) / 10;
      return (one % 1 === 0 ? String(one) : one.toFixed(1)) + '만';
    }
    return formatNumber(Math.round(n / 10000)) + '만';
  }

  function percentText(ratio) {
    if (!isFinite(ratio) || ratio <= 0) return '0%';
    return Math.round(ratio * 100) + '%';
  }

  /* "12,000" / "1.2만원" typed into an amount field → integer won */
  function parseAmount(value) {
    var digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
    if (!digits) return 0;
    digits = digits.replace(/^0+(?=\d)/, '');
    var n = parseInt(digits, 10);
    if (!isFinite(n)) return 0;
    return Math.min(n, 999999999);
  }

  function sanitizeAmountInput(value) {
    var n = parseAmount(value);
    return n > 0 ? formatNumber(n) : '';
  }

  /* ---------- entry helpers ---------- */

  function amountOf(entry) { return Math.max(0, Math.round(+entry.amount || 0)); }

  function sumAmounts(list) {
    return (list || []).reduce(function (s, e) { return s + amountOf(e); }, 0);
  }

  function entryType(e) { return e && e.type === 'income' ? 'income' : 'expense'; }

  function entriesOfType(list, type) {
    var t = type === 'income' ? 'income' : 'expense';
    return (list || []).filter(function (e) { return entryType(e) === t; });
  }

  function entriesInMonth(entries, mk) {
    return (entries || []).filter(function (e) {
      return isDateKey(e.date) && monthKeyOf(e.date) === mk;
    });
  }

  function sortEntries(list) {
    return (list || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function entriesOnDay(entries, dayKey, type) {
    var list = (entries || []).filter(function (e) { return e.date === dayKey; });
    return sortEntries(type ? entriesOfType(list, type) : list);
  }

  /* Expense totals per day — what a calendar cell shows. */
  function dayTotals(entries, type) {
    var t = type === 'income' ? 'income' : 'expense';
    var out = {};
    (entries || []).forEach(function (e) {
      if (!isDateKey(e.date) || entryType(e) !== t) return;
      out[e.date] = (out[e.date] || 0) + amountOf(e);
    });
    return out;
  }

  function daysWithIncome(entries) {
    var out = {};
    (entries || []).forEach(function (e) {
      if (entryType(e) === 'income') out[e.date] = (out[e.date] || 0) + amountOf(e);
    });
    return out;
  }

  function isCardEntry(e) { return !!e && entryType(e) === 'expense' && e.methodType === 'card' && !!e.cardId; }

  function findCard(state, cardId) {
    var cards = (state && state.cards) || [];
    for (var i = 0; i < cards.length; i++) if (cards[i].id === cardId) return cards[i];
    return null;
  }

  function findCategory(state, catId, type) {
    var list = type === 'income'
      ? ((state && state.incomeCategories) || [])
      : ((state && state.categories) || []);
    for (var i = 0; i < list.length; i++) if (list[i].id === catId) return list[i];
    return null;
  }

  function methodName(state, entry) {
    if (!entry) return '';
    if (entryType(entry) === 'income') return '입금';
    if (entry.methodType === 'card') {
      var c = findCard(state, entry.cardId);
      return c ? c.name : (entry.methodLabel || '카드');
    }
    if (entry.methodType === 'transfer') return entry.methodLabel || '이체';
    return entry.methodLabel || '현금';
  }

  function categoryName(state, entry) {
    var c = findCategory(state, entry && entry.categoryId, entryType(entry));
    return c ? c.name : (entryType(entry) === 'income' ? '기타 수입' : '기타');
  }

  function categoryEmoji(state, entry) {
    var c = findCategory(state, entry && entry.categoryId, entryType(entry));
    return c ? c.emoji : '📌';
  }

  /* ---------- expense aggregation ---------- */

  function categoryTotals(entries, categories) {
    var total = sumAmounts(entries);
    var byId = {};
    (entries || []).forEach(function (e) {
      var id = e.categoryId || ETC_CATEGORY_ID;
      byId[id] = (byId[id] || 0) + amountOf(e);
    });
    var out = [];
    (categories || []).forEach(function (c) {
      if (byId[c.id]) {
        out.push({
          id: c.id,
          name: c.name,
          emoji: c.emoji,
          total: byId[c.id],
          ratio: total ? byId[c.id] / total : 0
        });
        delete byId[c.id];
      }
    });
    Object.keys(byId).forEach(function (id) {
      out.push({
        id: id,
        name: id === ETC_INCOME_CATEGORY_ID ? '기타 수입' : '기타',
        emoji: '📌',
        total: byId[id],
        ratio: total ? byId[id] / total : 0
      });
    });
    return out.sort(function (a, b) { return b.total - a.total; });
  }

  function cardStats(entries, cards, mk) {
    var list = entriesOfType(entriesInMonth(entries, mk), 'expense');
    return (cards || []).map(function (c) {
      var own = list.filter(function (e) { return isCardEntry(e) && e.cardId === c.id; });
      var spent = sumAmounts(own.filter(function (e) { return !e.excludePerf; }));
      var excluded = sumAmounts(own.filter(function (e) { return !!e.excludePerf; }));
      var goal = Math.max(0, Math.round(+c.goal || 0));
      return {
        id: c.id,
        name: c.name,
        goal: goal,
        spent: spent,
        excluded: excluded,
        paid: spent + excluded,
        pct: goal > 0 ? spent / goal : 0,
        done: goal > 0 && spent >= goal,
        remaining: goal > 0 ? Math.max(0, goal - spent) : 0,
        over: goal > 0 ? Math.max(0, spent - goal) : 0
      };
    });
  }

  function fixedVariable(entries) {
    var list = entriesOfType(entries, 'expense');
    var fixed = sumAmounts(list.filter(function (e) { return e.categoryId === FIXED_CATEGORY_ID; }));
    var total = sumAmounts(list);
    return { fixed: fixed, variable: total - fixed, total: total };
  }

  function topCategories(entries, categories, limit) {
    return categoryTotals(entries, categories).slice(0, limit || 3);
  }

  /* ---------- fixed costs & cash flow ---------- */

  function fixedCostTotal(state) {
    return sumAmounts((state && state.fixedCosts) || []);
  }

  function cardGoalTotal(state) {
    var total = 0;
    ((state && state.cards) || []).forEach(function (c) {
      var g = Math.round(+c.goal || 0);
      if (g > 0) total += g;
    });
    return total;
  }

  /* 이번 달 수입 vs 지출(고정비 포함), 실제 여유 돈, 주간 필요 수입 가이드. */
  function cashFlow(state, mk, todayKey) {
    var list = entriesInMonth(state.entries, mk);
    var income = sumAmounts(entriesOfType(list, 'income'));
    var expense = sumAmounts(entriesOfType(list, 'expense'));
    var fixed = fixedCostTotal(state);
    var cardGoals = cardGoalTotal(state);
    var monthlyNeed = fixed + cardGoals;
    var leftover = income - fixed - expense;

    var status = 'none';
    if (monthlyNeed > 0) {
      if (income <= 0) status = 'unknown';
      else if (income >= monthlyNeed) status = 'good';
      else if (income >= monthlyNeed * 0.85) status = 'tight';
      else status = 'short';
    }

    return {
      income: income,
      expense: expense,
      fixed: fixed,
      cardGoals: cardGoals,
      expenseWithFixed: expense + fixed,
      leftover: leftover,
      monthlyNeed: monthlyNeed,
      weeklyNeed: Math.round(monthlyNeed / WEEKS_PER_MONTH),
      weeklyIncome: Math.round(income / WEEKS_PER_MONTH),
      gap: income - monthlyNeed,
      weeklyGap: Math.round((income - monthlyNeed) / WEEKS_PER_MONTH),
      ratio: monthlyNeed > 0 ? income / monthlyNeed : null,
      status: status
    };
  }

  function monthSummary(state, mk, todayKey) {
    var list = entriesInMonth(state.entries, mk);
    var expenseList = entriesOfType(list, 'expense');
    var incomeList = entriesOfType(list, 'income');
    var total = sumAmounts(expenseList);
    var days = daysInMonth(mk);
    var elapsed = days;
    var todayMk = todayKey ? monthKeyOf(todayKey) : null;
    if (todayMk && mk === todayMk) elapsed = +todayKey.slice(8, 10);
    else if (todayMk && mk > todayMk) elapsed = 0;

    var prevMk = addMonths(mk, -1);
    var prevTotal = sumAmounts(entriesOfType(entriesInMonth(state.entries, prevMk), 'expense'));

    var methods = { card: 0, cash: 0, transfer: 0 };
    expenseList.forEach(function (e) {
      var k = Object.prototype.hasOwnProperty.call(methods, e.methodType) ? e.methodType : 'cash';
      methods[k] += amountOf(e);
    });

    return {
      month: mk,
      total: total,
      count: expenseList.length,
      income: sumAmounts(incomeList),
      incomeCount: incomeList.length,
      dayCount: days,
      elapsedDays: elapsed,
      dailyAvg: elapsed > 0 ? Math.round(total / elapsed) : 0,
      prevMonth: prevMk,
      prevTotal: prevTotal,
      change: prevTotal > 0 ? (total - prevTotal) / prevTotal : null,
      categories: categoryTotals(expenseList, state.categories),
      incomeCategories: categoryTotals(incomeList, state.incomeCategories),
      cards: cardStats(state.entries, state.cards, mk),
      methods: methods,
      excluded: sumAmounts(expenseList.filter(function (e) { return !!e.excludePerf; })),
      fixed: fixedVariable(expenseList),
      flow: cashFlow(state, mk, todayKey)
    };
  }

  /* ---------- state ---------- */

  function createId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function defaultState(now) {
    now = now || new Date();
    return {
      version: VERSION,
      cards: [{ id: DEFAULT_CARD_ID, name: DEFAULT_CARD_NAME, goal: DEFAULT_CARD_GOAL, createdAt: now.toISOString() }],
      categories: DEFAULT_CATEGORIES.map(function (c) { return { id: c.id, name: c.name, emoji: c.emoji }; }),
      incomeCategories: DEFAULT_INCOME_CATEGORIES.map(function (c) { return { id: c.id, name: c.name, emoji: c.emoji }; }),
      fixedCosts: [],
      entries: [],
      settings: {},
      lastCategoryId: null,
      lastIncomeCategoryId: 'inc_online',
      lastMethodId: null
    };
  }

  function cleanName(value, fallback, max) {
    var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!s) return fallback;
    return s.slice(0, max || 20);
  }

  function cleanGoal(value) {
    var n = Math.round(+value || 0);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(n, 1000000000);
  }

  /* Accepts anything (stored data, imported file) and returns a safe state.
     Invalid entries are dropped and counted. */
  function normalizeState(raw) {
    var src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    var state = {
      version: VERSION,
      cards: [],
      categories: [],
      incomeCategories: [],
      fixedCosts: [],
      entries: [],
      settings: {},
      lastCategoryId: null,
      lastIncomeCategoryId: null,
      lastMethodId: null
    };
    var dropped = 0;

    function readCategories(list, fallbackList, fallbackName) {
      var out = [], seen = {};
      (Array.isArray(list) ? list : []).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        var id = typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : createId('cat');
        if (seen[id]) return;
        seen[id] = true;
        out.push({
          id: id,
          name: cleanName(c.name, fallbackName, 20),
          emoji: String(c.emoji || '').slice(0, 8) || '🏷️'
        });
      });
      if (!out.length) {
        out = fallbackList.map(function (c) {
          seen[c.id] = true;
          return { id: c.id, name: c.name, emoji: c.emoji };
        });
      }
      return { list: out, seen: seen };
    }

    var cats = readCategories(src.categories, DEFAULT_CATEGORIES, '이름 없음');
    state.categories = cats.list;
    if (!cats.seen[ETC_CATEGORY_ID]) {
      state.categories.push({ id: ETC_CATEGORY_ID, name: '기타', emoji: '📌' });
      cats.seen[ETC_CATEGORY_ID] = true;
    }

    var incCats = readCategories(src.incomeCategories, DEFAULT_INCOME_CATEGORIES, '기타 수입');
    state.incomeCategories = incCats.list;
    if (!incCats.seen[ETC_INCOME_CATEGORY_ID]) {
      state.incomeCategories.push({ id: ETC_INCOME_CATEGORY_ID, name: '기타 수입', emoji: '📌' });
      incCats.seen[ETC_INCOME_CATEGORY_ID] = true;
    }

    var seenCards = {};
    (Array.isArray(src.cards) ? src.cards : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var id = typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : createId('card');
      if (seenCards[id]) return;
      seenCards[id] = true;
      state.cards.push({ id: id, name: cleanName(c.name, '카드', 20), goal: cleanGoal(c.goal) });
    });

    var seenFixed = {};
    (Array.isArray(src.fixedCosts) ? src.fixedCosts : []).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var name = cleanName(f.name, '', 24);
      if (!name) return;
      var id = typeof f.id === 'string' && f.id ? f.id.slice(0, 40) : createId('fx');
      if (seenFixed[id]) return;
      seenFixed[id] = true;
      state.fixedCosts.push({ id: id, name: name, amount: cleanGoal(f.amount) });
    });

    var seenEntries = {};
    (Array.isArray(src.entries) ? src.entries : []).forEach(function (e) {
      if (!e || typeof e !== 'object') { dropped++; return; }
      if (!isDateKey(e.date)) { dropped++; return; }
      var amount = Math.round(+e.amount);
      if (!isFinite(amount) || amount <= 0 || amount > 999999999) { dropped++; return; }
      var type = entryType(e);
      var catSeen = type === 'income' ? incCats.seen : cats.seen;
      var catFallback = type === 'income' ? ETC_INCOME_CATEGORY_ID : ETC_CATEGORY_ID;
      var catId = typeof e.categoryId === 'string' && e.categoryId ? e.categoryId : catFallback;
      if (!catSeen[catId]) catId = catFallback;

      var methodType;
      var cardId = '';
      if (type === 'income') {
        methodType = e.methodType === 'cash' ? 'cash' : 'transfer';
      } else {
        methodType = e.methodType;
        if (methodType !== 'card' && methodType !== 'cash' && methodType !== 'transfer') methodType = 'cash';
        cardId = methodType === 'card' ? String(e.cardId || '') : '';
        if (methodType === 'card' && !cardId) methodType = 'cash';
      }

      var id = typeof e.id === 'string' && e.id ? e.id.slice(0, 60) : createId('e');
      if (seenEntries[id]) id = createId('e');
      seenEntries[id] = true;
      state.entries.push({
        id: id,
        type: type,
        date: e.date,
        amount: amount,
        categoryId: catId,
        methodType: methodType,
        cardId: cardId,
        methodLabel: typeof e.methodLabel === 'string' ? e.methodLabel.slice(0, 20) : '',
        memo: typeof e.memo === 'string' ? e.memo.slice(0, 60) : '',
        excludePerf: type === 'expense' && !!e.excludePerf,
        createdAt: typeof e.createdAt === 'string' && e.createdAt ? e.createdAt : new Date().toISOString(),
        updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : ''
      });
    });

    if (src.settings && typeof src.settings === 'object') state.settings = src.settings;
    if (typeof src.lastCategoryId === 'string' && cats.seen[src.lastCategoryId]) state.lastCategoryId = src.lastCategoryId;
    if (typeof src.lastIncomeCategoryId === 'string' && incCats.seen[src.lastIncomeCategoryId]) {
      state.lastIncomeCategoryId = src.lastIncomeCategoryId;
    }
    if (typeof src.lastMethodId === 'string') state.lastMethodId = src.lastMethodId;

    return { state: state, dropped: dropped };
  }

  /* Validate an imported backup file before it replaces anything. */
  function validateBackup(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'JSON 객체가 아니에요.' };
    }
    if (!Array.isArray(raw.entries) && !Array.isArray(raw.cards)) {
      return { ok: false, error: 'Spend Note 백업 파일이 아니에요.' };
    }
    if (Array.isArray(raw.entries) && raw.entries.length > 200000) {
      return { ok: false, error: '내역이 너무 많아 불러올 수 없어요.' };
    }
    var result = normalizeState(raw);
    if (Array.isArray(raw.entries) && raw.entries.length > 0 && result.state.entries.length === 0) {
      return { ok: false, error: '읽을 수 있는 내역이 없어요.' };
    }
    return { ok: true, state: result.state, dropped: result.dropped };
  }

  function exportPayload(state, now) {
    now = now || new Date();
    return {
      app: 'spend-note',
      version: VERSION,
      exportedAt: now.toISOString(),
      cards: state.cards,
      categories: state.categories,
      incomeCategories: state.incomeCategories,
      fixedCosts: state.fixedCosts,
      entries: sortEntries(state.entries),
      settings: state.settings || {}
    };
  }

  /* #setup= payload: seeds categories and fixed-cost items without touching records. */
  function applySetup(state, payload) {
    var result = { categories: 0, incomeCategories: 0, fixedCosts: 0, cards: 0, replacedCategories: false };
    if (!payload || typeof payload !== 'object') return result;

    function readList(list) {
      var out = [], seen = {};
      (Array.isArray(list) ? list : []).forEach(function (raw) {
        if (!raw || typeof raw !== 'object') return;
        var name = cleanName(raw.name, '', 20);
        if (!name) return;
        var id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : createId('cat');
        if (seen[id]) return;
        seen[id] = true;
        out.push({ id: id, name: name, emoji: String(raw.emoji || '').slice(0, 8) || '🏷️' });
      });
      return { list: out, seen: seen };
    }

    var cats = readList(payload.categories);
    if (cats.list.length) {
      if (!cats.seen[ETC_CATEGORY_ID]) {
        cats.list.push({ id: ETC_CATEGORY_ID, name: '기타', emoji: '📌' });
        cats.seen[ETC_CATEGORY_ID] = true;
      }
      if (!state.entries.length) {
        // A fresh install has nothing to preserve, so the setup list becomes the whole set.
        state.categories = cats.list;
        result.replacedCategories = true;
        result.categories = cats.list.length;
      } else {
        cats.list.forEach(function (c) {
          var existing = null;
          for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === c.id) { existing = state.categories[i]; break; }
          if (existing) { existing.name = c.name; existing.emoji = c.emoji; }
          else state.categories.push(c);
          result.categories++;
        });
      }
    }

    var incCats = readList(payload.incomeCategories);
    if (incCats.list.length && !state.entries.length) {
      if (!incCats.seen[ETC_INCOME_CATEGORY_ID]) {
        incCats.list.push({ id: ETC_INCOME_CATEGORY_ID, name: '기타 수입', emoji: '📌' });
      }
      state.incomeCategories = incCats.list;
      result.incomeCategories = incCats.list.length;
    }

    (Array.isArray(payload.fixedCosts) ? payload.fixedCosts : []).forEach(function (raw) {
      var name = cleanName(raw && raw.name, '', 24);
      if (!name) return;
      var amount = cleanGoal(raw && raw.amount);
      var existing = null;
      for (var i = 0; i < state.fixedCosts.length; i++) {
        if (state.fixedCosts[i].name === name) { existing = state.fixedCosts[i]; break; }
      }
      if (existing) {
        if (amount > 0) existing.amount = amount;
      } else {
        state.fixedCosts.push({ id: createId('fx'), name: name, amount: amount });
      }
      result.fixedCosts++;
    });

    (Array.isArray(payload.cards) ? payload.cards : []).forEach(function (raw) {
      var name = cleanName(raw && raw.name, '', 20);
      if (!name) return;
      var exists = state.cards.some(function (c) { return c.name === name; });
      if (!exists) {
        state.cards.push({ id: createId('card'), name: name, goal: cleanGoal(raw && raw.goal) });
        result.cards++;
      }
    });

    return result;
  }

  var api = {
    VERSION: VERSION,
    WEEKS_PER_MONTH: WEEKS_PER_MONTH,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    DEFAULT_INCOME_CATEGORIES: DEFAULT_INCOME_CATEGORIES,
    FIXED_CATEGORY_ID: FIXED_CATEGORY_ID,
    ETC_CATEGORY_ID: ETC_CATEGORY_ID,
    ETC_INCOME_CATEGORY_ID: ETC_INCOME_CATEGORY_ID,
    DEFAULT_CARD_ID: DEFAULT_CARD_ID,
    DEFAULT_CARD_GOAL: DEFAULT_CARD_GOAL,
    pad2: pad2,
    dateKey: dateKey,
    parseDateKey: parseDateKey,
    isDateKey: isDateKey,
    monthKey: monthKey,
    monthKeyOf: monthKeyOf,
    isMonthKey: isMonthKey,
    addMonths: addMonths,
    daysInMonth: daysInMonth,
    monthLabel: monthLabel,
    weekdayLabels: weekdayLabels,
    monthGrid: monthGrid,
    formatNumber: formatNumber,
    won: won,
    compactWon: compactWon,
    percentText: percentText,
    parseAmount: parseAmount,
    sanitizeAmountInput: sanitizeAmountInput,
    amountOf: amountOf,
    sumAmounts: sumAmounts,
    entryType: entryType,
    entriesOfType: entriesOfType,
    entriesInMonth: entriesInMonth,
    entriesOnDay: entriesOnDay,
    sortEntries: sortEntries,
    dayTotals: dayTotals,
    daysWithIncome: daysWithIncome,
    isCardEntry: isCardEntry,
    findCard: findCard,
    findCategory: findCategory,
    methodName: methodName,
    categoryName: categoryName,
    categoryEmoji: categoryEmoji,
    categoryTotals: categoryTotals,
    cardStats: cardStats,
    fixedVariable: fixedVariable,
    topCategories: topCategories,
    fixedCostTotal: fixedCostTotal,
    cardGoalTotal: cardGoalTotal,
    cashFlow: cashFlow,
    monthSummary: monthSummary,
    createId: createId,
    defaultState: defaultState,
    normalizeState: normalizeState,
    validateBackup: validateBackup,
    exportPayload: exportPayload,
    applySetup: applySetup
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpendCore = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
