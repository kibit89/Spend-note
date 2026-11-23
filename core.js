/* Spend Note — core logic
 * Pure functions only: no DOM, no storage. Everything the app computes
 * (month totals, cash flow, card performance, account balances, calendar
 * cells, notification parsing, setup links, backup validation) lives here
 * so it can be tested on its own.
 */
(function (root) {
  'use strict';

  var VERSION = 3;
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
  var TRANSFER_CATEGORY_ID = 'transfer';
  var ACCOUNT_KINDS = ['checking', 'pay', 'savings'];
  var KIND_LABELS = { checking: '입출금', pay: '페이', savings: '적금' };

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

  function entryType(e) {
    if (!e) return 'expense';
    if (e.type === 'income') return 'income';
    if (e.type === 'transfer') return 'transfer';
    return 'expense';
  }

  function isTransfer(e) { return entryType(e) === 'transfer'; }

  function entriesOfType(list, type) {
    var t = type === 'income' ? 'income' : (type === 'transfer' ? 'transfer' : 'expense');
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

  /* Expense totals per day — what a calendar cell shows. Transfers are not spending. */
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

  function daysWithTransfer(entries) {
    var out = {};
    (entries || []).forEach(function (e) {
      if (entryType(e) === 'transfer') out[e.date] = (out[e.date] || 0) + amountOf(e);
    });
    return out;
  }

  function isCardEntry(e) { return !!e && entryType(e) === 'expense' && e.methodType === 'card' && !!e.cardId; }

  function findCard(state, cardId) {
    var cards = (state && state.cards) || [];
    for (var i = 0; i < cards.length; i++) if (cards[i].id === cardId) return cards[i];
    return null;
  }

  function findAccount(state, accountId) {
    var list = (state && state.accounts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === accountId) return list[i];
    return null;
  }

  function isCashAccount(a) { return !!a && (a.kind === 'checking' || a.kind === 'pay'); }
  function isSavingsAccount(a) { return !!a && a.kind === 'savings'; }

  function findCategory(state, catId, type) {
    var list = type === 'income'
      ? ((state && state.incomeCategories) || [])
      : ((state && state.categories) || []);
    for (var i = 0; i < list.length; i++) if (list[i].id === catId) return list[i];
    return null;
  }

  /* Card that draws straight from a bank account (a check/debit card). */
  function cardDebitAccountId(state, entry) {
    if (!entry || entryType(entry) !== 'expense' || entry.methodType !== 'card') return '';
    var card = findCard(state, entry.cardId);
    if (!card || card.credit !== false) return '';
    return card.accountId || '';
  }

  function methodName(state, entry) {
    if (!entry) return '';
    var t = entryType(entry);
    if (t === 'transfer') {
      var from = findAccount(state, entry.fromAccountId);
      var to = findAccount(state, entry.toAccountId);
      return (from ? from.name : (entry.fromLabel || '출금 계좌')) + ' → ' +
        (to ? to.name : (entry.toLabel || '입금 계좌'));
    }
    if (entry.methodType === 'card') {
      var c = findCard(state, entry.cardId);
      return c ? c.name : (entry.methodLabel || '카드');
    }
    if (entry.methodType === 'account') {
      var a = findAccount(state, entry.accountId);
      return a ? a.name : (entry.methodLabel || '계좌');
    }
    if (t === 'income') return entry.methodType === 'cash' ? '현금' : '입금';
    if (entry.methodType === 'transfer') return entry.methodLabel || '이체';
    return entry.methodLabel || '현금';
  }

  function categoryName(state, entry) {
    if (entryType(entry) === 'transfer') return '이체';
    var c = findCategory(state, entry && entry.categoryId, entryType(entry));
    return c ? c.name : (entryType(entry) === 'income' ? '기타 수입' : '기타');
  }

  function categoryEmoji(state, entry) {
    if (entryType(entry) === 'transfer') return '🔁';
    var c = findCategory(state, entry && entry.categoryId, entryType(entry));
    return c ? c.emoji : '📌';
  }

  /* ---------- aggregation ---------- */

  function categoryTotals(entries, categories) {
    var total = sumAmounts(entries);
    var byId = {};
    (entries || []).forEach(function (e) {
      if (entryType(e) !== 'expense' && entryType(e) !== 'income') return;
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
        credit: c.credit !== false,
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
    var transferList = entriesOfType(list, 'transfer');
    var total = sumAmounts(expenseList);
    var days = daysInMonth(mk);
    var elapsed = days;
    var todayMk = todayKey ? monthKeyOf(todayKey) : null;
    if (todayMk && mk === todayMk) elapsed = +todayKey.slice(8, 10);
    else if (todayMk && mk > todayMk) elapsed = 0;

    var prevMk = addMonths(mk, -1);
    var prevTotal = sumAmounts(entriesOfType(entriesInMonth(state.entries, prevMk), 'expense'));

    var methods = { card: 0, cash: 0, account: 0, transfer: 0 };
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
      transferCount: transferList.length,
      transferTotal: sumAmounts(transferList),
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

  /* ---------- accounts & assets ---------- */

  function accountKind(kind) {
    return ACCOUNT_KINDS.indexOf(kind) >= 0 ? kind : 'checking';
  }

  /* How one entry moves one account's money. Transfers move it between two accounts. */
  function entryAccountDelta(state, entry, accountId) {
    if (!entry || !accountId) return 0;
    var t = entryType(entry);
    if (t === 'transfer') {
      if (entry.fromAccountId === accountId) return -amountOf(entry);
      if (entry.toAccountId === accountId) return amountOf(entry);
      return 0;
    }
    if (t === 'expense') {
      if (entry.methodType === 'account' && entry.accountId === accountId) return -amountOf(entry);
      if (cardDebitAccountId(state, entry) === accountId) return -amountOf(entry);
      return 0;
    }
    if (t === 'income' && entry.methodType === 'account' && entry.accountId === accountId) {
      return amountOf(entry);
    }
    return 0;
  }

  /* 기준 잔액(opening) + 기준일 이후 기록의 증감 = 지금 잔액. */
  function accountBalance(state, accountId) {
    var acc = findAccount(state, accountId);
    if (!acc) return 0;
    var opening = Math.round(+acc.opening || 0);
    var anchor = isDateKey(acc.anchorDate) ? acc.anchorDate : '';
    var delta = 0;
    ((state && state.entries) || []).forEach(function (e) {
      if (!isDateKey(e.date)) return;
      if (anchor && e.date < anchor) return;
      delta += entryAccountDelta(state, e, accountId);
    });
    return opening + delta;
  }

  /* 잔액을 오늘 기준으로 맞출 때 쓰는 기준 잔액. */
  function openingForTarget(state, accountId, target, anchorDate) {
    var acc = findAccount(state, accountId);
    if (!acc) return Math.round(+target || 0);
    var anchor = isDateKey(anchorDate) ? anchorDate : (isDateKey(acc.anchorDate) ? acc.anchorDate : '');
    var delta = 0;
    ((state && state.entries) || []).forEach(function (e) {
      if (!isDateKey(e.date)) return;
      if (anchor && e.date < anchor) return;
      delta += entryAccountDelta(state, e, accountId);
    });
    return Math.round(+target || 0) - delta;
  }

  function cashAccounts(state) {
    return ((state && state.accounts) || []).filter(isCashAccount);
  }

  function savingsAccounts(state) {
    return ((state && state.accounts) || []).filter(isSavingsAccount);
  }

  function transferredIn(state, accountId, mk) {
    var sum = 0;
    entriesInMonth((state && state.entries) || [], mk).forEach(function (e) {
      if (entryType(e) === 'transfer' && e.toAccountId === accountId) sum += amountOf(e);
    });
    return sum;
  }

  function emergencyGoal(state) {
    var g = Math.round(+((state && state.settings && state.settings.emergencyGoal) || 0));
    return isFinite(g) && g > 0 ? g : 0;
  }

  /* 전체 자산 · 비상금 게이지 · 지금 쓸 수 있는 진짜 여윳돈. */
  function assetSnapshot(state, mk) {
    mk = isMonthKey(mk) ? mk : monthKey(new Date());
    var accounts = ((state && state.accounts) || []).map(function (a) {
      return {
        id: a.id,
        name: a.name,
        kind: accountKind(a.kind),
        emoji: a.emoji || (a.kind === 'savings' ? '🏦' : (a.kind === 'pay' ? '📱' : '💳')),
        balance: accountBalance(state, a.id),
        opening: Math.round(+a.opening || 0),
        anchorDate: isDateKey(a.anchorDate) ? a.anchorDate : '',
        monthly: Math.max(0, Math.round(+a.monthly || 0)),
        emergency: !!a.emergency
      };
    });

    var cash = 0, savings = 0, emergencyCurrent = 0, emergencyCount = 0;
    accounts.forEach(function (a) {
      if (a.kind === 'savings') savings += a.balance;
      else cash += a.balance;
      if (a.emergency) { emergencyCurrent += a.balance; emergencyCount++; }
    });

    var goal = emergencyGoal(state);
    var remaining = goal > 0 ? Math.max(0, goal - emergencyCurrent) : 0;
    var pct = goal > 0 ? emergencyCurrent / goal : 0;

    var fixedTotal = fixedCostTotal(state);
    var fixedSpent = 0;
    var cardDue = 0;
    entriesInMonth((state && state.entries) || [], mk).forEach(function (e) {
      if (entryType(e) !== 'expense') return;
      if (e.categoryId === FIXED_CATEGORY_ID) fixedSpent += amountOf(e);
      if (e.methodType === 'card') {
        var card = findCard(state, e.cardId);
        if (card && card.credit !== false) cardDue += amountOf(e);
      }
    });
    var fixedLeft = Math.max(0, fixedTotal - fixedSpent);

    var savingsLeft = 0;
    accounts.forEach(function (a) {
      if (a.kind !== 'savings' || a.monthly <= 0) return;
      savingsLeft += Math.max(0, a.monthly - transferredIn(state, a.id, mk));
    });

    var reserved = fixedLeft + cardDue + savingsLeft;

    return {
      month: mk,
      hasAccounts: accounts.length > 0,
      accounts: accounts,
      cashAccounts: accounts.filter(function (a) { return a.kind !== 'savings'; }),
      savingsAccounts: accounts.filter(function (a) { return a.kind === 'savings'; }),
      cash: cash,
      savings: savings,
      total: cash + savings,
      emergencyCurrent: emergencyCurrent,
      emergencyCount: emergencyCount,
      emergencyGoal: goal,
      emergencyRemaining: remaining,
      emergencyPct: pct,
      emergencyDone: goal > 0 && emergencyCurrent >= goal,
      fixedTotal: fixedTotal,
      fixedSpent: fixedSpent,
      fixedLeft: fixedLeft,
      cardDue: cardDue,
      savingsLeft: savingsLeft,
      reserved: reserved,
      spendable: accounts.length ? cash - reserved : null
    };
  }

  /* ---------- notification parser ---------- */

  var PARSER_KEYWORDS = {
    expense: /승인|결제|출금|출금됨|사용|구매|인출|자동이체|차감|과금|해외원화|일시불|할부/,
    income: /입금|충전|받았|받은|수입|급여|환불|캐시백|이자|입금됨|정산/,
    transfer: /이체|송금|보냈|옮겼|이동/,
    cancel: /취소|승인취소/
  };

  var MEMO_STOPWORDS = /(승인|결제|출금|출금됨|입금|입금됨|이체|송금|잔액|누적|사용|충전|자동|정상|완료|처리|안내|알림|금액|계좌|카드|일시불|할부|취소|승인취소|내역|고객|님|해외|국내|원화|포인트|적립|사용가능|잔여|한도|실적|거래|은행|뱅크|페이|atm|ATM|체크|신용)/g;
  var MEMO_PARTICLES = /^(에서|으로|로부터|로|에게|에|은|는|이|가|을|를|의|와|과|도|만|까지|부터|께|했|합니다|했습니다|했어요|되었습니다|됨|됐음|완료)$/;

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findMentions(text, state) {
    var out = [];
    function add(type, item, extra) {
      var name = String(item.name || '').trim();
      if (name.length < 2) return;
      var idx = text.indexOf(name);
      if (idx < 0) return;
      var hit = { type: type, id: item.id, name: name, index: idx, end: idx + name.length };
      if (extra) hit.kind = extra;
      out.push(hit);
    }
    ((state && state.cards) || []).forEach(function (c) { add('card', c); });
    ((state && state.accounts) || []).forEach(function (a) { add('account', a, accountKind(a.kind)); });

    /* "별페이플러스" 안의 "별페이"처럼 더 긴 이름에 완전히 들어가는 짧은 이름은 버린다. */
    var kept = out.filter(function (m) {
      return !out.some(function (o) {
        return o !== m && o.name.length > m.name.length && o.index <= m.index && o.end >= m.end;
      });
    });
    return kept.sort(function (a, b) {
      if (a.index !== b.index) return a.index - b.index;
      return b.name.length - a.name.length;
    });
  }

  function extractAmounts(text) {
    var list = [], m, re = /(\d[\d,]{0,11})\s*원/g;
    while ((m = re.exec(text))) {
      list.push({ value: parseInt(m[1].replace(/,/g, ''), 10), index: m.index, end: re.lastIndex, raw: m[0] });
    }
    if (!list.length) {
      re = /(?:승인|결제|출금|입금|이체|송금|충전|사용)\s*(?:금액)?\s*:?\s*(\d[\d,]{0,11})/g;
      while ((m = re.exec(text))) {
        list.push({ value: parseInt(m[1].replace(/,/g, ''), 10), index: m.index, end: re.lastIndex, raw: m[0] });
      }
    }
    var out = [];
    list.forEach(function (a) {
      if (!isFinite(a.value) || a.value <= 0) return;
      var before = text.slice(Math.max(0, a.index - 8), a.index);
      var isBalance = /잔액|누적|한도|잔여|포인트|사용가능|합계/.test(before);
      out.push({ value: a.value, index: a.index, end: a.end, raw: a.raw, balance: isBalance });
    });
    return out;
  }

  function pickAmount(text, amounts) {
    var usable = amounts.filter(function (a) { return !a.balance; });
    if (!usable.length) return null;
    if (usable.length === 1) return usable[0];
    var keyword = /승인|결제|출금|입금|이체|송금|충전|사용/;
    var best = null, bestScore = -1;
    usable.forEach(function (a) {
      var around = text.slice(Math.max(0, a.index - 12), Math.min(text.length, a.end + 12));
      var score = 0;
      if (keyword.test(around)) score += 2;
      if (keyword.test(text.slice(Math.max(0, a.index - 12), a.index))) score += 1;
      if (a.index < 20) score += 1;
      if (score > bestScore) { bestScore = score; best = a; }
    });
    return best || usable[0];
  }

  function cleanMemo(text, mentions, amounts) {
    var t = ' ' + text + ' ';
    t = t.replace(/(?:\[|\()?\s*(?:web|웹)?발신\s*(?:\]|\))?/gi, ' ');
    t = t.replace(/\d[\d,]{0,11}\s*원/g, ' ');
    t = t.replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g, ' ');
    t = t.replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ');
    t = t.replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ');
    t = t.replace(/\d{1,2}:\d{2}/g, ' ');
    mentions.forEach(function (m) { t = t.split(m.name).join(' '); });
    t = t.replace(MEMO_STOPWORDS, ' ');
    t = t.replace(/[\[\]\(\)\{\}<>:·•\-_/|,\.!\?~"'`*#@→←⇒▲▶<>]+/g, ' ');
    t = t.replace(/\b\d+\b/g, ' ');
    var words = t.split(/\s+/).filter(function (w) {
      return w.length >= 2 && !MEMO_PARTICLES.test(w);
    });
    var out = words.join(' ').trim();
    if (out.length > 30) out = out.slice(0, 30).trim();
    return out;
  }

  var CATEGORY_RULES = [
    { re: /카페|커피|스타벅스|투썸|이디야|메가커피|컴포즈|빽다방|베이커리|빵집/, names: ['카페', '커피', '간식'] },
    { re: /알리|테무|핀둬둬|쉬인|아이허브|직구/, names: ['해외직구', '직구', '쇼핑'] },
    { re: /반찬/, names: ['반찬', '식비'] },
    { re: /마트|편의점|gs25|cu|세븐일레븐|이마트|홈플러스|코스트코|생활|슈퍼/, names: ['생활', '마트', '장보기'] },
    { re: /식당|김밥|국밥|치킨|배달|분식|음식|식비|식사|고기|피자|버거|떡볶이|백반/, names: ['식비', '음식', '외식'] },
    { re: /택시|버스|지하철|주유|기차|ktx|교통|주차|톨게이트/, names: ['교통'] },
    { re: /약국|병원|의원|치과|한의원/, names: ['의료', '병원'] }
  ];

  function guessCategoryId(state, text) {
    if (!state) return null;
    var cats = state.categories || [];
    var lower = normalizeText(text).toLowerCase();
    var byLiteral = null;
    cats.forEach(function (c) {
      var name = String(c.name || '').trim();
      if (name.length >= 2 && lower.indexOf(name.toLowerCase()) >= 0) {
        if (!byLiteral || name.length > byLiteral.name.length) byLiteral = c;
      }
    });
    if (byLiteral) return byLiteral.id;

    function matchAlias(alias) {
      var exact = cats.filter(function (c) { return c.name === alias; })[0];
      if (exact) return exact;
      return cats.filter(function (c) {
        return String(c.name || '').indexOf(alias) >= 0 || alias.indexOf(String(c.name || '')) >= 0;
      })[0] || null;
    }
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      var rule = CATEGORY_RULES[i];
      if (!rule.re.test(lower)) continue;
      for (var j = 0; j < rule.names.length; j++) {
        var hit = matchAlias(rule.names[j]);
        if (hit) return hit.id;
      }
    }
    return null;
  }

  function categoryIdByName(state, name, type) {
    var list = type === 'income' ? ((state && state.incomeCategories) || []) : ((state && state.categories) || []);
    var want = cleanName(name, '', 30);
    if (!want) return null;
    for (var i = 0; i < list.length; i++) if (list[i].name === want) return list[i].id;
    for (var j = 0; j < list.length; j++) if (list[j].name.replace(/\s+/g, '') === want.replace(/\s+/g, '')) return list[j].id;
    return null;
  }

  function accountIdByName(state, name) {
    var want = cleanName(name, '', 30);
    if (!want) return null;
    var list = (state && state.accounts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === want) return list[i].id;
    for (var j = 0; j < list.length; j++) if (list[j].name.replace(/\s+/g, '') === want.replace(/\s+/g, '')) return list[j].id;
    return null;
  }

  function cardIdByName(state, name) {
    var want = cleanName(name, '', 30);
    if (!want) return null;
    var list = (state && state.cards) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === want) return list[i].id;
    for (var j = 0; j < list.length; j++) if (list[j].name.replace(/\s+/g, '') === want.replace(/\s+/g, '')) return list[j].id;
    return null;
  }

  /* Bank / card / pay push or SMS text → the fields the entry form needs.
     Everything it cannot work out is left empty rather than guessed. */
  function parseNotification(text, state) {
    var s = normalizeText(text);
    var out = {
      ok: false,
      raw: s,
      type: 'expense',
      amount: 0,
      methodType: 'cash',
      cardId: '',
      accountId: '',
      fromAccountId: '',
      toAccountId: '',
      categoryId: null,
      memo: '',
      canceled: false,
      confidence: 0,
      reason: ''
    };
    if (!s) { out.reason = 'empty'; return out; }

    var mentions = findMentions(s, state);
    var amounts = extractAmounts(s);
    var picked = pickAmount(s, amounts);
    if (!picked) { out.reason = 'amount'; out.memo = cleanMemo(s, mentions, amounts); return out; }
    out.amount = picked.value;

    out.canceled = PARSER_KEYWORDS.cancel.test(s);

    var cards = mentions.filter(function (m) { return m.type === 'card'; });
    var accounts = mentions.filter(function (m) { return m.type === 'account'; });

    var expenseHit = PARSER_KEYWORDS.expense.test(s);
    var incomeHit = PARSER_KEYWORDS.income.test(s);

    var distinctAccounts = [];
    accounts.forEach(function (a) {
      if (!distinctAccounts.some(function (x) { return x.id === a.id; })) distinctAccounts.push(a);
    });

    var transferHit = PARSER_KEYWORDS.transfer.test(s) ||
      (distinctAccounts.length >= 2 && /출금/.test(s) && /입금/.test(s));

    /* 내 계좌 사이 이동: 이체/송금 문구나 출금·입금 짝 + 서로 다른 두 계좌 */
    if (transferHit && distinctAccounts.length >= 2 && !cards.length) {
      out.type = 'transfer';
      function pickNear(keywordRe, fallback) {
        var idx = s.search(keywordRe);
        if (idx < 0) return fallback;
        var best = fallback, bestD = Infinity;
        distinctAccounts.forEach(function (a) {
          var d = Math.abs(a.index - idx);
          if (d < bestD) { bestD = d; best = a; }
        });
        return best;
      }
      var fromA = pickNear(/출금|보냈|보내|보낸/, distinctAccounts[0]);
      var toA = pickNear(/입금|받았|받은|받는/, distinctAccounts[1] || distinctAccounts[0]);
      if (fromA.id === toA.id) { fromA = distinctAccounts[0]; toA = distinctAccounts[1]; }
      out.fromAccountId = fromA.id;
      out.toAccountId = toA.id;
      out.memo = cleanMemo(s, mentions, amounts).slice(0, 60) || '내 계좌 이체';
      out.confidence = 0.9;
      out.ok = true;
      return out;
    }

    if (transferHit && distinctAccounts.length === 1) {
      // One account named: it left that account (or arrived, when 입금 is the only verb).
      if (incomeHit && !expenseHit) {
        out.type = 'income';
        out.methodType = 'account';
        out.accountId = distinctAccounts[0].id;
      } else {
        out.type = 'expense';
        out.methodType = 'account';
        out.accountId = distinctAccounts[0].id;
      }
    } else if (incomeHit && !expenseHit) {
      out.type = 'income';
    } else if (expenseHit) {
      out.type = 'expense';
    } else if (cards.length) {
      out.type = 'expense';
    } else if (incomeHit) {
      out.type = 'income';
    } else {
      out.reason = 'type';
    }

    if (out.type === 'income') {
      if (accounts.length) {
        out.methodType = 'account';
        out.accountId = accounts[0].id;
      } else if (/현금/.test(s)) {
        out.methodType = 'cash';
      } else {
        out.methodType = 'cash';
      }
      out.categoryId = null;
      out.memo = cleanMemo(s, mentions, amounts);
    } else {
      if (cards.length) {
        out.methodType = 'card';
        out.cardId = cards[0].id;
      } else if (accounts.length) {
        out.methodType = 'account';
        out.accountId = accounts[0].id;
      } else if (/현금/.test(s)) {
        out.methodType = 'cash';
      } else if (/카드/.test(s) && (state.cards || []).length) {
        out.methodType = 'card';
        out.cardId = state.cards[0].id;
      } else {
        out.methodType = 'cash';
      }
      out.memo = cleanMemo(s, mentions, amounts);
      out.categoryId = guessCategoryId(state, s);
    }

    out.confidence = (out.amount > 0 ? 0.5 : 0) + (out.type ? 0.2 : 0) +
      (out.methodType !== 'cash' ? 0.2 : 0) + (out.categoryId ? 0.1 : 0);
    out.ok = out.amount > 0;
    return out;
  }

  /* ---------- state ---------- */

  function createId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function defaultState(now) {
    now = now || new Date();
    return {
      version: VERSION,
      accounts: [],
      cards: [],
      categories: DEFAULT_CATEGORIES.map(function (c) { return { id: c.id, name: c.name, emoji: c.emoji }; }),
      incomeCategories: DEFAULT_INCOME_CATEGORIES.map(function (c) { return { id: c.id, name: c.name, emoji: c.emoji }; }),
      fixedCosts: [],
      entries: [],
      settings: { emergencyGoal: 0 },
      lastCategoryId: null,
      lastIncomeCategoryId: 'inc_online',
      lastMethodId: null,
      lastAccountId: null
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

  /* Balance may be negative (overdraft); keep the sign but bound it. */
  function cleanMoney(value) {
    var n = Math.round(+value || 0);
    if (!isFinite(n)) return 0;
    return Math.max(-999999999, Math.min(999999999, n));
  }

  /* Accepts anything (stored data, imported file) and returns a safe state.
     Invalid entries are dropped and counted. Older (v2) data has no accounts,
     no transfers, and cards without a credit flag — all of that is filled in here. */
  function normalizeState(raw) {
    var src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    var state = {
      version: VERSION,
      accounts: [],
      cards: [],
      categories: [],
      incomeCategories: [],
      fixedCosts: [],
      entries: [],
      settings: {},
      lastCategoryId: null,
      lastIncomeCategoryId: null,
      lastMethodId: null,
      lastAccountId: null
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

    var seenAccounts = {};
    (Array.isArray(src.accounts) ? src.accounts : []).forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      var name = cleanName(a.name, '', 24);
      if (!name) return;
      var id = typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : accountIdFor(name);
      if (seenAccounts[id]) return;
      seenAccounts[id] = true;
      state.accounts.push({
        id: id,
        name: name,
        kind: accountKind(a.kind),
        emoji: String(a.emoji || '').slice(0, 8) || (a.kind === 'savings' ? '🏦' : (a.kind === 'pay' ? '📱' : '💳')),
        opening: cleanMoney(a.opening != null ? a.opening : a.balance),
        anchorDate: isDateKey(a.anchorDate) ? a.anchorDate : '',
        monthly: cleanGoal(a.monthly),
        emergency: !!a.emergency,
        createdAt: typeof a.createdAt === 'string' ? a.createdAt : ''
      });
    });

    var seenCards = {};
    (Array.isArray(src.cards) ? src.cards : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var id = typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : createId('card');
      if (seenCards[id]) return;
      seenCards[id] = true;
      var linked = typeof c.accountId === 'string' && seenAccounts[c.accountId] ? c.accountId : '';
      state.cards.push({
        id: id,
        name: cleanName(c.name, '카드', 20),
        goal: cleanGoal(c.goal),
        credit: c.credit === false ? false : true,
        accountId: linked
      });
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

      var methodType = 'cash';
      var cardId = '';
      var accountId = '';
      var fromAccountId = '';
      var toAccountId = '';

      if (type === 'transfer') {
        fromAccountId = typeof e.fromAccountId === 'string' && seenAccounts[e.fromAccountId] ? e.fromAccountId : '';
        toAccountId = typeof e.toAccountId === 'string' && seenAccounts[e.toAccountId] ? e.toAccountId : '';
        if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) { dropped++; return; }
        catId = '';
      } else if (type === 'income') {
        methodType = e.methodType === 'account' ? 'account' : (e.methodType === 'cash' ? 'cash' : 'transfer');
        if (methodType === 'account') {
          accountId = typeof e.accountId === 'string' && seenAccounts[e.accountId] ? e.accountId : '';
          if (!accountId) methodType = 'cash';
        }
      } else {
        methodType = e.methodType;
        if (methodType !== 'card' && methodType !== 'cash' && methodType !== 'account' && methodType !== 'transfer') {
          methodType = 'cash';
        }
        if (methodType === 'card') {
          cardId = typeof e.cardId === 'string' ? e.cardId : '';
          if (cardId && !seenCards[cardId]) cardId = '';
          if (!cardId) methodType = 'cash';
        } else if (methodType === 'account') {
          accountId = typeof e.accountId === 'string' && seenAccounts[e.accountId] ? e.accountId : '';
          if (!accountId) methodType = 'cash';
        }
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
        accountId: accountId,
        fromAccountId: fromAccountId,
        toAccountId: toAccountId,
        methodLabel: typeof e.methodLabel === 'string' ? e.methodLabel.slice(0, 20) : '',
        memo: typeof e.memo === 'string' ? e.memo.slice(0, 60) : '',
        excludePerf: type === 'expense' && !!e.excludePerf,
        origin: typeof e.origin === 'string' ? e.origin.slice(0, 80) : '',
        createdAt: typeof e.createdAt === 'string' && e.createdAt ? e.createdAt : new Date().toISOString(),
        updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : ''
      });
    });

    var settings = (src.settings && typeof src.settings === 'object') ? src.settings : {};
    state.settings = { emergencyGoal: cleanGoal(settings.emergencyGoal || settings.emergency || 0) };
    if (typeof src.lastCategoryId === 'string' && cats.seen[src.lastCategoryId]) state.lastCategoryId = src.lastCategoryId;
    if (typeof src.lastIncomeCategoryId === 'string' && incCats.seen[src.lastIncomeCategoryId]) {
      state.lastIncomeCategoryId = src.lastIncomeCategoryId;
    }
    if (typeof src.lastMethodId === 'string') state.lastMethodId = src.lastMethodId;
    if (typeof src.lastAccountId === 'string' && seenAccounts[src.lastAccountId]) state.lastAccountId = src.lastAccountId;

    return { state: state, dropped: dropped };
  }

  /* Validate an imported backup file before it replaces anything. */
  function validateBackup(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'JSON 객체가 아니에요.' };
    }
    if (!Array.isArray(raw.entries) && !Array.isArray(raw.cards) && !Array.isArray(raw.accounts)) {
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
      accounts: state.accounts,
      cards: state.cards,
      categories: state.categories,
      incomeCategories: state.incomeCategories,
      fixedCosts: state.fixedCosts,
      entries: sortEntries(state.entries),
      settings: state.settings || {}
    };
  }

  /* ---------- #setup= payload ---------- */

  function setupCatList(raw) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (item) {
      var name = '', emoji = '';
      if (typeof item === 'string') name = item;
      else if (Array.isArray(item)) { name = item[0]; emoji = item[1]; }
      else if (item && typeof item === 'object') { name = item.name; emoji = item.emoji; }
      name = cleanName(name, '', 20);
      if (!name) return;
      out.push({ name: name, emoji: String(emoji || '').slice(0, 8) || '🏷️' });
    });
    return out;
  }

  function setupAmountList(raw, maxLen) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (item) {
      var name = '', amount = 0;
      if (typeof item === 'string') name = item;
      else if (Array.isArray(item)) { name = item[0]; amount = item[1]; }
      else if (item && typeof item === 'object') { name = item.name; amount = item.amount; }
      name = cleanName(name, '', maxLen || 24);
      if (!name) return;
      out.push({ name: name, amount: cleanGoal(amount) });
    });
    return out;
  }

  function setupCardList(raw) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (item) {
      var name = '', goal = 0, credit = true, accountName = '';
      if (typeof item === 'string') name = item;
      else if (Array.isArray(item)) {
        name = item[0]; goal = item[1];
        if (item[2] === 'check' || item[2] === 'debit' || item[2] === false) credit = false;
        if (typeof item[3] === 'string') accountName = item[3];
      } else if (item && typeof item === 'object') {
        name = item.name; goal = item.goal != null ? item.goal : item.amount;
        credit = item.credit === false ? false : (item.kind === 'check' ? false : true);
        accountName = item.account || item.accountName || '';
      }
      name = cleanName(name, '', 20);
      if (!name) return;
      out.push({ name: name, goal: cleanGoal(goal), credit: credit, accountName: accountName });
    });
    return out;
  }

  /* Accounts: [name, opening, kind?] or [name, opening, monthly?] for savings. */
  function setupAccountList(raw, defaultKind) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (item) {
      var name = '', opening = 0, kind = defaultKind, monthly = 0, emergency = null, emoji = '';
      if (typeof item === 'string') name = item;
      else if (Array.isArray(item)) {
        name = item[0];
        opening = item[1];
        if (defaultKind === 'savings') {
          monthly = item[2];
          if (item[3] != null) emergency = !!item[3];
        } else {
          if (item[2]) kind = item[2];
          if (item[3] != null) emergency = !!item[3];
        }
      } else if (item && typeof item === 'object') {
        name = item.name;
        opening = item.opening != null ? item.opening : item.balance;
        kind = item.kind || defaultKind;
        monthly = item.monthly;
        emergency = item.emergency;
        emoji = item.emoji || '';
      }
      name = cleanName(name, '', 24);
      if (!name) return;
      out.push({
        name: name,
        kind: accountKind(kind),
        opening: cleanMoney(opening),
        monthly: cleanGoal(monthly),
        emergency: emergency == null ? defaultKind === 'savings' : !!emergency,
        emoji: String(emoji || '').slice(0, 8)
      });
    });
    return out;
  }

  /* Stable id for a name, so applying the same link twice never duplicates. */
  var SPECIAL_CATEGORY_IDS = { '고정비': 'fixed', '기타': 'etc', '기타 수입': 'inc_etc' };

  function setupCategoryId(name, prefix) {
    if (SPECIAL_CATEGORY_IDS[name]) return SPECIAL_CATEGORY_IDS[name];
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return prefix + '_' + Math.abs(h).toString(36);
  }

  function accountIdFor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return 'acc_' + Math.abs(h).toString(36);
  }

  function applySetup(state, payload) {
    var result = {
      categories: 0, incomeCategories: 0, fixedCosts: 0, cards: 0,
      accounts: 0, savings: 0, emergencyGoal: 0, replacedCategories: false
    };
    if (!payload || typeof payload !== 'object') return result;

    function fillCategoryList(list, incoming, prefix, etcId, etcName) {
      if (!incoming.length) return 0;
      var addEtc = false;
      function ensureEtc() {
        if (list.some(function (c) { return c.id === etcId; })) return;
        list.push({ id: etcId, name: etcName, emoji: '📌' });
        addEtc = !incoming.some(function (c) { return c.name === etcName; });
      }
      if (!state.entries.length) {
        // A fresh install has nothing to preserve, so the setup list becomes the whole set.
        list.length = 0;
        incoming.forEach(function (c) {
          list.push({ id: setupCategoryId(c.name, prefix), name: c.name, emoji: c.emoji });
        });
        ensureEtc();
        return incoming.length + (addEtc ? 1 : 0);
      }
      incoming.forEach(function (c) {
        var existing = null;
        var wantedId = setupCategoryId(c.name, prefix);
        for (var i = 0; i < list.length; i++) {
          if (list[i].name === c.name || list[i].id === wantedId) { existing = list[i]; break; }
        }
        if (!existing) {
          /* An older combined name ('카페·간식' for '카페') is the same shelf: rename it
             instead of leaving two near-identical categories with records split across them. */
          var loose = list.filter(function (x) {
            if (x.id === etcId) return false;
            return x.name.indexOf(c.name) >= 0 || c.name.indexOf(x.name) >= 0;
          });
          if (loose.length === 1) existing = loose[0];
        }
        if (existing) { existing.name = c.name; existing.emoji = c.emoji; }
        else list.push({ id: wantedId, name: c.name, emoji: c.emoji });
      });
      ensureEtc();
      return incoming.length + (addEtc ? 1 : 0);
    }

    var cats = setupCatList(payload.c || payload.categories);
    result.categories = fillCategoryList(state.categories, cats, 'cat', ETC_CATEGORY_ID, '기타');
    result.replacedCategories = !state.entries.length && cats.length > 0;

    var inc = setupCatList(payload.ic || payload.incomeCategories);
    result.incomeCategories = fillCategoryList(state.incomeCategories, inc, 'icat', ETC_INCOME_CATEGORY_ID, '기타 수입');

    setupAmountList(payload.f || payload.fixedCosts, 24).forEach(function (item) {
      var existing = null;
      for (var i = 0; i < state.fixedCosts.length; i++) {
        if (state.fixedCosts[i].name === item.name) { existing = state.fixedCosts[i]; break; }
      }
      if (existing) {
        if (item.amount > 0) existing.amount = item.amount;
      } else {
        state.fixedCosts.push({ id: createId('fx'), name: item.name, amount: item.amount });
      }
      result.fixedCosts++;
    });

    function upsertAccount(item, defaultKind) {
      var existing = null;
      var wantedId = accountIdFor(item.name);
      for (var i = 0; i < state.accounts.length; i++) {
        if (state.accounts[i].name === item.name || state.accounts[i].id === wantedId) { existing = state.accounts[i]; break; }
      }
      if (existing) {
        existing.kind = item.kind;
        if (item.opening && !existing.opening) existing.opening = item.opening;
        if (item.monthly) existing.monthly = item.monthly;
        if (item.emoji) existing.emoji = item.emoji;
        if (item.emergency === true) existing.emergency = true;
        if (!isDateKey(existing.anchorDate)) existing.anchorDate = '';
        return false;
      }
      state.accounts.push({
        id: wantedId,
        name: item.name,
        kind: item.kind || defaultKind,
        emoji: item.emoji || (item.kind === 'savings' ? '🏦' : (item.kind === 'pay' ? '📱' : '💳')),
        opening: item.opening,
        anchorDate: '',
        monthly: item.monthly,
        emergency: item.emergency,
        createdAt: new Date().toISOString()
      });
      return true;
    }

    var cashItems = setupAccountList(payload.a || payload.accounts, 'checking');
    cashItems.forEach(function (item) {
      if (upsertAccount(item, item.kind === 'savings' ? 'savings' : 'checking')) {
        if (item.kind === 'savings') result.savings++; else result.accounts++;
      }
    });
    var savingsItems = setupAccountList(payload.s || payload.savings, 'savings');
    savingsItems.forEach(function (item) {
      if (upsertAccount(item, 'savings')) result.savings++;
    });

    var cards = setupCardList(payload.cards || payload.k);
    cards.forEach(function (item) {
      var existing = null;
      for (var i = 0; i < state.cards.length; i++) {
        if (state.cards[i].name === item.name) { existing = state.cards[i]; break; }
      }
      if (existing) {
        if (item.goal > 0) existing.goal = item.goal;
        existing.credit = item.credit;
        if (item.accountName) existing.accountId = accountIdByName(state, item.accountName) || existing.accountId || '';
      } else {
        state.cards.push({
          id: createId('card'),
          name: item.name,
          goal: item.goal,
          credit: item.credit,
          accountId: accountIdByName(state, item.accountName) || ''
        });
      }
      result.cards++;
    });

    var goal = payload.eg != null ? payload.eg : (payload.emergencyGoal != null ? payload.emergencyGoal : (payload.goal != null ? payload.goal : null));
    if (goal != null && cleanGoal(goal) > 0) {
      state.settings.emergencyGoal = cleanGoal(goal);
      result.emergencyGoal = cleanGoal(goal);
    }

    var emergencyNames = payload.em || payload.emergencyNames;
    if (Array.isArray(emergencyNames)) {
      emergencyNames.forEach(function (name) {
        var acc = null;
        for (var i = 0; i < state.accounts.length; i++) {
          if (state.accounts[i].name === cleanName(name, '', 24)) { acc = state.accounts[i]; break; }
        }
        if (acc) acc.emergency = true;
      });
    }

    return result;
  }

  /* ---------- #add= / #batch= payload ---------- */

  function resolveMethod(state, raw) {
    var m = cleanName(raw, '', 30);
    if (!m) return { methodType: 'cash', cardId: '', accountId: '' };
    var lower = m.toLowerCase();
    if (lower === 'cash' || m === '현금') return { methodType: 'cash', cardId: '', accountId: '' };
    var cardId = cardIdByName(state, m);
    if (cardId) return { methodType: 'card', cardId: cardId, accountId: '' };
    var accountId = accountIdByName(state, m);
    if (accountId) return { methodType: 'account', cardId: '', accountId: accountId };
    return { methodType: 'cash', cardId: '', accountId: '' };
  }

  function fingerprint(fields) {
    return [fields.type, fields.date, fields.amount, fields.methodType, fields.cardId || fields.accountId || '',
      fields.fromAccountId || '', fields.toAccountId || '', fields.memo || '', fields.categoryId || ''].join('|');
  }

  /* One compact record: {t,d,a,cat,m,memo,from,to,x} or a full entry object. */
  function entryFromSpec(state, spec, todayKey) {
    if (!spec || typeof spec !== 'object') return null;
    var type = entryType({ type: spec.t || spec.type });
    var date = spec.d || spec.date;
    if (!isDateKey(date)) date = isDateKey(todayKey) ? todayKey : dateKey(new Date());
    var rawAmount = spec.a != null ? spec.a : spec.amount;
    var amount = typeof rawAmount === 'string' ? parseAmount(rawAmount) : Math.round(+rawAmount);
    if (!isFinite(amount) || amount <= 0 || amount > 999999999) return null;
    var memo = typeof spec.memo === 'string' ? spec.memo.slice(0, 60) : '';
    var out = {
      type: type,
      date: date,
      amount: amount,
      categoryId: '',
      methodType: 'cash',
      cardId: '',
      accountId: '',
      fromAccountId: '',
      toAccountId: '',
      methodLabel: '',
      memo: memo,
      excludePerf: false,
      origin: ''
    };

    if (type === 'transfer') {
      out.fromAccountId = accountIdByName(state, spec.from) || accountIdByName(state, spec.fromAccount) || '';
      out.toAccountId = accountIdByName(state, spec.to) || accountIdByName(state, spec.toAccount) || '';
      if (!out.fromAccountId || !out.toAccountId || out.fromAccountId === out.toAccountId) return null;
      out.methodType = 'transfer';
    } else if (type === 'income') {
      var incCat = spec.cat || spec.category;
      var incId = categoryIdByName(state, incCat, 'income');
      if (!incId && typeof incCat === 'string' && findCategory(state, incCat, 'income')) incId = incCat;
      out.categoryId = incId || state.lastIncomeCategoryId || (state.incomeCategories[0] && state.incomeCategories[0].id) || ETC_INCOME_CATEGORY_ID;
      var incMethod = resolveMethod(state, spec.m || spec.method);
      out.methodType = incMethod.methodType === 'account' ? 'account' : 'cash';
      out.accountId = incMethod.accountId;
    } else {
      var cat = spec.cat || spec.category;
      var catId = categoryIdByName(state, cat, 'expense');
      if (!catId && typeof cat === 'string' && findCategory(state, cat, 'expense')) catId = cat;
      out.categoryId = catId || ETC_CATEGORY_ID;
      var method = resolveMethod(state, spec.m || spec.method);
      out.methodType = method.methodType;
      out.cardId = method.cardId;
      out.accountId = method.accountId;
      out.excludePerf = !!spec.x || !!spec.excludePerf;
      if (out.methodType !== 'card') out.excludePerf = false;
    }

    out.origin = typeof spec.id === 'string' && spec.id ? ('id:' + spec.id.slice(0, 60)) : fingerprint(out);
    return out;
  }

  function applyEntryBatch(state, payload, todayKey) {
    var result = { added: 0, skipped: 0, invalid: 0 };
    var list = null;
    if (Array.isArray(payload)) list = payload;
    else if (payload && typeof payload === 'object') {
      list = Array.isArray(payload.e) ? payload.e : (Array.isArray(payload.entries) ? payload.entries : (Array.isArray(payload.a) && payload.a[0] && typeof payload.a[0] === 'object' ? payload.a : null));
      if (!list && (payload.t || payload.type || payload.amount || payload.a)) list = [payload];
    }
    if (!list) return result;

    var seen = {};
    state.entries.forEach(function (e) { if (e.origin) seen[e.origin] = true; });

    list.forEach(function (spec) {
      var fields = entryFromSpec(state, spec, todayKey);
      if (!fields) { result.invalid++; return; }
      if (seen[fields.origin]) { result.skipped++; return; }
      seen[fields.origin] = true;
      state.entries.push({
        id: createId('e'),
        type: fields.type,
        date: fields.date,
        amount: fields.amount,
        categoryId: fields.categoryId,
        methodType: fields.methodType,
        cardId: fields.cardId,
        accountId: fields.accountId,
        fromAccountId: fields.fromAccountId,
        toAccountId: fields.toAccountId,
        methodLabel: fields.methodLabel,
        memo: fields.memo,
        excludePerf: fields.excludePerf,
        origin: fields.origin,
        createdAt: new Date().toISOString(),
        updatedAt: ''
      });
      result.added++;
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
    TRANSFER_CATEGORY_ID: TRANSFER_CATEGORY_ID,
    ACCOUNT_KINDS: ACCOUNT_KINDS,
    KIND_LABELS: KIND_LABELS,
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
    isTransfer: isTransfer,
    entriesOfType: entriesOfType,
    entriesInMonth: entriesInMonth,
    entriesOnDay: entriesOnDay,
    sortEntries: sortEntries,
    dayTotals: dayTotals,
    daysWithIncome: daysWithIncome,
    daysWithTransfer: daysWithTransfer,
    isCardEntry: isCardEntry,
    findCard: findCard,
    findAccount: findAccount,
    findCategory: findCategory,
    isCashAccount: isCashAccount,
    isSavingsAccount: isSavingsAccount,
    cardDebitAccountId: cardDebitAccountId,
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
    accountKind: accountKind,
    entryAccountDelta: entryAccountDelta,
    accountBalance: accountBalance,
    openingForTarget: openingForTarget,
    cashAccounts: cashAccounts,
    savingsAccounts: savingsAccounts,
    transferredIn: transferredIn,
    emergencyGoal: emergencyGoal,
    assetSnapshot: assetSnapshot,
    parseNotification: parseNotification,
    guessCategoryId: guessCategoryId,
    createId: createId,
    defaultState: defaultState,
    normalizeState: normalizeState,
    validateBackup: validateBackup,
    exportPayload: exportPayload,
    applySetup: applySetup,
    entryFromSpec: entryFromSpec,
    applyEntryBatch: applyEntryBatch,
    accountIdFor: accountIdFor,
    categoryIdByName: categoryIdByName,
    accountIdByName: accountIdByName,
    cardIdByName: cardIdByName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpendCore = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
