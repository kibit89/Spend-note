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

    /* ---------- fixture: the v2 shape (no accounts, no transfers) ---------- */
    function fixture() {
      var s = C.defaultState(new Date(2026, 10, 1));
      s.cards = [
        { id: 'c1', name: '한빛카드', goal: 300000, credit: true },
        { id: 'c2', name: '누리카드', goal: 0, credit: true }
      ];
      s.categories = [
        { id: 'food', name: '식비', emoji: '🍚' },
        { id: 'cafe', name: '카페', emoji: '☕' },
        { id: 'fixed', name: '고정비', emoji: '📅' },
        { id: 'etc', name: '기타', emoji: '📌' }
      ];
      s.incomeCategories = [
        { id: 'inc_online', name: '온라인 수입', emoji: '💻' },
        { id: 'inc_etc', name: '기타 수입', emoji: '📌' }
      ];
      s.fixedCosts = [
        { id: 'f1', name: '월세', amount: 200000 },
        { id: 'f2', name: '통신비', amount: 100000 }
      ];
      s.settings = { emergencyGoal: 0 };
      s.entries = [
        { id: 'e1', type: 'expense', date: '2026-11-23', amount: 12000, categoryId: 'food', methodType: 'card', cardId: 'c1', methodLabel: '한빛카드', memo: '점심', excludePerf: false, createdAt: '2026-11-23T10:00:00Z' },
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
    eq(stats[0].credit, true, 'card credit flag');
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
    none.cards = [{ id: 'c1', name: '한빛카드', goal: 0 }];
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
    eq(sum.methods.account, 0, 'summary account method total');
    eq(sum.excluded, 30000, 'summary excluded');

    var pastMonth = C.monthSummary(s, '2026-10', '2026-11-23');
    eq(pastMonth.elapsedDays, 31, 'summary past month elapsed days');
    eq(pastMonth.dailyAvg, 323, 'summary past month daily avg');

    /* ---------- accounts, transfers, assets ---------- */
    function money() {
      var st = C.defaultState(new Date(2026, 10, 1));
      st.categories = [
        { id: 'food', name: '식비', emoji: '🍚' },
        { id: 'cafe', name: '카페', emoji: '☕' },
        { id: 'fixed', name: '고정비', emoji: '📅' },
        { id: 'etc', name: '기타', emoji: '📌' }
      ];
      st.cards = [
        { id: 'c1', name: '한빛카드', goal: 300000, credit: true },
        { id: 'c2', name: '누리카드', goal: 0, credit: false, accountId: 'a1' }
      ];
      st.accounts = [
        { id: 'a1', name: '빛은행', kind: 'checking', opening: 1200000, anchorDate: '', monthly: 0, emergency: false },
        { id: 'a2', name: '별페이', kind: 'pay', opening: 100000, anchorDate: '', monthly: 0, emergency: false },
        { id: 'a3', name: '새싹적금', kind: 'savings', opening: 3000000, anchorDate: '', monthly: 200000, emergency: true },
        { id: 'a4', name: '바다적금', kind: 'savings', opening: 1000000, anchorDate: '', monthly: 0, emergency: true }
      ];
      st.fixedCosts = [
        { id: 'f1', name: '월세', amount: 200000 },
        { id: 'f2', name: '통신비', amount: 50000 }
      ];
      st.settings = { emergencyGoal: 10000000 };
      st.entries = [
        { id: 'm1', type: 'expense', date: '2026-11-05', amount: 12000, categoryId: 'food', methodType: 'card', cardId: 'c1', memo: '점심' },
        { id: 'm2', type: 'expense', date: '2026-11-06', amount: 30000, categoryId: 'cafe', methodType: 'card', cardId: 'c2', memo: '체크카드' },
        { id: 'm3', type: 'expense', date: '2026-11-07', amount: 40000, categoryId: 'food', methodType: 'account', accountId: 'a1', memo: '장보기' },
        { id: 'm4', type: 'income', date: '2026-11-10', amount: 800000, categoryId: 'inc_online', methodType: 'account', accountId: 'a2', memo: '주간 수입' },
        { id: 'm5', type: 'expense', date: '2026-11-15', amount: 20000, categoryId: 'cafe', methodType: 'account', accountId: 'a2', memo: '커피' },
        { id: 'm6', type: 'transfer', date: '2026-11-16', amount: 200000, fromAccountId: 'a1', toAccountId: 'a3', memo: '적금' },
        { id: 'm7', type: 'transfer', date: '2026-11-17', amount: 150000, fromAccountId: 'a2', toAccountId: 'a3', memo: '적금' },
        { id: 'm8', type: 'expense', date: '2026-11-20', amount: 250000, categoryId: 'fixed', methodType: 'account', accountId: 'a1', memo: '월세' },
        { id: 'm9', type: 'expense', date: '2026-10-25', amount: 5000, categoryId: 'food', methodType: 'cash', memo: '지난달' },
        { id: 'm10', type: 'transfer', date: '2026-10-20', amount: 100000, fromAccountId: 'a1', toAccountId: 'a3', memo: '지난달 적금' }
      ];
      return st;
    }
    var m = money();

    eq(C.accountBalance(m, 'a1'), 580000, 'checking balance: card check, account spend, transfers out');
    eq(C.accountBalance(m, 'a2'), 730000, 'pay balance: income in, spend out, transfer out');
    eq(C.accountBalance(m, 'a3'), 3450000, 'savings balance: transfers in');
    eq(C.accountBalance(m, 'a4'), 1000000, 'savings balance: opening only');
    eq(C.accountBalance(m, 'nope'), 0, 'unknown account balance');

    var anchored = C.normalizeState({
      accounts: [{ id: 'x1', name: '샘물은행', kind: 'checking', opening: 100000, anchorDate: '2026-11-01' }],
      entries: [{ date: '2026-10-05', amount: 7000, methodType: 'account', accountId: 'x1', categoryId: 'etc' },
                { date: '2026-11-05', amount: 3000, methodType: 'account', accountId: 'x1', categoryId: 'etc' }]
    }).state;
    eq(C.accountBalance(anchored, 'x1'), 97000, 'anchor date ignores older records');
    eq(C.openingForTarget(anchored, 'x1', 200000, '2026-11-01'), 203000, 'openingForTarget');

    var msum = C.monthSummary(m, '2026-11', '2026-11-23');
    eq(msum.total, 352000, 'transfer stays out of expense total');
    eq(msum.income, 800000, 'transfer stays out of income total');
    eq(msum.transferCount, 2, 'summary transfer count');
    eq(msum.transferTotal, 350000, 'summary transfer total');
    eq(msum.methods.account, 310000, 'summary account method excludes transfers');
    eq(msum.methods.card, 42000, 'summary card method counts both cards');
    eq(C.dayTotals(m.entries, 'expense')['2026-11-16'], undefined, 'calendar cells skip transfers');
    eq(C.daysWithTransfer(m.entries)['2026-11-16'], 200000, 'daysWithTransfer');
    eq(C.categoryTotals(C.entriesOfType(C.entriesInMonth(m.entries, '2026-11'), 'expense'), m.categories).reduce(function (a, c) { return a + c.total; }, 0), 352000, 'category totals exclude transfers');

    var snap = C.assetSnapshot(m, '2026-11');
    eq(snap.total, 5760000, 'total assets');
    eq(snap.cash, 1310000, 'cash accounts total');
    eq(snap.savings, 4450000, 'savings total');
    eq(snap.cashAccounts.length, 2, 'cash account list');
    eq(snap.savingsAccounts.length, 2, 'savings account list');
    eq(snap.emergencyCurrent, 4450000, 'emergency current from flagged accounts');
    eq(snap.emergencyGoal, 10000000, 'emergency goal');
    eq(snap.emergencyRemaining, 5550000, 'emergency remaining');
    eq(Math.round(snap.emergencyPct * 100), 45, 'emergency percent');
    eq(snap.emergencyDone, false, 'emergency not done');
    eq(snap.fixedLeft, 0, 'remaining fixed after this month fixed spending');
    eq(snap.cardDue, 12000, 'card due counts credit card only');
    eq(snap.savingsLeft, 0, 'savings commitment already transferred');
    eq(snap.spendable, 1298000, 'spendable = cash - fixed - card - savings');

    var emptySnap = C.assetSnapshot(C.defaultState(), '2026-11');
    eq(emptySnap.hasAccounts, false, 'asset snapshot without accounts');
    eq(emptySnap.spendable, null, 'spendable unknown without accounts');
    eq(emptySnap.emergencyGoal, 0, 'no emergency goal by default');

    var noFixedPay = money();
    noFixedPay.entries = noFixedPay.entries.filter(function (e) { return e.id !== 'm8'; });
    var snap2 = C.assetSnapshot(noFixedPay, '2026-11');
    eq(snap2.fixedLeft, 250000, 'fixed left = full monthly fixed cost');
    eq(snap2.spendable, C.accountBalance(noFixedPay, 'a1') + C.accountBalance(noFixedPay, 'a2') - 250000 - 12000, 'spendable subtracts fixed and card due');

    var savingsOpen = money();
    savingsOpen.entries = savingsOpen.entries.filter(function (e) { return e.type !== 'transfer'; });
    eq(C.assetSnapshot(savingsOpen, '2026-11').savingsLeft, 200000, 'savings commitment left when nothing transferred');

    eq(C.methodName(m, m[0] || m.entries[0]), '한빛카드', 'methodName card');
    eq(C.methodName(m, m.entries[2]), '빛은행', 'methodName account');
    eq(C.methodName(m, m.entries[5]), '빛은행 → 새싹적금', 'methodName transfer');
    eq(C.categoryName(m, m.entries[5]), '이체', 'transfer category label');
    eq(C.categoryEmoji(m, m.entries[5]), '🔁', 'transfer emoji');

    /* ---------- notification parser ---------- */
    var pstate = C.normalizeState({
      categories: [{ id: 'food', name: '식비' }, { id: 'cafe', name: '카페' }, { id: 'life', name: '생활' }, { id: 'etc', name: '기타' }],
      cards: [{ id: 'c1', name: '한빛카드', goal: 300000, credit: true }],
      accounts: [
        { id: 'a1', name: '빛은행', kind: 'checking', opening: 0 },
        { id: 'a2', name: '별페이', kind: 'pay', opening: 0 },
        { id: 'a3', name: '새싹적금', kind: 'savings', opening: 0 }
      ],
      entries: []
    }).state;

    var p1 = C.parseNotification('한빛카드 승인 12,000원 11/23 12:34 스타벅스 강남점', pstate);
    eq(p1.ok, true, 'parser ok card approval');
    eq(p1.type, 'expense', 'parser card approval type');
    eq(p1.amount, 12000, 'parser card approval amount');
    eq(p1.methodType, 'card', 'parser card method');
    eq(p1.cardId, 'c1', 'parser card id');
    eq(p1.categoryId, 'cafe', 'parser cafe category');
    eq(p1.memo, '스타벅스 강남점', 'parser merchant memo');

    var p2 = C.parseNotification('빛은행 출금 50,000원 잔액 1,234,567원', pstate);
    eq(p2.type, 'expense', 'parser bank withdrawal type');
    eq(p2.amount, 50000, 'parser skips balance amount');
    eq(p2.methodType, 'account', 'parser bank account method');
    eq(p2.accountId, 'a1', 'parser bank account id');
    eq(p2.memo, '', 'parser bank memo empty');

    var p3 = C.parseNotification('빛은행에서 새싹적금으로 200,000원 이체', pstate);
    eq(p3.type, 'transfer', 'parser transfer type');
    eq(p3.amount, 200000, 'parser transfer amount');
    eq(p3.fromAccountId, 'a1', 'parser transfer from');
    eq(p3.toAccountId, 'a3', 'parser transfer to');

    var p4 = C.parseNotification('빛은행 출금 30,000원 별페이 입금 30,000원', pstate);
    eq(p4.type, 'transfer', 'parser two-account transfer type');
    eq(p4.fromAccountId, 'a1', 'parser two-account transfer from');
    eq(p4.toAccountId, 'a2', 'parser two-account transfer to');
    eq(p4.amount, 30000, 'parser two-account transfer amount');

    var p5 = C.parseNotification('새싹적금 입금 100,000원 잔액 3,000,000원', pstate);
    eq(p5.type, 'income', 'parser deposit type');
    eq(p5.amount, 100000, 'parser deposit amount');
    eq(p5.methodType, 'account', 'parser deposit account method');
    eq(p5.accountId, 'a3', 'parser deposit account id');

    var p6 = C.parseNotification('별페이 3,500원 결제', pstate);
    eq(p6.type, 'expense', 'parser pay type');
    eq(p6.amount, 3500, 'parser pay amount');
    eq(p6.accountId, 'a2', 'parser pay account');

    var p7 = C.parseNotification('한빛카드 승인취소 12,000원', pstate);
    eq(p7.canceled, true, 'parser marks cancellation');
    eq(p7.amount, 12000, 'parser cancellation amount');

    var p8 = C.parseNotification('카드승인 5,000원', pstate);
    eq(p8.methodType, 'card', 'parser falls back to the only card');
    eq(p8.cardId, 'c1', 'parser fallback card id');

    var p9 = C.parseNotification('[Web발신] 한빛카드 승인 12,000원 11월 23일 12:34 스타벅스', pstate);
    eq(p9.memo, '스타벅스', 'parser strips sender tag, date, keyword noise');

    var p10 = C.parseNotification('한빛카드 승인 1,200,000원 누적실적 1,234,000원', pstate);
    eq(p10.amount, 1200000, 'parser ignores cumulative performance amount');
    eq(p10.memo, '', 'parser leaves no keyword in memo');

    var pstate2 = C.normalizeState({
      accounts: [{ id: 'p1', name: '별페이', kind: 'pay' }, { id: 'p2', name: '별페이플러스', kind: 'pay' }],
      cards: [], entries: []
    }).state;
    eq(C.parseNotification('별페이플러스 5,000원 결제', pstate2).accountId, 'p2', 'parser prefers the longer account name');
    eq(C.parseNotification('별페이 5,000원 결제', pstate2).accountId, 'p1', 'parser matches the shorter account alone');

    var aliasState = C.normalizeState({
      categories: [{ id: 'life', name: '생활·장보기' }, { id: 'etc', name: '기타' }],
      entries: []
    }).state;
    eq(C.guessCategoryId(aliasState, '이마트 12,000원 결제'), 'life', 'parser category alias matches a longer category name');
    eq(C.guessCategoryId(aliasState, '아무데나 3,000원'), null, 'parser leaves unknown merchants uncategorized');

    eq(C.parseNotification('', pstate).ok, false, 'parser empty text');
    eq(C.parseNotification('안녕하세요', pstate).ok, false, 'parser text without amount');
    eq(C.parseNotification('잔액 1,234,567원', pstate).ok, false, 'parser balance-only text');

    /* ---------- normalize ---------- */
    var messy = {
      cards: [{ id: 'x1', name: '  카드  하나 ', goal: '450000' }],
      categories: [{ id: 'food', name: '식비' }],
      fixedCosts: [{ name: '월세', amount: 120000 }, { name: '' }],
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
    eq(norm.state.cards[0].credit, true, 'normalize card defaults to credit');
    eq(norm.state.entries[0].amount, 5000, 'normalize amount string');
    eq(norm.state.entries[0].categoryId, 'etc', 'normalize unknown category to etc');
    eq(norm.state.entries[1].methodType, 'cash', 'normalize unknown method to cash');
    eq(norm.state.entries[2].type, 'income', 'normalize income type');
    eq(norm.state.entries[2].categoryId, 'inc_etc', 'normalize unknown income category');
    eq(norm.state.entries[2].methodType, 'transfer', 'normalize income method');
    eq(norm.state.fixedCosts.length, 1, 'normalize drops unnamed fixed cost');
    eq(norm.state.accounts.length, 0, 'normalize keeps missing accounts empty');
    ok(norm.state.categories.some(function (c) { return c.id === 'etc'; }), 'normalize adds etc category');
    ok(norm.state.incomeCategories.length >= 2, 'normalize fills income categories');

    var emptyCards = C.normalizeState({ cards: [], categories: [], entries: [] });
    eq(emptyCards.state.cards.length, 0, 'normalize keeps empty card list');
    eq(emptyCards.state.categories.length, 7, 'normalize default categories');
    eq(emptyCards.state.categories.filter(function (c) { return c.id === 'etc'; }).length, 1, 'normalize single etc category');
    eq(emptyCards.state.incomeCategories.length, 4, 'normalize default income categories');

    var rawTransfer = C.normalizeState({
      accounts: [{ id: 'a1', name: '빛은행', kind: 'checking' }],
      entries: [
        { date: '2026-11-20', amount: 10000, type: 'transfer', fromAccountId: 'a1', toAccountId: 'missing' },
        { date: '2026-11-20', amount: 10000, type: 'transfer', fromAccountId: 'a1', toAccountId: 'a1' }
      ]
    });
    eq(rawTransfer.state.entries.length, 0, 'normalize drops transfers to unknown/same account');
    eq(rawTransfer.state.accounts[0].kind, 'checking', 'normalize account kind');

    var v2 = C.normalizeState({ cards: [{ id: 'c1', name: '한빛카드', goal: 300000 }], entries: s.entries });
    eq(v2.state.version, 3, 'normalize bumps version');
    eq(v2.state.entries.length, 6, 'normalize keeps v2 entries');
    eq(v2.state.accounts.length, 0, 'normalize v2 has no accounts');
    eq(v2.state.cards[0].credit, true, 'normalize v2 card becomes credit');

    /* ---------- backup ---------- */
    eq(C.validateBackup(null).ok, false, 'validate null');
    eq(C.validateBackup([]).ok, false, 'validate array');
    eq(C.validateBackup({}).ok, false, 'validate empty object');
    eq(C.validateBackup({ entries: [] }).ok, true, 'validate entries only');
    eq(C.validateBackup({ accounts: [] }).ok, true, 'validate accounts only');
    eq(C.validateBackup({ entries: [{ date: '2026-01-01', amount: 100 }] }).ok, true, 'validate one entry');
    eq(C.validateBackup({ entries: [{ date: 'bad', amount: 100 }] }).ok, false, 'validate all invalid entries');
    eq(C.validateBackup({ cards: [] }).ok, true, 'validate cards only');

    var exported = C.exportPayload(m);
    eq(exported.app, 'spend-note', 'export app marker');
    eq(exported.version, 3, 'export version');
    ok(Array.isArray(exported.fixedCosts) && exported.fixedCosts.length === 2, 'export keeps fixed costs');
    ok(exported.entries.length === 10, 'export keeps entries');
    ok(Array.isArray(exported.accounts) && exported.accounts.length === 4, 'export keeps accounts');
    var roundTrip = C.validateBackup(JSON.parse(JSON.stringify(exported)));
    eq(roundTrip.ok, true, 'export → validate round trip');
    eq(roundTrip.state.entries.length, 10, 'round trip entry count');
    eq(roundTrip.state.fixedCosts.length, 2, 'round trip fixed costs');
    eq(roundTrip.state.accounts.length, 4, 'round trip accounts');
    eq(C.accountBalance(roundTrip.state, 'a3'), 3450000, 'round trip keeps transfer-rebuilt balance');

    /* ---------- setup payload ---------- */
    var setupPayload = {
      categories: [
        { id: 'side', name: '반찬', emoji: '🥘' },
        { id: 'daiso', name: '다이소', emoji: '🧴' },
        { id: 'cafe', name: '카페', emoji: '☕' },
        { id: 'overseas', name: '해외직구', emoji: '📦' },
        { id: 'life', name: '생활', emoji: '🧺' },
        { id: 'fixed', name: '고정비', emoji: '📅' },
        { id: 'transit', name: '교통', emoji: '🚌' },
        { id: 'etc', name: '기타', emoji: '📌' }
      ],
      fixedCosts: [{ name: '월세' }, { name: '통신비' }, { name: '보험료' }, { name: '용돈' }]
    };
    var fresh = C.defaultState();
    var setupResult = C.applySetup(fresh, setupPayload);
    eq(setupResult.replacedCategories, true, 'setup replaces fresh categories');
    eq(fresh.categories.length, 8, 'setup category count');
    eq(fresh.categories[0].name, '반찬', 'setup first category');
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

    // compact form, as used by a shareable #setup= link
    var compact = {
      c: [['반찬', '🥘'], ['다이소', '🧴'], ['고정비', '📅'], ['기타', '📌']],
      f: ['월세', '통신비'],
      cards: [['누리카드', 500000]]
    };
    var cs = C.defaultState();
    var cr = C.applySetup(cs, compact);
    eq(cs.categories.map(function (c) { return c.name; }), ['반찬', '다이소', '고정비', '기타'], 'compact setup replaces categories');
    eq(cs.categories[2].id, 'fixed', 'compact setup maps 고정비 id');
    eq(cs.categories[3].id, 'etc', 'compact setup maps 기타 id');
    eq(cr.fixedCosts, 2, 'compact setup fixed count');
    eq(cs.fixedCosts[0].amount, 0, 'compact setup fixed amount zero');
    eq(cs.cards.length, 1, 'compact setup adds a card on a fresh install');
    eq(cs.cards[0].goal, 500000, 'compact setup card goal');
    eq(cs.cards[0].credit, true, 'compact setup card defaults to credit');
    C.applySetup(cs, compact);
    eq(cs.categories.length, 4, 'compact setup idempotent');
    eq(cs.fixedCosts.length, 2, 'compact setup fixed idempotent');
    eq(cs.cards.length, 1, 'compact setup card idempotent');

    var full = {
      c: [['식비', '🍚'], ['카페', '☕'], ['생활', '🧺'], ['고정비', '📅'], ['기타', '📌']],
      ic: [['온라인 수입', '💻'], ['기타 수입', '📌']],
      f: [['월세', 200000], ['통신비', 50000]],
      cards: [['한빛카드', 300000, 'credit'], ['누리카드', 0, 'check', '빛은행']],
      a: [['빛은행', 500000], ['별페이', 100000, 'pay']],
      s: [['새싹적금', 2000000, 200000]],
      eg: 10000000
    };
    var fullState = C.defaultState();
    var fullResult = C.applySetup(fullState, full);
    eq(fullResult.accounts, 2, 'setup counts cash accounts');
    eq(fullResult.savings, 1, 'setup counts savings');
    eq(fullResult.cards, 2, 'setup counts cards');
    eq(fullState.accounts.length, 3, 'setup creates accounts');
    var bank = C.findAccount(fullState, C.accountIdByName(fullState, '빛은행'));
    eq(bank.kind, 'checking', 'setup account kind');
    eq(bank.opening, 500000, 'setup account opening balance');
    var pay = C.findAccount(fullState, C.accountIdByName(fullState, '별페이'));
    eq(pay.kind, 'pay', 'setup pay account kind');
    var savingsAcc = C.findAccount(fullState, C.accountIdByName(fullState, '새싹적금'));
    eq(savingsAcc.kind, 'savings', 'setup savings kind');
    eq(savingsAcc.monthly, 200000, 'setup savings monthly');
    eq(savingsAcc.emergency, true, 'setup savings counts toward emergency');
    eq(bank.emergency, false, 'setup cash account not emergency by default');
    var checkCard = fullState.cards.filter(function (c) { return c.name === '누리카드'; })[0];
    eq(checkCard.credit, false, 'setup check card is not credit');
    eq(checkCard.accountId, bank.id, 'setup check card linked account');
    eq(C.emergencyGoal(fullState), 10000000, 'setup emergency goal');
    eq(C.accountBalance(fullState, bank.id), 500000, 'setup balance shows on account');

    C.applySetup(fullState, full);
    eq(fullState.accounts.length, 3, 'full setup idempotent accounts');
    eq(fullState.cards.length, 2, 'full setup idempotent cards');
    eq(fullState.accounts.filter(function (a) { return a.kind === 'savings'; }).length, 1, 'full setup keeps one savings');

    var emState = C.defaultState();
    C.applySetup(emState, { a: [['빛은행', 0]], s: [['새싹적금', 0]], em: ['빛은행'] });
    eq(C.findAccount(emState, C.accountIdByName(emState, '빛은행')).emergency, true, 'setup marks extra emergency account');

    /* ---------- #add= / #batch= payload ---------- */
    var batchState = C.normalizeState({
      categories: [{ id: 'food', name: '식비' }, { id: 'etc', name: '기타' }],
      incomeCategories: [{ id: 'inc_online', name: '온라인 수입' }, { id: 'inc_etc', name: '기타 수입' }],
      cards: [{ id: 'c1', name: '한빛카드', goal: 300000, credit: true }],
      accounts: [{ id: 'a1', name: '빛은행', kind: 'checking' }, { id: 'a3', name: '새싹적금', kind: 'savings' }],
      entries: []
    }).state;

    var batch = {
      e: [
        { t: 'expense', d: '2026-11-22', a: 12000, cat: '식비', m: '한빛카드', memo: '점심' },
        { t: 'income', d: '2026-11-22', a: '50,000', cat: '온라인 수입', m: '빛은행' },
        { t: 'transfer', d: '2026-11-21', a: 100000, from: '빛은행', to: '새싹적금' },
        { t: 'expense', d: 'bad', a: 0 }
      ]
    };
    var b1 = C.applyEntryBatch(batchState, batch, '2026-11-23');
    eq(b1.added, 3, 'batch adds valid records');
    eq(b1.invalid, 1, 'batch counts invalid records');
    eq(batchState.entries.filter(function (e) { return e.type === 'expense'; })[0].methodType, 'card', 'batch card method');
    eq(batchState.entries.filter(function (e) { return e.type === 'income'; })[0].amount, 50000, 'batch parses amount with commas');
    eq(batchState.entries.filter(function (e) { return e.type === 'income'; })[0].methodType, 'account', 'batch income account method');
    eq(batchState.entries.filter(function (e) { return e.type === 'transfer'; })[0].fromAccountId, 'a1', 'batch transfer from');
    eq(C.accountBalance(batchState, 'a1'), -50000, 'batch income and transfer move the account');
    var b2 = C.applyEntryBatch(batchState, batch, '2026-11-23');
    eq(b2.added, 0, 'batch link is idempotent');
    eq(b2.skipped, 3, 'batch skips seen records');
    eq(batchState.entries.length, 3, 'batch keeps one copy of each record');

    var single = C.applyEntryBatch(batchState, { t: 'expense', a: 3000, cat: '기타', m: 'cash' }, '2026-11-23');
    eq(single.added, 1, 'single #add= record');
    eq(batchState.entries.filter(function (e) { return e.amount === 3000; })[0].date, '2026-11-23', 'single add defaults to today');
    eq(batchState.entries.filter(function (e) { return e.amount === 3000; })[0].categoryId, 'etc', 'single add falls back to 기타');

    return { count: count, failures: failures };
  }

  root.runSpendNoteTests = run;
})(typeof window !== 'undefined' ? window : globalThis);
