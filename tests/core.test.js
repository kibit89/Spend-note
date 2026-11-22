/* Spend Note — core tests. Runs in the browser (tests/test.html) and in quickjs (tools/run-tests.py). */
(function (root) {
  'use strict';

  function run() {
    var C = (typeof window !== 'undefined' ? window : globalThis).SpendCore;
    var count = 0;
    var failures = [];

    function eq(actual, expected, label) {
      count++;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(label + ' → expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
      }
    }
    function ok(cond, label) {
      count++;
      if (!cond) failures.push(label + ' → expected truthy');
    }

    /* ---------- formatting ---------- */
    eq(C.formatNumber(0), '0', 'formatNumber 0');
    eq(C.formatNumber(1234), '1,234', 'formatNumber 1234');
    eq(C.formatNumber(1234567), '1,234,567', 'formatNumber 1234567');
    eq(C.formatNumber(-5000), '-5,000', 'formatNumber negative');
    eq(C.formatNumber(999), '999', 'formatNumber 999');
    eq(C.won(12000), '12,000원', 'won');
    eq(C.compactWon(4500), '4,500', 'compactWon under 10k');
    eq(C.compactWon(12000), '1.2만', 'compactWon 12k');
    eq(C.compactWon(10000), '1만', 'compactWon 10k');
    eq(C.compactWon(1234000), '123만', 'compactWon 1.23m');
    eq(C.compactWon(0), '', 'compactWon 0');
    eq(C.percentText(0), '0%', 'percentText 0');
    eq(C.percentText(0.6167), '62%', 'percentText rounds');
    eq(C.percentText(1.2), '120%', 'percentText over 100');
    eq(C.parseAmount('12,000'), 12000, 'parseAmount commas');
    eq(C.parseAmount('007'), 7, 'parseAmount leading zeros');
    eq(C.parseAmount(''), 0, 'parseAmount empty');
    eq(C.parseAmount('1.2만'), 12, 'parseAmount strips non digits');
    eq(C.sanitizeAmountInput('012,300'), '12,300', 'sanitizeAmountInput');
    eq(C.sanitizeAmountInput('0'), '', 'sanitizeAmountInput zero');

    /* ---------- dates ---------- */
    eq(C.dateKey(new Date(2026, 10, 23)), '2026-11-23', 'dateKey');
    eq(C.parseDateKey('2026-02-30'), null, 'parseDateKey invalid day');
    eq(C.isDateKey('2026-02-29'), false, 'isDateKey non-leap');
    eq(C.isDateKey('2024-02-29'), true, 'isDateKey leap');
    eq(C.isDateKey('2026-1-1'), false, 'isDateKey loose shape');
    eq(C.monthKeyOf('2026-11-23'), '2026-11', 'monthKeyOf');
    eq(C.addMonths('2026-01', -1), '2025-12', 'addMonths back over year');
    eq(C.addMonths('2026-12', 1), '2027-01', 'addMonths forward over year');
    eq(C.daysInMonth('2026-02'), 28, 'daysInMonth feb 2026');
    eq(C.daysInMonth('2024-02'), 29, 'daysInMonth feb 2024');
    eq(C.monthLabel('2026-11'), '2026년 11월', 'monthLabel');
    eq(C.isMonthKey('2026-13'), false, 'isMonthKey 13');
    eq(C.isMonthKey('2026-11'), true, 'isMonthKey ok');

    var grid = C.monthGrid('2026-11', '2026-11-23');
    eq(grid.length % 7, 0, 'monthGrid whole weeks');
    eq(C.parseDateKey(grid[0].key).getDay(), 0, 'monthGrid starts Sunday');
    eq(grid.filter(function (c) { return c.isToday; }).length, 1, 'monthGrid marks today');
    eq(grid.filter(function (c) { return c.inMonth; }).length, 30, 'monthGrid november days');
    eq(grid[0].key, '2026-11-01', 'monthGrid first cell');

    /* ---------- fixture ---------- */
    function fixture() {
      var s = C.defaultState(new Date(2026, 10, 1));
      s.cards = [
        { id: 'c1', name: '현대카드', goal: 300000 },
        { id: 'c2', name: '신한카드', goal: 0 }
      ];
      s.categories = [
        { id: 'food', name: '식비', emoji: '🍚' },
        { id: 'cafe', name: '카페·간식', emoji: '☕' },
        { id: 'fixed', name: '고정비', emoji: '📅' },
        { id: 'etc', name: '기타', emoji: '📌' }
      ];
      s.incomeCategories = [
        { id: 'inc_online', name: '온라인 수입', emoji: '💻' },
        { id: 'inc_etc', name: '기타 수입', emoji: '📌' }
      ];
      s.fixedCosts = [
        { id: 'f1', name: '관리비', amount: 200000 },
        { id: 'f2', name: '가스비', amount: 100000 }
      ];
      s.entries = [
        { id: 'e1', type: 'expense', date: '2026-11-23', amount: 12000, categoryId: 'food', methodType: 'card', cardId: 'c1', methodLabel: '현대카드', memo: '점심', excludePerf: false, createdAt: '2026-11-23T10:00:00Z' },
        { id: 'e2', type: 'expense', date: '2026-11-23', amount: 5000, categoryId: 'cafe', methodType: 'cash', cardId: '', memo: '', excludePerf: false, createdAt: '2026-11-23T09:00:00Z' },
        { id: 'e3', type: 'expense', date: '2026-11-22', amount: 30000, categoryId: 'food', methodType: 'card', cardId: 'c1', memo: '상품권', excludePerf: true, createdAt: '2026-11-22T10:00:00Z' },
        { id: 'e4', type: 'expense', date: '2026-11-20', amount: 20000, categoryId: 'fixed', methodType: 'transfer', cardId: '', memo: '보험', excludePerf: false, createdAt: '2026-11-20T10:00:00Z' },
        { id: 'e5', type: 'income', date: '2026-11-10', amount: 500000, categoryId: 'inc_online', methodType: 'transfer', cardId: '', memo: '주간', excludePerf: false, createdAt: '2026-11-10T10:00:00Z' },
        { id: 'e6', type: 'expense', date: '2026-10-30', amount: 9999, categoryId: 'food', methodType: 'cash', cardId: '', memo: '지난달', excludePerf: false, createdAt: '2026-10-30T10:00:00Z' }
      ];
      return s;
    }

    var s = fixture();

    /* ---------- aggregation ---------- */
    eq(C.entriesInMonth(s.entries, '2026-11').length, 5, 'entriesInMonth');
    eq(C.sumAmounts(C.entriesOfType(C.entriesInMonth(s.entries, '2026-11'), 'expense')), 67000, 'month expense total');
    eq(C.sumAmounts(C.entriesOfType(s.entries, 'income')), 500000, 'income total');
    eq(C.dayTotals(s.entries, 'expense')['2026-11-23'], 17000, 'dayTotals expenses only');
    eq(C.dayTotals(s.entries, 'expense')['2026-11-10'], undefined, 'dayTotals skips income');
    eq(C.daysWithIncome(s.entries)['2026-11-10'], 500000, 'daysWithIncome');
    eq(C.entriesOnDay(s.entries, '2026-11-23')[0].id, 'e1', 'entriesOnDay newest first');

    var stats = C.cardStats(s.entries, s.cards, '2026-11');
    eq(stats.length, 2, 'cardStats count');
    eq(stats[0].spent, 12000, 'card spent excludes perf-excluded');
    eq(stats[0].excluded, 30000, 'card excluded amount');
    eq(stats[0].paid, 42000, 'card paid total');
    eq(stats[0].pct, 0.04, 'card pct');
    eq(Math.round(stats[0].pct * 100), 4, 'card pct text');
    eq(stats[0].remaining, 288000, 'card remaining');
    eq(stats[0].done, false, 'card not done');
    eq(stats[1].goal, 0, 'card without goal');
    eq(stats[1].pct, 0, 'card without goal pct');
    eq(stats[1].done, false, 'card without goal not done');

    var cats = C.categoryTotals(C.entriesOfType(C.entriesInMonth(s.entries, '2026-11'), 'expense'), s.categories);
    eq(cats[0].id, 'food', 'categoryTotals sorted');
    eq(cats[0].total, 42000, 'categoryTotals food total');
    eq(Math.round(cats[0].ratio * 100), 63, 'categoryTotals ratio');
    eq(cats.length, 3, 'categoryTotals only used categories');

    var fv = C.fixedVariable(C.entriesOfType(C.entriesInMonth(s.entries, '2026-11'), 'expense'));
    eq(fv.fixed, 20000, 'fixedVariable fixed');
    eq(fv.variable, 47000, 'fixedVariable variable');
    eq(fv.total, 67000, 'fixedVariable total');

    eq(C.fixedCostTotal(s), 300000, 'fixedCostTotal');
    eq(C.cardGoalTotal(s), 300000, 'cardGoalTotal');

    /* ---------- cash flow ---------- */
    var flow = C.cashFlow(s, '2026-11', '2026-11-23');
    eq(flow.income, 500000, 'flow income');
    eq(flow.expense, 67000, 'flow expense');
    eq(flow.fixed, 300000, 'flow fixed');
    eq(flow.cardGoals, 300000, 'flow card goals');
    eq(flow.expenseWithFixed, 367000, 'flow expense with fixed');
    eq(flow.monthlyNeed, 600000, 'flow monthly need');
    eq(flow.weeklyNeed, 138568, 'flow weekly need');
    eq(flow.weeklyIncome, 115473, 'flow weekly income');
    eq(flow.leftover, 133000, 'flow leftover');
    eq(flow.gap, -100000, 'flow gap');
    eq(flow.status, 'short', 'flow status short');

    var tight = fixture();
    tight.entries[4].amount = 540000;
    eq(C.cashFlow(tight, '2026-11', '2026-11-23').status, 'tight', 'flow status tight');

    var good = fixture();
    good.entries[4].amount = 700000;
    eq(C.cashFlow(good, '2026-11', '2026-11-23').status, 'good', 'flow status good');

    var unknown = fixture();
    unknown.entries = unknown.entries.filter(function (e) { return e.type !== 'income'; });
    eq(C.cashFlow(unknown, '2026-11', '2026-11-23').status, 'unknown', 'flow status unknown');

    var none = fixture();
    none.fixedCosts = [];
    none.cards = [{ id: 'c1', name: '현대카드', goal: 0 }];
    eq(C.cashFlow(none, '2026-11', '2026-11-23').status, 'none', 'flow status none');
    eq(C.cashFlow(none, '2026-11', '2026-11-23').weeklyNeed, 0, 'flow weekly need none');

    /* ---------- summary ---------- */
    var sum = C.monthSummary(s, '2026-11', '2026-11-23');
    eq(sum.total, 67000, 'summary total');
    eq(sum.count, 4, 'summary expense count');
    eq(sum.income, 500000, 'summary income');
    eq(sum.dailyAvg, 2913, 'summary daily average');
    eq(sum.elapsedDays, 23, 'summary elapsed days');
    eq(sum.prevTotal, 9999, 'summary previous month');
    ok(sum.change !== null && Math.abs(sum.change - (67000 - 9999) / 9999) < 1e-9, 'summary change ratio');
    eq(sum.methods.card, 42000, 'summary card method total');
    eq(sum.methods.cash, 5000, 'summary cash method total');
    eq(sum.methods.transfer, 20000, 'summary transfer method total');
    eq(sum.excluded, 30000, 'summary excluded');

    var pastMonth = C.monthSummary(s, '2026-10', '2026-11-23');
    eq(pastMonth.elapsedDays, 31, 'summary past month elapsed days');
    eq(pastMonth.dailyAvg, 323, 'summary past month daily avg');

    /* ---------- normalize ---------- */
    var messy = {
      cards: [{ id: 'x1', name: '  카드  하나 ', goal: '450000' }],
      categories: [{ id: 'food', name: '식비' }],
      fixedCosts: [{ name: '관리비', amount: 120000 }, { name: '' }],
      entries: [
        { date: '2026-11-23', amount: '5000', categoryId: 'nope', methodType: 'card', cardId: 'x1' },
        { date: '2026-13-01', amount: 1000 },
        { date: '2026-11-22', amount: 0 },
        { date: '2026-11-21', amount: 7000, categoryId: 'food', methodType: 'weird' },
        { date: '2026-11-20', amount: 8000, type: 'income', categoryId: 'nope' }
      ]
    };
    var norm = C.normalizeState(messy);
    eq(norm.dropped, 2, 'normalize dropped invalid entries');
    eq(norm.state.cards[0].name, '카드 하나', 'normalize card name trimmed');
    eq(norm.state.cards[0].goal, 450000, 'normalize goal number');
    eq(norm.state.entries[0].amount, 5000, 'normalize amount string');
    eq(norm.state.entries[0].categoryId, 'etc', 'normalize unknown category to etc');
    eq(norm.state.entries[1].methodType, 'cash', 'normalize unknown method to cash');
    eq(norm.state.entries[2].type, 'income', 'normalize income type');
    eq(norm.state.entries[2].categoryId, 'inc_etc', 'normalize unknown income category');
    eq(norm.state.entries[2].methodType, 'transfer', 'normalize income method');
    eq(norm.state.fixedCosts.length, 1, 'normalize drops unnamed fixed cost');
    ok(norm.state.categories.some(function (c) { return c.id === 'etc'; }), 'normalize adds etc category');
    ok(norm.state.incomeCategories.length >= 2, 'normalize fills income categories');

    var emptyCards = C.normalizeState({ cards: [], categories: [], entries: [] });
    eq(emptyCards.state.cards.length, 0, 'normalize keeps empty card list');
    eq(emptyCards.state.categories.length, 7, 'normalize default categories');
    eq(emptyCards.state.categories.filter(function (c) { return c.id === 'etc'; }).length, 1, 'normalize single etc category');
    eq(emptyCards.state.incomeCategories.length, 4, 'normalize default income categories');

    /* ---------- backup ---------- */
    eq(C.validateBackup(null).ok, false, 'validate null');
    eq(C.validateBackup([]).ok, false, 'validate array');
    eq(C.validateBackup({}).ok, false, 'validate empty object');
    eq(C.validateBackup({ entries: [] }).ok, true, 'validate entries only');
    eq(C.validateBackup({ entries: [{ date: '2026-01-01', amount: 100 }] }).ok, true, 'validate one entry');
    eq(C.validateBackup({ entries: [{ date: 'bad', amount: 100 }] }).ok, false, 'validate all invalid entries');
    eq(C.validateBackup({ cards: [] }).ok, true, 'validate cards only');

    var exported = C.exportPayload(s);
    eq(exported.app, 'spend-note', 'export app marker');
    ok(Array.isArray(exported.fixedCosts) && exported.fixedCosts.length === 2, 'export keeps fixed costs');
    ok(exported.entries.length === 6, 'export keeps entries');
    var roundTrip = C.validateBackup(JSON.parse(JSON.stringify(exported)));
    eq(roundTrip.ok, true, 'export → validate round trip');
    eq(roundTrip.state.entries.length, 6, 'round trip entry count');
    eq(roundTrip.state.fixedCosts.length, 2, 'round trip fixed costs');

    /* ---------- setup payload ---------- */
    var setupPayload = {
      categories: [
        { id: 'side', name: '반찬가게', emoji: '🥘' },
        { id: 'daiso', name: '다이소', emoji: '🧴' },
        { id: 'cafe', name: '카페·간식', emoji: '☕' },
        { id: 'overseas', name: '알리·테무·핀둬둬', emoji: '📦' },
        { id: 'life', name: '생활·마트', emoji: '🧺' },
        { id: 'fixed', name: '고정비', emoji: '📅' },
        { id: 'transit', name: '교통', emoji: '🚌' },
        { id: 'etc', name: '기타', emoji: '📌' }
      ],
      fixedCosts: [{ name: '관리비' }, { name: '가스비' }, { name: '보험료' }, { name: '용돈' }]
    };
    var fresh = C.defaultState();
    var setupResult = C.applySetup(fresh, setupPayload);
    eq(setupResult.replacedCategories, true, 'setup replaces fresh categories');
    eq(fresh.categories.length, 8, 'setup category count');
    eq(fresh.categories[0].name, '반찬가게', 'setup first category');
    eq(fresh.fixedCosts.length, 4, 'setup fixed cost count');
    eq(fresh.fixedCosts[0].amount, 0, 'setup fixed cost amount empty');
    eq(setupResult.fixedCosts, 4, 'setup reports fixed costs');
    C.applySetup(fresh, setupPayload);
    eq(fresh.fixedCosts.length, 4, 'setup is idempotent');
    eq(fresh.categories.length, 8, 'setup keeps category count on rerun');

    var used = fixture();
    C.applySetup(used, setupPayload);
    eq(used.categories.length, 9, 'setup merges when entries exist');
    eq(used.entries.length, 6, 'setup does not touch entries');

    return { count: count, failures: failures };
  }

  root.runSpendNoteTests = run;
})(typeof window !== 'undefined' ? window : globalThis);
