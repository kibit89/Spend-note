/* Spend Note — app shell, rendering, storage */
(function () {
  'use strict';

  var C = window.SpendCore;
  var STORE_KEY = 'spend-note:v2';
  var VERSION_LABEL = 'v4';

  /* ---------- helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nowIso() { return new Date().toISOString(); }
  function todayKey() { return C.dateKey(new Date()); }
  function currentMonth() { return C.monthKey(new Date()); }

  var toastTimer = null;
  function toast(message) {
    var el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + C.formatNumber(Math.abs(n)); }
  function dateLabel(key) {
    var d = C.parseDateKey(key);
    if (!d) return key;
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + C.weekdayLabels()[d.getDay()] + ')';
  }
  function kindLabel(kind) { return C.KIND_LABELS[kind] || '입출금'; }

  /* ---------- storage ---------- */

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    if (!raw) return C.defaultState();
    try {
      var parsed = JSON.parse(raw);
      var result = C.normalizeState(parsed);
      return result.state;
    } catch (e) {
      return C.defaultState();
    }
  }

  var storageBroken = false;
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      if (!storageBroken) {
        storageBroken = true;
        toast('저장 공간을 쓸 수 없어요. 브라우저 저장 공간을 확인해 주세요.');
      }
    }
  }

  /* ---------- app state ---------- */

  var state = loadState();

  var ui = {
    view: 'add',
    type: 'expense',
    amount: 0,
    catId: null,
    methodId: null,
    fromId: '',
    toId: '',
    exclude: false,
    memo: '',
    calMonth: currentMonth(),
    selectedDay: todayKey(),
    sumMonth: currentMonth(),
    sheet: null,
    item: null,
    parsed: null,
    installPrompt: null
  };

  function methodOptions(type) {
    var list = [];
    if (type !== 'income') {
      state.cards.forEach(function (c) {
        list.push({ id: 'card:' + c.id, label: c.name, tag: c.credit === false ? '체크' : '카드' });
      });
    }
    state.accounts.forEach(function (a) {
      if (type !== 'income' && a.kind === 'savings') return;
      list.push({ id: 'account:' + a.id, label: a.name, tag: kindLabel(a.kind) });
    });
    list.push({ id: 'cash', label: '현금', tag: '' });
    return list;
  }

  function defaultMethodId(type) {
    if (type === 'income') {
      var first = C.cashAccounts(state)[0] || state.accounts[0];
      return first ? 'account:' + first.id : 'cash';
    }
    var card = state.cards[0];
    if (card) return 'card:' + card.id;
    var cash = C.cashAccounts(state)[0] || state.accounts[0];
    return cash ? 'account:' + cash.id : 'cash';
  }

  function methodParts(type, methodId) {
    if (methodId && methodId.indexOf('card:') === 0) {
      return { methodType: 'card', cardId: methodId.slice(5), accountId: '' };
    }
    if (methodId && methodId.indexOf('account:') === 0) {
      return { methodType: 'account', cardId: '', accountId: methodId.slice(8) };
    }
    return { methodType: 'cash', cardId: '', accountId: '' };
  }

  function methodIdOf(entry) {
    if (!entry) return 'cash';
    if (entry.methodType === 'card') return 'card:' + entry.cardId;
    if (entry.methodType === 'account') return 'account:' + entry.accountId;
    return 'cash';
  }

  function ensureSelection() {
    if (ui.type === 'transfer') {
      var accs = state.accounts;
      if (!accs.some(function (a) { return a.id === ui.fromId; })) ui.fromId = accs[0] ? accs[0].id : '';
      if (!accs.some(function (a) { return a.id === ui.toId; }) || ui.toId === ui.fromId) {
        var alt = accs.filter(function (a) { return a.id !== ui.fromId; })[0];
        ui.toId = alt ? alt.id : '';
      }
      return;
    }
    if (ui.type === 'income') {
      var incIds = state.incomeCategories.map(function (c) { return c.id; });
      if (!ui.catId || incIds.indexOf(ui.catId) === -1) {
        ui.catId = incIds.indexOf(state.lastIncomeCategoryId) >= 0 ? state.lastIncomeCategoryId : incIds[0];
      }
    } else {
      var ids = state.categories.map(function (c) { return c.id; });
      if (ui.catId && ids.indexOf(ui.catId) === -1) ui.catId = null;
    }
    var opts = methodOptions(ui.type);
    if (!opts.some(function (o) { return o.id === ui.methodId; })) ui.methodId = defaultMethodId(ui.type);
    if (ui.methodId.indexOf('card:') !== 0) ui.exclude = false;
  }

  /* ---------- entry construction ---------- */

  function buildEntry(fields) {
    var entry = {
      id: C.createId('e'),
      type: fields.type,
      date: fields.date,
      amount: fields.amount,
      categoryId: '',
      methodType: 'cash',
      cardId: '',
      accountId: '',
      fromAccountId: '',
      toAccountId: '',
      methodLabel: '',
      memo: (fields.memo || '').slice(0, 60),
      excludePerf: false,
      origin: '',
      createdAt: nowIso(),
      updatedAt: ''
    };
    if (fields.type === 'transfer') {
      entry.methodType = 'transfer';
      entry.fromAccountId = fields.fromId || '';
      entry.toAccountId = fields.toId || '';
      return entry;
    }
    var m = methodParts(fields.type, fields.methodId);
    entry.methodType = m.methodType;
    entry.cardId = m.cardId;
    entry.accountId = m.accountId;
    entry.categoryId = fields.categoryId;
    entry.excludePerf = fields.type === 'expense' && !!fields.exclude;
    return entry;
  }

  /* ---------- hero ---------- */

  function renderHero() {
    var mk = currentMonth();
    var today = todayKey();
    var flow = C.cashFlow(state, mk, today);
    var todayEntries = C.entriesOnDay(state.entries, today);
    var todayExpense = C.sumAmounts(C.entriesOfType(todayEntries, 'expense'));
    var todayIncome = C.sumAmounts(C.entriesOfType(todayEntries, 'income'));

    var pill = statusPill(flow);
    var guideText;
    if (flow.status === 'none') guideText = '설정에서 고정비·카드 목표를 넣으면 필요 수입을 계산해요';
    else if (flow.status === 'unknown') guideText = '주간 필요 <b>' + C.formatNumber(flow.weeklyNeed) + '원</b> · 이번 달 수입을 입력해 주세요';
    else guideText = '주간 필요 <b>' + C.formatNumber(flow.weeklyNeed) + '원</b> · 지금 주평균 <b>' + C.formatNumber(flow.weeklyIncome) + '원</b>';

    var leftoverClass = flow.leftover > 0 ? 'good' : (flow.leftover < 0 ? 'bad' : '');

    var recordLine = '';
    if (flow.fixed > 0) {
      recordLine = '<span>기록 ' + C.formatNumber(flow.expense) + '원 + 고정비 ' + C.formatNumber(flow.fixed) + '원</span>';
    }

    $('#hero').innerHTML =
      '<div class="hero-label">이번 달 지출 <span style="color:var(--ink-3)">· 고정비 포함</span></div>' +
      '<div class="hero-amount">' + C.formatNumber(flow.expenseWithFixed) + '<span class="unit">원</span></div>' +
      '<div class="hero-today">' +
        '<span>오늘 지출 <b>' + C.formatNumber(todayExpense) + '원</b></span>' +
        (todayIncome > 0 ? '<span>오늘 수입 <b style="color:var(--green)">' + C.formatNumber(todayIncome) + '원</b></span>' : '') +
        recordLine +
      '</div>' +
      '<div class="hero-split">' +
        '<div><div class="k">이번 달 수입</div><div class="v">' + C.formatNumber(flow.income) + '</div></div>' +
        '<div><div class="k">여유 돈</div><div class="v ' + leftoverClass + '">' + signed(flow.leftover) + '</div></div>' +
        '<div><div class="k">주간 필요</div><div class="v">' + C.formatNumber(flow.weeklyNeed) + '</div></div>' +
      '</div>' +
      '<div class="hero-guide"><span>' + guideText + '</span>' + pill + '</div>';
  }

  function statusPill(flow) {
    var map = {
      good: ['good', '여유'],
      tight: ['tight', '주의'],
      short: ['short', '부족'],
      unknown: ['unknown', '수입 미입력'],
      none: ['none', '설정 필요']
    };
    var item = map[flow.status] || map.none;
    return '<span class="status-pill ' + item[0] + '">' + item[1] + '</span>';
  }

  /* ---------- card gauges ---------- */

  function renderGauges() {
    var wrap = $('#gaugeCard');
    var stats = C.cardStats(state.entries, state.cards, currentMonth());
    if (!state.cards.length) {
      wrap.hidden = false;
      wrap.innerHTML = '<h2 class="card-title">카드 실적</h2>' +
        '<p class="hint">카드를 추가하면 이번 달 목표 실적 진행률을 보여드려요.</p>' +
        '<button class="btn wide" data-act="add-card">+ 카드 추가</button>';
      return;
    }
    wrap.hidden = false;
    var html = '<div class="card-head"><h2 class="card-title">이번 달 카드 실적</h2><span class="card-total">목표 합계 ' +
      C.formatNumber(C.cardGoalTotal(state)) + '원</span></div>';
    stats.forEach(function (s) {
      var pct = s.goal > 0 ? Math.min(1, s.pct) : 0;
      var pctLabel = s.goal > 0 ? C.percentText(s.pct) : '목표 없음';
      html += '<div class="gauge-row">' +
        '<div class="gauge-top">' +
          '<span class="gauge-name">' + esc(s.name) + (s.credit ? '' : ' <span class="badge soft">체크</span>') +
            (s.done ? ' <span class="gauge-check">✓ 달성</span>' : '') + '</span>' +
          '<span class="gauge-pct' + (s.done ? ' done' : '') + '">' + pctLabel + '</span>' +
        '</div>' +
        '<div class="bar"><div class="bar-fill' + (s.done ? ' done' : '') + '" style="width:' + (pct * 100).toFixed(1) + '%"></div></div>' +
        '<div class="gauge-sub">' +
          '<span>' + C.formatNumber(s.spent) + (s.goal > 0 ? ' / ' + C.formatNumber(s.goal) + '원' : '원') + '</span>' +
          '<span class="rest">' + (s.goal <= 0 ? '이번 달 사용' : (s.done ? C.formatNumber(s.over) + '원 초과 달성' : '앞으로 ' + C.formatNumber(s.remaining) + '원')) + '</span>' +
        '</div>' +
        (s.excluded > 0 ? '<div class="gauge-note">실적 제외 ' + C.formatNumber(s.excluded) + '원</div>' : '') +
      '</div>';
    });
    wrap.innerHTML = html;
  }

  /* ---------- entry form ---------- */

  var QUICK_EXPENSE = [1000, 5000, 10000, 50000];
  var QUICK_INCOME = [10000, 50000, 100000, 500000];

  function renderForm() {
    ensureSelection();

    $$('.type-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-type') === ui.type);
    });

    var input = $('#amountInput');
    input.value = ui.amount ? C.formatNumber(ui.amount) : '';
    $('#clearAmount').hidden = !ui.amount;
    $('#saveMain').textContent = ui.type === 'income' ? '수입 저장' : (ui.type === 'transfer' ? '이체 저장' : '저장');

    var quick = ui.type === 'income' ? QUICK_INCOME : QUICK_EXPENSE;
    $('#quickChips').innerHTML = quick.map(function (n) {
      return '<button class="chip" data-act="add-amount" data-add="' + n + '">+' + C.formatNumber(n) + '</button>';
    }).join('') + (ui.amount ? '<button class="chip" data-act="clear-amount">지우기</button>' : '');

    var cats = ui.type === 'income' ? state.incomeCategories : state.categories;
    var selected = ui.type === 'income' ? (ui.catId || state.lastIncomeCategoryId) : ui.catId;
    $('#catGrid').hidden = ui.type === 'transfer';
    $('#catGrid').innerHTML = ui.type === 'transfer' ? '' : cats.map(function (c) {
      return '<button class="cat-btn' + (c.id === selected ? ' is-on' : '') + '" data-act="pick-cat" data-cat="' + esc(c.id) + '">' +
        '<span class="cat-emoji">' + esc(c.emoji) + '</span>' +
        '<span class="cat-name">' + esc(c.name) + '</span></button>';
    }).join('');

    $('#methodWrap').hidden = ui.type === 'transfer';
    $('#transferWrap').hidden = ui.type !== 'transfer';
    $('#methodLabel').textContent = ui.type === 'income' ? '받는 곳' : '결제 수단';
    if (ui.type === 'transfer') renderTransferChips();
    else renderMethodChips();

    var isCard = ui.type === 'expense' && ui.methodId && ui.methodId.indexOf('card:') === 0;
    $('#excludeRow').hidden = !isCard;
    $('#excludeCheck').checked = !!ui.exclude;

    var memoEl = $('#memoInput');
    if (memoEl.value !== ui.memo) memoEl.value = ui.memo;
  }

  function renderMethodChips() {
    var opts = methodOptions(ui.type);
    if (!opts.some(function (p) { return p.id === ui.methodId; })) ui.methodId = defaultMethodId(ui.type);

    $('#methodChips').innerHTML = opts.map(function (p) {
      return '<button class="method-chip' + (p.id === ui.methodId ? ' is-on' : '') + '" data-act="pick-method" data-method="' + esc(p.id) + '">' +
        esc(p.label) + (p.tag ? '<span class="mtype">' + esc(p.tag) + '</span>' : '') + '</button>';
    }).join('');
  }

  function renderTransferChips() {
    var opts = state.accounts.map(function (a) {
      return { id: a.id, label: a.name, tag: kindLabel(a.kind) };
    });
    var hint = $('#transferHint');
    if (opts.length < 2) {
      $('#fromChips').innerHTML = '';
      $('#toChips').innerHTML = '';
      hint.textContent = '내 계좌끼리 이체하려면 설정에서 계좌를 2개 이상 추가해 주세요.';
      return;
    }
    hint.textContent = '내 계좌끼리 옮기는 돈이라 지출·수입 합계에는 잡히지 않아요.';
    $('#fromChips').innerHTML = opts.map(function (p) {
      return '<button class="method-chip' + (p.id === ui.fromId ? ' is-on' : '') + '" data-act="pick-from" data-account="' + esc(p.id) + '">' +
        esc(p.label) + '<span class="mtype">' + esc(p.tag) + '</span></button>';
    }).join('');
    $('#toChips').innerHTML = opts.map(function (p) {
      return '<button class="method-chip' + (p.id === ui.toId ? ' is-on' : '') + '" data-act="pick-to" data-account="' + esc(p.id) + '">' +
        esc(p.label) + '<span class="mtype">' + esc(p.tag) + '</span></button>';
    }).join('');
  }

  function setAmount(n) {
    ui.amount = Math.max(0, Math.min(999999999, Math.round(n || 0)));
    var input = $('#amountInput');
    input.value = ui.amount ? C.formatNumber(ui.amount) : '';
    $('#clearAmount').hidden = !ui.amount;
    var quick = $('#quickChips');
    var hasClear = !!quick.querySelector('[data-act="clear-amount"]');
    if (ui.amount && !hasClear) {
      quick.insertAdjacentHTML('beforeend', '<button class="chip" data-act="clear-amount">지우기</button>');
    } else if (!ui.amount && hasClear) {
      quick.querySelector('[data-act="clear-amount"]').remove();
    }
  }

  function clearFormAfterSave() {
    ui.amount = 0;
    ui.exclude = false;
    ui.memo = '';
    $('#excludeCheck').checked = false;
    $('#memoInput').value = '';
  }

  function saveMain() {
    var amount = C.parseAmount($('#amountInput').value);
    ui.amount = amount;
    ui.memo = $('#memoInput').value;
    if (!amount) {
      toast('금액을 입력해 주세요');
      $('#amountInput').focus();
      return;
    }

    if (ui.type === 'transfer') {
      if (!ui.fromId || !ui.toId || ui.fromId === ui.toId) {
        toast('출금·입금 계좌를 다르게 골라 주세요');
        return;
      }
      state.entries.push(buildEntry({
        type: 'transfer',
        date: todayKey(),
        amount: amount,
        fromId: ui.fromId,
        toId: ui.toId,
        memo: ui.memo
      }));
      persist();
      toast('이체 ' + C.formatNumber(amount) + '원 저장했어요');
      clearFormAfterSave();
      refresh();
      renderForm();
      $('#amountInput').focus();
      return;
    }

    var catId;
    if (ui.type === 'income') {
      catId = C.findCategory(state, ui.catId || state.lastIncomeCategoryId, 'income')
        ? (ui.catId || state.lastIncomeCategoryId)
        : state.incomeCategories[0].id;
    } else {
      catId = ui.catId;
      if (!catId) {
        toast('카테고리를 골라 주세요');
        return;
      }
    }

    state.entries.push(buildEntry({
      type: ui.type,
      date: todayKey(),
      amount: amount,
      categoryId: catId,
      methodId: ui.methodId,
      memo: ui.memo,
      exclude: $('#excludeCheck').checked
    }));
    if (ui.type === 'income') state.lastIncomeCategoryId = catId;
    else state.lastCategoryId = catId;

    persist();

    var label = C.findCategory(state, catId, ui.type);
    var method = C.methodName(state, state.entries[state.entries.length - 1]);
    toast((ui.type === 'income' ? '수입' : (label ? label.name : '지출')) + ' ' + C.formatNumber(amount) + '원' +
      (method ? ' · ' + method : '') + ' 저장했어요');

    clearFormAfterSave();
    refresh();
    renderForm();
    $('#amountInput').focus();
  }

  /* ---------- entry rows ---------- */

  function entryRow(entry) {
    var type = C.entryType(entry);
    var isIncome = type === 'income';
    var isTransfer = type === 'transfer';
    var bits = [];
    bits.push(esc(C.methodName(state, entry)));
    if (entry.memo) bits.push(esc(entry.memo));
    if (entry.excludePerf) bits.push('실적 제외');
    var meta = bits.filter(Boolean).join(' · ');
    var amountClass = 'entry-amt' + (isIncome ? ' income' : (isTransfer ? ' transfer' : ''));
    var sign = isIncome ? '+' : '';
    return '<li><button class="entry" data-act="open-entry" data-id="' + esc(entry.id) + '">' +
      '<span class="entry-emoji">' + esc(C.categoryEmoji(state, entry)) + '</span>' +
      '<span class="entry-main">' +
        '<span class="entry-cat">' + esc(C.categoryName(state, entry)) + '</span>' +
        (meta ? '<span class="entry-meta">' + meta + '</span>' : '') +
      '</span>' +
      '<span class="' + amountClass + '"><span class="sign">' + sign + '</span>' + C.formatNumber(entry.amount) + '원</span>' +
    '</button></li>';
  }

  function renderToday() {
    var today = todayKey();
    var list = C.entriesOnDay(state.entries, today);
    var expense = C.sumAmounts(C.entriesOfType(list, 'expense'));
    var income = C.sumAmounts(C.entriesOfType(list, 'income'));
    var transfers = C.entriesOfType(list, 'transfer').length;

    $('#todayTitle').textContent = '오늘 · ' + dateLabel(today);
    $('#todayTotal').textContent = '지출 ' + C.formatNumber(expense) + '원' +
      (income ? ' · 수입 ' + C.formatNumber(income) + '원' : '') +
      (transfers ? ' · 이체 ' + transfers + '건' : '');
    $('#todayList').innerHTML = list.length
      ? list.map(function (e) { return entryRow(e); }).join('') + '<li class="empty" style="padding:10px 0 2px">탭하면 수정하거나 지울 수 있어요</li>'
      : '<li class="empty">아직 기록이 없어요. 위에서 금액과 카테고리를 고르면 바로 저장돼요.</li>';
  }

  /* ---------- calendar ---------- */

  function renderCalendar() {
    var mk = ui.calMonth;
    var today = todayKey();
    $('#calTitle').textContent = C.monthLabel(mk);
    $('#calWeekdays').innerHTML = C.weekdayLabels().map(function (w) { return '<span>' + w + '</span>'; }).join('');
    $('#calTodayBtn').hidden = mk === currentMonth();

    var totals = C.dayTotals(state.entries, 'expense');
    var incomes = C.daysWithIncome(state.entries);
    var transfers = C.daysWithTransfer(state.entries);
    var cells = C.monthGrid(mk, today);

    $('#calGrid').innerHTML = cells.map(function (cell) {
      var cls = 'cal-cell' + (cell.inMonth ? '' : ' out') + (cell.isToday ? ' is-today' : '') + (cell.key === ui.selectedDay ? ' is-on' : '');
      var amt = cell.inMonth ? C.compactWon(totals[cell.key] || 0) : '';
      var dot = incomes[cell.key] ? '<span class="income-dot"></span>' : (transfers[cell.key] ? '<span class="transfer-dot"></span>' : '');
      return '<button class="' + cls + '" data-act="pick-day" data-day="' + cell.key + '">' +
        dot +
        '<span class="cal-day">' + cell.day + '</span>' +
        '<span class="cal-amt">' + amt + '</span>' +
      '</button>';
    }).join('');

    var monthExpense = C.sumAmounts(C.entriesOfType(C.entriesInMonth(state.entries, mk), 'expense'));
    var monthIncome = C.sumAmounts(C.entriesOfType(C.entriesInMonth(state.entries, mk), 'income'));
    $('#calMonthTotal').textContent = '이번 달 지출 ' + C.formatNumber(monthExpense) + '원' +
      (monthIncome ? ' · 수입 ' + C.formatNumber(monthIncome) + '원' : '');
  }

  function renderDayPanel() {
    var day = ui.selectedDay;
    var list = C.entriesOnDay(state.entries, day);
    var expense = C.sumAmounts(C.entriesOfType(list, 'expense'));
    var income = C.sumAmounts(C.entriesOfType(list, 'income'));
    var transferCount = C.entriesOfType(list, 'transfer').length;

    var sub = list.length
      ? '지출 ' + C.formatNumber(expense) + '원' +
        (income ? ' · 수입 ' + C.formatNumber(income) + '원' : '') +
        (transferCount ? ' · 이체 ' + transferCount + '건' : '')
      : '기록 없음';

    var html = '<div class="card day-panel">' +
      '<div class="day-head"><span class="day-title">' + dateLabel(day) + '</span>' +
      '<span class="day-sub">' + sub + '</span></div>' +
      '<ul class="entry-list">' + (list.length
        ? list.map(function (e) { return entryRow(e); }).join('')
        : '<li class="empty">이 날은 기록이 없어요.</li>') + '</ul>' +
      '<div class="day-actions three">' +
        '<button class="btn" data-act="add-day" data-type="expense">+ 지출</button>' +
        '<button class="btn" data-act="add-day" data-type="income">+ 수입</button>' +
        '<button class="btn" data-act="add-day" data-type="transfer">+ 이체</button>' +
      '</div>' +
    '</div>';
    $('#dayPanel').innerHTML = html;
  }

  /* ---------- summary ---------- */

  function barRow(name, emoji, total, ratio, extraClass) {
    var width = ratio > 0 ? Math.max(2, Math.min(100, ratio * 100)) : 0;
    return '<div class="bar-row ' + (extraClass || '') + '">' +
      '<div class="bar-top"><span class="name">' + (emoji ? esc(emoji) + ' ' : '') + esc(name) + '</span>' +
      '<span class="amt"><b>' + C.formatNumber(total) + '원</b> · ' + C.percentText(ratio) + '</span></div>' +
      '<div class="bar"><div class="bar-fill" style="width:' + width.toFixed(1) + '%"></div></div>' +
    '</div>';
  }

  function deltaText(summary) {
    if (summary.change === null) return '<span class="delta">지난달 기록 없음</span>';
    var pct = Math.round(summary.change * 100);
    var cls = pct > 0 ? 'up' : (pct < 0 ? 'down' : '');
    return '<span class="delta ' + cls + '">' + (pct > 0 ? '+' : '') + pct + '%</span>';
  }

  function renderAssets() {
    var snap = C.assetSnapshot(state, currentMonth());
    var html = '<div class="card-head"><h2 class="card-title">내 돈</h2>' +
      '<span class="card-total">지금 기준</span></div>';

    if (!snap.hasAccounts) {
      html += '<p class="hint">계좌·적금을 등록하면 총자산과 비상금 목표, 지금 쓸 수 있는 여윳돈을 여기서 볼 수 있어요.</p>' +
        '<button class="btn wide" data-act="tab" data-view="settings">계좌 등록하기</button>';
      $('#sumAssets').innerHTML = html;
      return;
    }

    html += '<div class="asset-total">' + C.formatNumber(snap.total) + '<span class="unit">원</span></div>' +
      '<div class="asset-split">' +
        '<div><span class="k">입출금·페이</span><b>' + C.formatNumber(snap.cash) + '</b></div>' +
        '<div><span class="k">적금</span><b>' + C.formatNumber(snap.savings) + '</b></div>' +
      '</div>';

    if (snap.emergencyGoal > 0) {
      var pct = Math.min(1, snap.emergencyPct);
      html += '<div class="gauge-box">' +
        '<div class="gauge-top"><span class="gauge-name">비상금 ' +
          (snap.emergencyDone ? '<span class="gauge-check">✓ 달성</span>' : '') + '</span>' +
        '<span class="gauge-pct' + (snap.emergencyDone ? ' done' : '') + '">' + C.percentText(snap.emergencyPct) + '</span></div>' +
        '<div class="bar"><div class="bar-fill' + (snap.emergencyDone ? ' done' : '') + '" style="width:' + (pct * 100).toFixed(1) + '%"></div></div>' +
        '<div class="gauge-sub"><span>' + C.formatNumber(snap.emergencyCurrent) + ' / ' + C.formatNumber(snap.emergencyGoal) + '원</span>' +
        '<span class="rest">' + (snap.emergencyDone ? '목표 달성!' : C.formatNumber(snap.emergencyRemaining) + '원 남음') + '</span></div>' +
      '</div>';
    } else {
      html += '<div class="gauge-box"><div class="gauge-top"><span class="gauge-name">비상금</span>' +
        '<span class="gauge-pct">' + C.formatNumber(snap.emergencyCurrent) + '원</span></div>' +
        '<p class="hint">목표 금액을 정하면 달성률 게이지가 나와요.</p>' +
        '<button class="btn tiny" data-act="edit-goal">목표 정하기</button></div>';
    }

    if (snap.spendable === null) {
      html += '<div class="spendable"><div class="k">지금 쓸 수 있는 여윳돈</div>' +
        '<div class="v">—</div><div class="s">계좌를 등록하면 계산돼요.</div></div>';
    } else {
      var cls = snap.spendable < 0 ? 'bad' : '';
      html += '<div class="spendable">' +
        '<div class="k">지금 쓸 수 있는 여윳돈</div>' +
        '<div class="v ' + cls + '">' + C.formatNumber(snap.spendable) + '<span>원</span></div>' +
        '<div class="s">입출금·페이 ' + C.formatNumber(snap.cash) +
          ' − 남은 고정비 ' + C.formatNumber(snap.fixedLeft) +
          ' − 카드 결제 예정 ' + C.formatNumber(snap.cardDue) +
          ' − 적금 예정 ' + C.formatNumber(snap.savingsLeft) + '</div>' +
        (snap.spendable < 0 ? '<div class="s bad">지금 가진 돈보다 나갈 돈이 많아요.</div>' : '') +
      '</div>';
    }

    html += '<ul class="acc-list">' + snap.accounts.map(function (a) {
      return '<li class="acc-row">' +
        '<span class="acc-name">' + esc(a.name) + ' <span class="badge soft">' + kindLabel(a.kind) + '</span>' +
          (a.emergency ? ' <span class="badge">비상금</span>' : '') + '</span>' +
        '<span class="acc-amt' + (a.balance < 0 ? ' bad' : '') + '">' + C.formatNumber(a.balance) + '원</span>' +
      '</li>';
    }).join('') + '</ul>';

    $('#sumAssets').innerHTML = html;
  }

  function renderSummary() {
    var mk = ui.sumMonth;
    var summary = C.monthSummary(state, mk, todayKey());
    var flow = summary.flow;

    renderAssets();
    $('#sumTitle').textContent = C.monthLabel(mk);

    $('#sumTotals').innerHTML =
      '<div class="card-head"><h2 class="card-title">지출 · 고정비 포함</h2>' +
      '<span class="card-total">기록 ' + summary.count + '건</span></div>' +
      '<div class="big-amount">' + C.formatNumber(flow.expenseWithFixed) + '<span class="unit">원</span></div>' +
      '<div class="totals-grid">' +
        '<div><div class="k">기록한 지출</div><div class="v">' + C.formatNumber(summary.total) + '</div></div>' +
        '<div><div class="k">고정비</div><div class="v">' + C.formatNumber(flow.fixed) + '</div></div>' +
        '<div><div class="k">지난달 지출</div><div class="v">' + (summary.prevTotal ? C.formatNumber(summary.prevTotal) + deltaText(summary) : '<span style="color:var(--ink-3)">—</span>') + '</div></div>' +
        '<div><div class="k">하루 평균</div><div class="v">' + C.formatNumber(summary.dailyAvg) + '</div></div>' +
      '</div>' +
      (summary.transferCount ? '<p class="fine">내 계좌 이체 ' + summary.transferCount + '건(' +
        C.formatNumber(summary.transferTotal) + '원)은 지출·수입 합계에서 빠져 있어요.</p>' : '');

    var leftoverClass = flow.leftover > 0 ? 'good' : (flow.leftover < 0 ? 'bad' : '');
    var guideBody = '';
    if (flow.status === 'none') {
      guideBody = '<div class="guide-sub">고정비나 카드 목표 실적을 설정하면 매주 얼마가 필요한지 계산해 드려요.</div>';
    } else if (flow.status === 'unknown') {
      guideBody = '<div class="guide-sub">한 달 ' + C.formatNumber(flow.monthlyNeed) + '원 이상 필요 · 고정비 ' +
        C.formatNumber(flow.fixed) + (flow.cardGoals ? ' + 카드 실적 ' + C.formatNumber(flow.cardGoals) : '') + '</div>' +
        '<div class="guide-compare">이번 달 수입을 입력하면 지금 여유가 있는지 알려드려요.</div>';
    } else {
      var gapWord = flow.weeklyGap >= 0 ? '여유' : '부족';
      guideBody = '<div class="guide-sub">한 달 ' + C.formatNumber(flow.monthlyNeed) + '원 이상 · 고정비 ' +
        C.formatNumber(flow.fixed) + (flow.cardGoals ? ' + 카드 실적 ' + C.formatNumber(flow.cardGoals) : '') + '</div>' +
        '<div class="guide-compare">지금 주평균 <b>' + C.formatNumber(flow.weeklyIncome) + '원</b> → 주당 <b>' +
        signed(flow.weeklyGap) + '원</b> ' + gapWord + '</div>';
    }

    $('#sumFlow').innerHTML =
      '<h2 class="card-title">이번 달 자금</h2>' +
      '<div class="flow-summary">' +
        '<div class="flow-box"><div class="k">수입</div><div class="v">' + C.formatNumber(flow.income) + '</div>' +
          '<div class="s">' + summary.incomeCount + '건</div></div>' +
        '<div class="flow-box"><div class="k">여유 돈</div><div class="v ' + leftoverClass + '">' + signed(flow.leftover) + '</div>' +
          '<div class="s">수입 − 고정비 − 변동지출</div></div>' +
      '</div>' +
      '<div class="guide">' +
        '<div class="guide-head"><span class="guide-title">주간 필요 수입</span>' + statusPill(flow) + '</div>' +
        '<div class="guide-main">' + C.formatNumber(flow.weeklyNeed) + '원<span>/ 주</span></div>' +
        guideBody +
      '</div>';

    $('#sumCats').innerHTML = '<h2 class="card-title">카테고리별 지출</h2>' +
      (summary.categories.length
        ? '<div class="bars">' + summary.categories.map(function (c) {
            return barRow(c.name, c.emoji, c.total, c.ratio);
          }).join('') + '</div>'
        : '<p class="hint">이 달에 기록한 지출이 없어요.</p>');

    $('#sumIncome').innerHTML = '<h2 class="card-title">수입</h2>' +
      (summary.incomeCategories.length
        ? '<div class="bars">' + summary.incomeCategories.map(function (c) {
            return barRow(c.name, c.emoji, c.total, c.ratio, 'income');
          }).join('') + '</div>'
        : '<p class="hint">이 달에 기록한 수입이 없어요. 입력 화면에서 ‘수입’으로 바꿔 적을 수 있어요.</p>');

    if (summary.cards.length) {
      $('#sumCards').innerHTML = '<h2 class="card-title">카드별 지출</h2>' + summary.cards.map(function (s) {
        var cardEntries = C.entriesOfType(C.entriesInMonth(state.entries, mk), 'expense').filter(function (e) {
          return e.methodType === 'card' && e.cardId === s.id;
        });
        var fv = C.fixedVariable(cardEntries);
        var fxRatio = fv.total ? fv.fixed / fv.total : 0;
        var tops = C.topCategories(cardEntries, state.categories, 3);
        return '<div class="card-block">' +
          '<div class="card-block-head"><span class="card-block-name">' + esc(s.name) + (s.done ? ' <span class="gauge-check">✓</span>' : '') + '</span>' +
          '<span class="card-block-amt">' + C.formatNumber(s.paid) + '원</span></div>' +
          '<div class="card-block-sub">실적 ' + C.formatNumber(s.spent) + '원' +
            (s.excluded ? ' · 제외 ' + C.formatNumber(s.excluded) + '원' : '') +
            (s.goal > 0 ? ' · 목표 ' + C.percentText(s.pct) : '') + '</div>' +
          (fv.total ? '<div class="split-bar"><i class="fx" style="width:' + (fxRatio * 100).toFixed(1) + '%"></i><i class="vr" style="width:' + ((1 - fxRatio) * 100).toFixed(1) + '%"></i></div>' +
            '<div class="card-block-sub">고정비(분류) ' + C.formatNumber(fv.fixed) + ' · 변동 ' + C.formatNumber(fv.variable) + '</div>' : '') +
          (tops.length ? '<div class="top-cats">' + tops.map(function (t) {
            return '<span class="top-cat">' + esc(t.name) + ' ' + C.formatNumber(t.total) + '</span>';
          }).join('') + '</div>' : '') +
        '</div>';
      }).join('');
    } else {
      $('#sumCards').innerHTML = '<h2 class="card-title">카드별 지출</h2><p class="hint">등록된 카드가 없어요. 설정에서 카드를 추가해 보세요.</p>';
    }

    $('#sumMethods').innerHTML = '<h2 class="card-title">결제 수단</h2>' +
      '<div class="bars">' +
        barRow('카드', '💳', summary.methods.card, summary.total ? summary.methods.card / summary.total : 0) +
        barRow('계좌', '🏦', summary.methods.account, summary.total ? summary.methods.account / summary.total : 0) +
        barRow('현금', '💵', summary.methods.cash, summary.total ? summary.methods.cash / summary.total : 0) +
      '</div>' +
      (summary.excluded ? '<p class="fine">카드 실적 제외 ' + C.formatNumber(summary.excluded) + '원은 지출 합계에는 들어가고 실적 게이지에서는 빠져요.</p>' : '') +
      (summary.transferCount ? '<p class="fine">계좌 이체 ' + C.formatNumber(summary.transferTotal) + '원은 결제 수단 합계에 들어가지 않아요.</p>' : '');
  }

  /* ---------- settings ---------- */

  function itemRow(opts) {
    return '<div class="item-row">' +
      '<div class="item-main"><div class="item-name">' + opts.name + '</div>' +
      (opts.sub ? '<div class="item-sub">' + opts.sub + '</div>' : '') + '</div>' +
      (opts.amount != null ? '<div class="item-amount">' + opts.amount + '</div>' : '') +
      '<div class="row-actions">' +
        '<button class="linkish" data-act="' + opts.editAct + '" data-id="' + esc(opts.id) + '">수정</button>' +
        (opts.delAct ? '<button class="linkish danger" data-act="' + opts.delAct + '" data-id="' + esc(opts.id) + '">삭제</button>' : '') +
      '</div>' +
    '</div>';
  }

  function renderSettings() {
    // accounts
    $('#accountList').innerHTML = state.accounts.length
      ? state.accounts.map(function (a) {
          var bal = C.accountBalance(state, a.id);
          var badge = a.emergency ? ' <span class="badge">비상금</span>' : '';
          var monthly = (a.kind === 'savings' && a.monthly > 0) ? ' · 월 ' + C.formatNumber(a.monthly) + '원' : '';
          return itemRow({
            id: a.id,
            name: esc(a.name) + badge,
            sub: kindLabel(a.kind) + monthly,
            amount: '<span' + (bal < 0 ? ' style="color:var(--red)"' : '') + '>' + C.formatNumber(bal) + '원</span>',
            editAct: 'edit-account',
            delAct: 'del-account'
          });
        }).join('')
      : '<p class="hint">아직 등록한 계좌가 없어요. 입출금·페이 계좌와 적금을 각각 추가해 보세요.</p>';
    var snap = C.assetSnapshot(state, currentMonth());
    $('#accTotal').textContent = state.accounts.length ? '총 ' + C.formatNumber(snap.total) + '원' : '';

    // emergency goal
    var goal = C.emergencyGoal(state);
    $('#goalNow').textContent = goal > 0
      ? C.formatNumber(snap.emergencyCurrent) + ' / ' + C.formatNumber(goal) + '원'
      : '목표 없음';

    // fixed costs
    $('#fixedList').innerHTML = state.fixedCosts.length
      ? state.fixedCosts.map(function (f) {
          return itemRow({
            id: f.id,
            name: esc(f.name),
            sub: f.amount > 0 ? '매달 고정' : '금액을 입력해 주세요',
            amount: f.amount > 0 ? C.formatNumber(f.amount) + '원' : '<span style="color:var(--amber)">미입력</span>',
            editAct: 'edit-fixed',
            delAct: 'del-fixed'
          });
        }).join('')
      : '<p class="hint">아직 고정비 항목이 없어요.</p>';
    $('#fixedTotal').innerHTML = '<span>월 고정비 합계</span><strong>' + C.formatNumber(C.fixedCostTotal(state)) + '원</strong>';

    // cards
    $('#cardList').innerHTML = state.cards.length
      ? state.cards.map(function (c) {
          var linked = c.credit === false
            ? (C.findAccount(state, c.accountId) ? C.findAccount(state, c.accountId).name + '에서 출금' : '연결 계좌 없음')
            : '잔액 차감 없음';
          return itemRow({
            id: c.id,
            name: esc(c.name),
            sub: (c.credit === false ? '체크카드' : '신용카드') +
              (c.goal > 0 ? ' · 목표 ' + C.formatNumber(c.goal) + '원' : '') + ' · ' + esc(linked),
            amount: c.goal > 0 ? C.formatNumber(c.goal) + '원' : '—',
            editAct: 'edit-card',
            delAct: 'del-card'
          });
        }).join('')
      : '<p class="hint">등록된 카드가 없어요.</p>';
    $('#cardTotal').innerHTML = '<span>카드 목표 합계</span><strong>' + C.formatNumber(C.cardGoalTotal(state)) + '원</strong>';

    // categories
    $('#catList').innerHTML = state.categories.map(function (c) {
      return itemRow({
        id: c.id,
        name: esc(c.emoji) + ' ' + esc(c.name),
        sub: C.entriesOfType(state.entries, 'expense').filter(function (e) { return e.categoryId === c.id; }).length + '건',
        editAct: 'edit-cat',
        delAct: c.id === C.ETC_CATEGORY_ID ? null : 'del-cat'
      });
    }).join('');

    $('#incomeCatList').innerHTML = state.incomeCategories.map(function (c) {
      return itemRow({
        id: c.id,
        name: esc(c.emoji) + ' ' + esc(c.name),
        sub: C.entriesOfType(state.entries, 'income').filter(function (e) { return e.categoryId === c.id; }).length + '건',
        editAct: 'edit-income-cat',
        delAct: c.id === C.ETC_INCOME_CATEGORY_ID ? null : 'del-income-cat'
      });
    }).join('');

    $('#verLine').textContent = 'Spend Note ' + VERSION_LABEL + ' · 모든 기록은 이 기기 브라우저에만 저장돼요.';
  }

  /* ---------- refresh ---------- */

  function refresh() {
    renderHero();
    renderGauges();
    renderToday();
    renderCalendar();
    renderDayPanel();
    renderSummary();
    renderSettings();
    $('#todayLabel').textContent = dateLabel(todayKey());
  }

  function setView(view) {
    ui.view = view;
    $$('.view').forEach(function (el) { el.classList.toggle('is-active', el.id === 'view-' + view); });
    $$('.tab').forEach(function (el) { el.classList.toggle('is-active', el.getAttribute('data-view') === view); });
    if (view === 'calendar') { renderCalendar(); renderDayPanel(); }
    if (view === 'summary') renderSummary();
    if (view === 'add') renderHero();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- entry sheet ---------- */

  function openEntryDialog(entryOrOpts) {
    if (entryOrOpts && entryOrOpts.id) {
      var e = state.entries.filter(function (x) { return x.id === entryOrOpts.id; })[0];
      if (!e) return toast('내역을 찾지 못했어요');
      ui.sheet = {
        mode: 'edit',
        id: e.id,
        date: e.date,
        type: C.entryType(e),
        amount: e.amount,
        catId: e.categoryId,
        methodId: methodIdOf(e),
        fromId: e.fromAccountId || '',
        toId: e.toAccountId || '',
        memo: e.memo || '',
        exclude: !!e.excludePerf
      };
    } else {
      var opts = entryOrOpts || {};
      var type = opts.type === 'income' ? 'income' : (opts.type === 'transfer' ? 'transfer' : 'expense');
      var transfer = type === 'transfer' ? defaultTransferIds() : { from: '', to: '' };
      ui.sheet = {
        mode: 'add',
        id: null,
        date: opts.date || todayKey(),
        type: type,
        amount: opts.amount || 0,
        catId: type === 'income' ? (state.lastIncomeCategoryId || state.incomeCategories[0].id) : null,
        methodId: defaultMethodId(type),
        fromId: transfer.from,
        toId: transfer.to,
        memo: '',
        exclude: false
      };
    }
    renderEntrySheet();
    var dlg = $('#entryDialog');
    if (!dlg.open) dlg.showModal();
  }

  function defaultTransferIds() {
    var cash = C.cashAccounts(state);
    var savings = C.savingsAccounts(state);
    var from = cash[0] || state.accounts[0];
    var to = savings[0] || cash[1] || state.accounts.filter(function (a) { return from && a.id !== from.id; })[0];
    return { from: from ? from.id : '', to: to ? to.id : '' };
  }

  function methodButtons(s, opts, act) {
    return opts.map(function (m) {
      return '<button class="method-chip' + (m.id === s.methodId ? ' is-on' : '') + '" data-act="' + act + '" data-method="' + esc(m.id) + '">' + esc(m.label) + '</button>';
    }).join('');
  }

  function renderEntrySheet() {
    var s = ui.sheet;
    if (!s) return;
    var isIncome = s.type === 'income';
    var isTransfer = s.type === 'transfer';
    var cats = isIncome ? state.incomeCategories : state.categories;
    var methods = methodOptions(s.type);
    if (!isTransfer && !methods.some(function (m) { return m.id === s.methodId; })) s.methodId = defaultMethodId(s.type);
    var accounts = state.accounts;

    var html = '<h2>' + (s.mode === 'edit' ? '내역 수정' : (isIncome ? '수입 추가' : (isTransfer ? '이체 추가' : '지출 추가'))) + '</h2>' +
      '<div class="type-toggle three">' +
        '<button class="type-btn' + (!isIncome && !isTransfer ? ' is-on' : '') + '" data-act="sheet-type" data-type="expense">지출</button>' +
        '<button class="type-btn' + (isIncome ? ' is-on' : '') + '" data-act="sheet-type" data-type="income">수입</button>' +
        '<button class="type-btn' + (isTransfer ? ' is-on' : '') + '" data-act="sheet-type" data-type="transfer">이체</button>' +
      '</div>' +
      '<label class="sheet-label">날짜</label>' +
      '<input class="sheet-input" type="date" id="shDate" value="' + esc(s.date) + '">' +
      '<label class="sheet-label">금액</label>' +
      '<input class="sheet-input" type="text" inputmode="numeric" id="shAmount" placeholder="0" value="' + (s.amount ? C.formatNumber(s.amount) : '') + '">';

    if (isTransfer) {
      html += '<label class="sheet-label">출금 계좌</label><div class="method-scroll">' + accounts.map(function (a) {
          return '<button class="method-chip' + (a.id === s.fromId ? ' is-on' : '') + '" data-act="sheet-from" data-account="' + esc(a.id) + '">' + esc(a.name) + '</button>';
        }).join('') + '</div>' +
        '<label class="sheet-label">입금 계좌</label><div class="method-scroll">' + accounts.map(function (a) {
          return '<button class="method-chip' + (a.id === s.toId ? ' is-on' : '') + '" data-act="sheet-to" data-account="' + esc(a.id) + '">' + esc(a.name) + '</button>';
        }).join('') + '</div>';
    } else {
      html += '<label class="sheet-label">카테고리</label>' +
        '<div class="cat-grid" id="shCats">' + cats.map(function (c) {
          return '<button class="cat-btn' + (c.id === s.catId ? ' is-on' : '') + '" data-act="sheet-cat" data-cat="' + esc(c.id) + '">' +
            '<span class="cat-emoji">' + esc(c.emoji) + '</span><span class="cat-name">' + esc(c.name) + '</span></button>';
        }).join('') + '</div>' +
        '<label class="sheet-label">' + (isIncome ? '받는 곳' : '결제 수단') + '</label>' +
        '<div class="method-scroll" id="shMethods">' + methodButtons(s, methods, 'sheet-method') + '</div>';
    }

    html += '<label class="sheet-label">메모 (선택)</label>' +
      '<input class="sheet-input" type="text" id="shMemo" maxlength="60" placeholder="예: 점심, 관리비" value="' + esc(s.memo) + '">' +
      (!isTransfer && !isIncome && s.methodId.indexOf('card:') === 0
        ? '<label class="check-row" style="margin-top:12px"><input type="checkbox" id="shExclude"' + (s.exclude ? ' checked' : '') + '><span>카드 실적에서 빼기 <em>세금·상품권·해외결제 등</em></span></label>'
        : '') +
      '<div class="sheet-actions">' +
        (s.mode === 'edit' ? '<button class="btn danger" data-act="delete-entry">삭제</button>' : '<button class="btn" data-act="close-sheet">취소</button>') +
        '<button class="btn primary" data-act="save-entry">저장</button>' +
      '</div>';

    $('#entryBody').innerHTML = html;

    var amountEl = $('#shAmount');
    amountEl.addEventListener('input', function () {
      var formatted = C.sanitizeAmountInput(amountEl.value);
      if (formatted !== amountEl.value) amountEl.value = formatted;
      s.amount = C.parseAmount(formatted);
    });
    $('#shDate').addEventListener('change', function (ev) { s.date = ev.target.value; });
    $('#shMemo').addEventListener('input', function (ev) { s.memo = ev.target.value; });
    var ex = $('#shExclude');
    if (ex) ex.addEventListener('change', function (ev) { s.exclude = ev.target.checked; });
  }

  function saveSheetEntry() {
    var s = ui.sheet;
    if (!s) return;
    var amount = C.parseAmount($('#shAmount').value);
    s.amount = amount;
    var date = $('#shDate').value;
    if (!C.isDateKey(date)) return toast('날짜를 확인해 주세요');
    if (!amount) return toast('금액을 입력해 주세요');

    if (s.type === 'transfer') {
      if (!s.fromId || !s.toId || s.fromId === s.toId) return toast('출금·입금 계좌를 다르게 골라 주세요');
    }

    var fields = { date: date, amount: amount, memo: $('#shMemo').value };
    if (s.type === 'transfer') {
      fields.type = 'transfer';
      fields.fromId = s.fromId;
      fields.toId = s.toId;
    } else {
      var catId = s.catId;
      if (!C.findCategory(state, catId, s.type)) {
        catId = s.type === 'income' ? state.incomeCategories[0].id : null;
      }
      if (!catId) return toast('카테고리를 골라 주세요');
      fields.type = s.type;
      fields.categoryId = catId;
      fields.methodId = s.methodId;
      fields.exclude = !!(($('#shExclude') || {}).checked);
      s.catId = catId;
    }

    if (s.mode === 'edit') {
      var target = null;
      for (var i = 0; i < state.entries.length; i++) {
        if (state.entries[i].id === s.id) { target = state.entries[i]; break; }
      }
      if (!target) { closeSheet(); return toast('내역을 찾지 못했어요'); }
      var rebuilt = buildEntry(fields);
      ['type', 'date', 'amount', 'categoryId', 'methodType', 'cardId', 'accountId',
        'fromAccountId', 'toAccountId', 'methodLabel', 'memo', 'excludePerf'].forEach(function (k) {
        target[k] = rebuilt[k];
      });
      target.updatedAt = nowIso();
      toast('수정했어요');
    } else {
      state.entries.push(buildEntry(fields));
      if (s.type === 'income') state.lastIncomeCategoryId = fields.categoryId;
      else if (s.type === 'expense') state.lastCategoryId = fields.categoryId;
      toast(C.formatNumber(amount) + '원 저장했어요');
    }

    persist();
    closeSheet();
    refresh();
    renderForm();
  }

  function deleteSheetEntry() {
    var s = ui.sheet;
    if (!s || s.mode !== 'edit') return;
    if (!window.confirm('이 내역을 지울까요?')) return;
    var before = state.entries.length;
    state.entries = state.entries.filter(function (e) { return e.id !== s.id; });
    persist();
    closeSheet();
    refresh();
    renderForm();
    toast(before === state.entries.length ? '이미 지워졌어요' : '지웠어요');
  }

  function closeSheet() {
    [$('#entryDialog'), $('#itemDialog'), $('#parseDialog')].forEach(function (d) { if (d && d.open) d.close(); });
    ui.sheet = null;
    ui.item = null;
    ui.parsed = null;
  }

  /* ---------- item dialog (card / fixed / category) ---------- */

  function openItemDialog(cfg) {
    ui.item = cfg;
    var showAmount = cfg.showAmount !== false;
    $('#itemBody').innerHTML =
      '<h2>' + esc(cfg.title) + '</h2>' +
      '<label class="sheet-label">' + esc(cfg.nameLabel || '이름') + '</label>' +
      '<input class="sheet-input" type="text" id="itName" maxlength="24" placeholder="' + esc(cfg.namePlaceholder || '') + '" value="' + esc(cfg.name || '') + '">' +
      (showAmount
        ? '<label class="sheet-label">' + esc(cfg.amountLabel || '금액') + '</label>' +
          '<input class="sheet-input" type="text" inputmode="numeric" id="itAmount" placeholder="0" value="' + (cfg.amount ? C.formatNumber(cfg.amount) : '') + '">' +
          (cfg.note ? '<p class="sheet-note">' + esc(cfg.note) + '</p>' : '')
        : (cfg.note ? '<p class="sheet-note">' + esc(cfg.note) + '</p>' : '')) +
      (cfg.extraHtml || '') +
      '<div class="sheet-actions">' +
        (cfg.deleteAct && cfg.id
          ? '<button class="btn danger" data-act="item-delete">삭제</button>'
          : '<button class="btn" data-act="close-sheet">취소</button>') +
        '<button class="btn primary" data-act="item-save">저장</button>' +
      '</div>';

    var amountEl = $('#itAmount');
    if (amountEl) {
      amountEl.addEventListener('input', function () {
        var formatted = C.sanitizeAmountInput(amountEl.value);
        if (formatted !== amountEl.value) amountEl.value = formatted;
      });
    }
    var dlg = $('#itemDialog');
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { var n = $('#itName'); if (n) n.focus(); }, 60);
  }

  function saveItem() {
    var cfg = ui.item;
    if (!cfg) return;
    var name = ($('#itName').value || '').replace(/\s+/g, ' ').trim();
    if (!name) return toast('이름을 입력해 주세요');
    var amountEl = $('#itAmount');
    var amount = amountEl ? C.parseAmount(amountEl.value) : 0;
    if (amountEl && amount <= 0 && cfg.requireAmount) return toast('금액을 입력해 주세요');

    cfg.onSave(name, amount);
    persist();
    closeSheet();
    refresh();
    renderForm();
  }

  /* ---------- account dialog ---------- */

  function openAccountDialog(account, kindDefault) {
    var editing = !!account;
    var kind = account ? account.kind : (kindDefault || 'checking');
    var current = account ? C.accountBalance(state, account.id) : 0;
    var kindOptions = [
      { v: 'checking', t: '입출금 계좌' },
      { v: 'pay', t: '페이 (간편결제 충전금)' },
      { v: 'savings', t: '적금' }
    ];
    ui.item = { mode: 'account', id: account ? account.id : '' };

    $('#itemBody').innerHTML =
      '<h2>' + (editing ? '계좌 수정' : (kind === 'savings' ? '적금 추가' : '계좌 추가')) + '</h2>' +
      '<label class="sheet-label">이름</label>' +
      '<input class="sheet-input" type="text" id="acName" maxlength="24" placeholder="예: ○○은행, ○○페이, ○○적금" value="' + esc(account ? account.name : '') + '">' +
      '<label class="sheet-label">종류</label>' +
      '<select class="sheet-input" id="acKind">' + kindOptions.map(function (o) {
        return '<option value="' + o.v + '"' + (o.v === kind ? ' selected' : '') + '>' + o.t + '</option>';
      }).join('') + '</select>' +
      '<label class="sheet-label">지금 잔액 (원)</label>' +
      '<input class="sheet-input" type="text" inputmode="numeric" id="acBalance" placeholder="0" value="' + (current ? C.formatNumber(current) : '') + '">' +
      '<p class="sheet-note">지금 잔액을 적으면 오늘 이후 기록만 잔액에 더하고 빼요. 이체·지출·수입이 여기에 반영돼요.</p>' +
      '<div id="acMonthlyWrap">' +
        '<label class="sheet-label">월 저축 예정액 (원, 선택)</label>' +
        '<input class="sheet-input" type="text" inputmode="numeric" id="acMonthly" placeholder="0" value="' + (account && account.monthly ? C.formatNumber(account.monthly) : '') + '">' +
        '<p class="sheet-note">매달 이 적금으로 넣을 금액이에요. 이체로 채우면 ‘적금 예정’에서 빠져요.</p>' +
      '</div>' +
      '<label class="check-row" style="margin-top:12px"><input type="checkbox" id="acEmergency"' +
        (account ? (account.emergency ? ' checked' : '') : (kind === 'savings' ? ' checked' : '')) + '>' +
        '<span>비상금에 포함 <em>이 잔액을 비상금 목표에 더해요</em></span></label>' +
      '<div class="sheet-actions">' +
        (editing ? '<button class="btn danger" data-act="account-delete">삭제</button>' : '<button class="btn" data-act="close-sheet">취소</button>') +
        '<button class="btn primary" data-act="account-save">저장</button>' +
      '</div>';

    var balEl = $('#acBalance');
    balEl.addEventListener('input', function () {
      var formatted = C.sanitizeAmountInput(balEl.value);
      if (formatted !== balEl.value) balEl.value = formatted;
    });
    var monthEl = $('#acMonthly');
    monthEl.addEventListener('input', function () {
      var formatted = C.sanitizeAmountInput(monthEl.value);
      if (formatted !== monthEl.value) monthEl.value = formatted;
    });
    function syncKind() {
      $('#acMonthlyWrap').hidden = $('#acKind').value !== 'savings';
      if ($('#acKind').value === 'savings' && !editing) $('#acEmergency').checked = true;
    }
    $('#acKind').addEventListener('change', syncKind);
    syncKind();

    var dlg = $('#itemDialog');
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { $('#acName').focus(); }, 60);
  }

  function saveAccount() {
    var cfg = ui.item;
    if (!cfg || cfg.mode !== 'account') return;
    var name = ($('#acName').value || '').replace(/\s+/g, ' ').trim();
    if (!name) return toast('이름을 입력해 주세요');
    var kind = $('#acKind').value;
    var target = C.parseAmount($('#acBalance').value);
    var monthly = kind === 'savings' ? C.parseAmount($('#acMonthly').value) : 0;
    var emergency = !!$('#acEmergency').checked;
    var anchor = todayKey();

    var duplicate = state.accounts.some(function (a) { return a.name === name && a.id !== cfg.id; });
    if (duplicate) return toast('같은 이름의 계좌가 이미 있어요');

    var acc = cfg.id ? C.findAccount(state, cfg.id) : null;
    if (acc) {
      var opening = C.openingForTarget(state, acc.id, target, anchor);
      acc.name = name;
      acc.kind = C.accountKind(kind);
      acc.opening = opening;
      acc.anchorDate = anchor;
      acc.monthly = monthly;
      acc.emergency = emergency;
      acc.emoji = kind === 'savings' ? '🏦' : (kind === 'pay' ? '📱' : '💳');
    } else {
      var id = C.accountIdFor(name);
      var n = 1;
      while (state.accounts.some(function (a) { return a.id === id; })) id = C.accountIdFor(name) + '_' + (n++);
      state.accounts.push({
        id: id,
        name: name,
        kind: C.accountKind(kind),
        emoji: kind === 'savings' ? '🏦' : (kind === 'pay' ? '📱' : '💳'),
        opening: target,
        anchorDate: anchor,
        monthly: monthly,
        emergency: emergency,
        createdAt: nowIso()
      });
    }

    persist();
    closeSheet();
    refresh();
    renderForm();
    toast('저장했어요');
  }

  function deleteAccount() {
    var cfg = ui.item;
    if (!cfg || cfg.mode !== 'account' || !cfg.id) return;
    var acc = C.findAccount(state, cfg.id);
    if (!acc) return;
    var used = state.entries.filter(function (e) {
      return e.accountId === acc.id || (e.methodType === 'account' && e.accountId === acc.id);
    }).length;
    var linkedTransfers = state.entries.filter(function (e) {
      return C.entryType(e) === 'transfer' && (e.fromAccountId === acc.id || e.toAccountId === acc.id);
    }).length;
    var msg = '‘' + acc.name + '’ 계좌를 지울까요?';
    if (used) msg += '\n이 계좌로 기록한 ' + used + '건은 결제 수단이 ‘현금’으로 바뀌어요.';
    if (linkedTransfers) msg += '\n이 계좌가 들어간 이체 ' + linkedTransfers + '건은 함께 지워져요.';
    if (!window.confirm(msg)) return;

    state.entries = state.entries.filter(function (e) {
      if (C.entryType(e) === 'transfer' && (e.fromAccountId === acc.id || e.toAccountId === acc.id)) return false;
      return true;
    });
    state.entries.forEach(function (e) {
      if (e.methodType === 'account' && e.accountId === acc.id) {
        e.methodType = 'cash';
        e.accountId = '';
      }
    });
    state.cards.forEach(function (c) {
      if (c.accountId === acc.id) c.accountId = '';
    });
    state.accounts = state.accounts.filter(function (a) { return a.id !== acc.id; });
    persist();
    closeSheet();
    refresh();
    renderForm();
    toast('계좌를 지웠어요');
  }

  function openGoalDialog() {
    ui.item = { mode: 'goal' };
    $('#itemBody').innerHTML =
      '<h2>비상금 목표</h2>' +
      '<label class="sheet-label">목표 금액 (원)</label>' +
      '<input class="sheet-input" type="text" inputmode="numeric" id="goalAmount" placeholder="예: 10000000" value="' +
        (C.emergencyGoal(state) ? C.formatNumber(C.emergencyGoal(state)) : '') + '">' +
      '<p class="sheet-note">‘비상금에 포함’을 체크한 계좌·적금 잔액이 이 목표에 쌓여요. 0으로 두면 게이지를 숨겨요.</p>' +
      '<div class="sheet-actions">' +
        '<button class="btn" data-act="close-sheet">취소</button>' +
        '<button class="btn primary" data-act="goal-save">저장</button>' +
      '</div>';
    var el = $('#goalAmount');
    el.addEventListener('input', function () {
      var formatted = C.sanitizeAmountInput(el.value);
      if (formatted !== el.value) el.value = formatted;
    });
    var dlg = $('#itemDialog');
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { el.focus(); }, 60);
  }

  function saveGoal() {
    var goal = C.parseAmount($('#goalAmount').value);
    state.settings.emergencyGoal = goal;
    persist();
    closeSheet();
    refresh();
    toast(goal > 0 ? '비상금 목표 ' + C.formatNumber(goal) + '원으로 저장했어요' : '비상금 목표를 지웠어요');
  }

  /* ---------- notification paste ---------- */

  function openParserDialog() {
    ui.parsed = null;
    $('#parseBody').innerHTML =
      '<h2>알림 문구 붙여넣기</h2>' +
      '<p class="sheet-note">은행·카드·페이 알림을 그대로 붙여넣으면 금액·종류·계좌·메모를 찾아 채워요. 여러 줄을 한 번에 넣으면 전부 저장할 수 있어요.</p>' +
      '<textarea class="sheet-input parse-text" id="parseText" rows="6" placeholder="예) ○○카드 승인 12,000원 스타벅스&#10;○○은행 출금 50,000원 잔액 1,200,000원"></textarea>' +
      '<div id="parsePreview"></div>' +
      '<div class="sheet-actions">' +
        '<button class="btn" data-act="close-sheet">취소</button>' +
        '<button class="btn primary" data-act="parse-run">인식하기</button>' +
      '</div>';
    var dlg = $('#parseDialog');
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { var t = $('#parseText'); if (t) t.focus(); }, 60);
  }

  function describeParse(r) {
    if (!r.ok) return '인식 실패 · ' + (r.reason === 'amount' ? '금액을 찾지 못했어요' : '거래 종류를 알 수 없어요');
    var typeLabel = r.type === 'income' ? '수입' : (r.type === 'transfer' ? '이체' : '지출');
    var where = '';
    if (r.type === 'transfer') {
      var from = C.findAccount(state, r.fromAccountId), to = C.findAccount(state, r.toAccountId);
      where = (from ? from.name : '?') + ' → ' + (to ? to.name : '?');
    } else if (r.methodType === 'card') {
      var card = C.findCard(state, r.cardId);
      where = card ? card.name : '카드';
    } else if (r.methodType === 'account') {
      var acc = C.findAccount(state, r.accountId);
      where = acc ? acc.name : '계좌';
    } else {
      where = '현금';
    }
    var cat = r.categoryId ? C.findCategory(state, r.categoryId, r.type) : null;
    return typeLabel + ' · ' + C.formatNumber(r.amount) + '원 · ' + where +
      (cat ? ' · ' + cat.name : '') + (r.memo ? ' · ' + r.memo : '') + (r.canceled ? ' · 취소 거래?' : '');
  }

  function renderParsePreview(results) {
    var okCount = results.filter(function (r) { return r.ok; }).length;
    var rows = results.map(function (r) {
      return '<li class="parse-row' + (r.ok ? '' : ' bad') + '">' +
        '<span class="parse-mark">' + (r.ok ? '✓' : '!') + '</span>' +
        '<span class="parse-desc">' + esc(describeParse(r)) + '</span>' +
        (r.ok ? '' : '<span class="parse-raw">' + esc(r.raw.slice(0, 40)) + '</span>') +
      '</li>';
    }).join('');
    var html = '<div class="parse-head">' + okCount + '건 인식 · ' + (results.length - okCount) + '건 실패</div>' +
      '<ul class="parse-list">' + rows + '</ul>' +
      '<div class="sheet-actions">' +
        '<button class="btn" data-act="parse-again">다시</button>' +
        (okCount > 1 ? '<button class="btn primary" data-act="parse-save-all">' + okCount + '건 모두 저장</button>'
          : '<button class="btn primary" data-act="parse-fill-one">입력칸에 채우기</button>') +
      '</div>';
    $('#parsePreview').innerHTML = html;
  }

  function runParser() {
    var text = $('#parseText').value || '';
    var lines = text.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return toast('알림 문구를 붙여넣어 주세요');
    var results = lines.map(function (line) { return C.parseNotification(line, state); });
    var okCount = results.filter(function (r) { return r.ok; }).length;
    if (!okCount) {
      ui.parsed = results;
      renderParsePreview(results);
      toast('금액을 찾지 못했어요');
      return;
    }
    if (results.length === 1) {
      fillFormFromParse(results[0]);
      closeSheet();
      return;
    }
    ui.parsed = results;
    renderParsePreview(results);
  }

  function fillFormFromParse(r) {
    ui.type = r.type;
    ui.amount = r.amount;
    ui.exclude = false;
    ui.memo = r.memo || '';
    if (r.type === 'transfer') {
      ui.fromId = r.fromAccountId;
      ui.toId = r.toAccountId;
    } else {
      ui.catId = r.categoryId || (r.type === 'income' ? state.lastIncomeCategoryId : ui.catId);
      ui.methodId = r.methodType === 'card' ? 'card:' + r.cardId
        : (r.methodType === 'account' ? 'account:' + r.accountId : 'cash');
    }
    renderForm();
    if (r.canceled) toast('취소된 거래로 보여요. 확인하고 저장하세요');
    else toast('알림에서 ' + C.formatNumber(r.amount) + '원을 채웠어요');
  }

  function saveParsedAll() {
    var results = (ui.parsed || []).filter(function (r) { return r.ok; });
    if (!results.length) return;
    var added = 0;
    results.forEach(function (r) {
      var catId = r.categoryId;
      if (r.type === 'income' && !C.findCategory(state, catId, 'income')) catId = state.lastIncomeCategoryId || 'inc_etc';
      if (r.type === 'expense' && !C.findCategory(state, catId, 'expense')) catId = C.ETC_CATEGORY_ID;
      var methodId = r.methodType === 'card' ? 'card:' + r.cardId
        : (r.methodType === 'account' ? 'account:' + r.accountId : 'cash');
      state.entries.push(buildEntry({
        type: r.type,
        date: todayKey(),
        amount: r.amount,
        categoryId: catId,
        methodId: methodId,
        fromId: r.fromAccountId,
        toId: r.toAccountId,
        memo: r.memo,
        exclude: false
      }));
      added++;
    });
    persist();
    closeSheet();
    refresh();
    renderForm();
    toast(added + '건을 저장했어요');
  }

  /* ---------- setup / add links ---------- */

  function decodeBase64Url(input) {
    var s = String(input).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function clearHash() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  }

  function readPayload(raw) {
    try {
      var parsed = JSON.parse(decodeBase64Url(raw));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function applySetupFromHash() {
    var hash = location.hash || '';
    var setup = /^#setup=(.+)$/.exec(hash);
    var batch = /^#(?:add|batch)=(.+)$/.exec(hash);
    if (!setup && !batch) return false;

    clearHash();

    if (setup) {
      var payload = readPayload(setup[1]);
      if (!payload) { toast('설정 링크를 읽지 못했어요'); return false; }
      var result = C.applySetup(state, payload);
      persist();
      refresh();
      renderForm();
      setView('settings');
      var parts = [];
      if (result.categories) parts.push('카테고리 ' + result.categories + '개');
      if (result.incomeCategories) parts.push('수입 카테고리 ' + result.incomeCategories + '개');
      if (result.fixedCosts) parts.push('고정비 ' + result.fixedCosts + '개');
      if (result.cards) parts.push('카드 ' + result.cards + '개');
      if (result.accounts) parts.push('계좌 ' + result.accounts + '개');
      if (result.savings) parts.push('적금 ' + result.savings + '개');
      if (result.emergencyGoal) parts.push('비상금 목표');
      toast(parts.length ? parts.join(' · ') + '를 불러왔어요' : '이미 설정되어 있어요.');
      return true;
    }

    var addPayload = readPayload(batch[1]);
    if (!addPayload) { toast('내역 링크를 읽지 못했어요'); return false; }
    var addResult = C.applyEntryBatch(state, addPayload, todayKey());
    persist();
    refresh();
    renderForm();
    if (addResult.added) {
      setView('add');
      toast(addResult.added + '건을 추가했어요' + (addResult.skipped ? ' · 중복 ' + addResult.skipped + '건 건너뜀' : ''));
    } else if (addResult.skipped) {
      toast('이미 넣은 내역이에요');
    } else {
      toast('넣을 내역을 찾지 못했어요');
    }
    return true;
  }

  /* ---------- export / import / reset ---------- */

  function exportData() {
    var payload = C.exportPayload(state);
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'spend-note-' + todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast('백업 파일을 만들었어요');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = null;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
      if (!parsed) return toast('JSON 파일을 읽지 못했어요');
      var check = C.validateBackup(parsed);
      if (!check.ok) return toast(check.error);
      var msg = '지금 기록 ' + state.entries.length + '건을 백업 파일 ' + check.state.entries.length + '건으로 바꿀까요?' +
        (check.dropped ? '\n(읽을 수 없는 ' + check.dropped + '건은 빠져요)' : '');
      if (!window.confirm(msg)) return;
      state = check.state;
      persist();
      refresh();
      renderForm();
      toast('백업을 불러왔어요');
    };
    reader.onerror = function () { toast('파일을 읽지 못했어요'); };
    reader.readAsText(file);
  }

  function resetEntries() {
    if (!state.entries.length) return toast('지울 기록이 없어요');
    if (!window.confirm('지출·수입·이체 기록 ' + state.entries.length + '건을 모두 지울까요? 계좌·카드·고정비 설정은 그대로 남아요. 되돌릴 수 없어요.')) return;
    state.entries = [];
    persist();
    refresh();
    toast('기록을 모두 지웠어요');
  }

  /* ---------- events ---------- */

  function on(act, handler) { actions[act] = handler; }
  var actions = {};

  on('tab', function (el) { setView(el.getAttribute('data-view')); });
  on('pick-type', function (el) {
    var type = el.getAttribute('data-type');
    ui.type = type === 'income' ? 'income' : (type === 'transfer' ? 'transfer' : 'expense');
    if (ui.type === 'income') ui.catId = state.lastIncomeCategoryId || (state.incomeCategories[0] && state.incomeCategories[0].id);
    else if (ui.type === 'expense') ui.catId = state.lastCategoryId;
    ui.exclude = false;
    if (ui.type === 'transfer') {
      var t = defaultTransferIds();
      ui.fromId = t.from;
      ui.toId = t.to;
    }
    renderForm();
  });
  on('add-amount', function (el) {
    setAmount(ui.amount + (+el.getAttribute('data-add') || 0));
    $('#amountInput').focus();
  });
  on('clear-amount', function () { setAmount(0); $('#amountInput').focus(); });
  on('pick-cat', function (el) {
    ui.catId = el.getAttribute('data-cat');
    $$('#catGrid .cat-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-cat') === ui.catId);
    });
  });
  on('pick-method', function (el) {
    ui.methodId = el.getAttribute('data-method');
    renderMethodChips();
    var isCard = ui.methodId.indexOf('card:') === 0;
    $('#excludeRow').hidden = !isCard;
    if (!isCard) { ui.exclude = false; $('#excludeCheck').checked = false; }
  });
  on('pick-from', function (el) {
    ui.fromId = el.getAttribute('data-account');
    if (ui.fromId === ui.toId) {
      var alt = state.accounts.filter(function (a) { return a.id !== ui.fromId; })[0];
      if (alt) ui.toId = alt.id;
    }
    renderTransferChips();
  });
  on('pick-to', function (el) {
    ui.toId = el.getAttribute('data-account');
    if (ui.toId === ui.fromId) {
      var alt = state.accounts.filter(function (a) { return a.id !== ui.toId; })[0];
      if (alt) ui.fromId = alt.id;
    }
    renderTransferChips();
  });
  on('open-parser', openParserDialog);
  on('parse-run', runParser);
  on('parse-again', openParserDialog);
  on('parse-fill-one', function () {
    var first = (ui.parsed || []).filter(function (r) { return r.ok; })[0];
    if (!first) return toast('인식된 내역이 없어요');
    fillFormFromParse(first);
    closeSheet();
  });
  on('parse-save-all', saveParsedAll);
  on('save-main', saveMain);
  on('open-entry', function (el) { openEntryDialog({ id: el.getAttribute('data-id') }); });
  on('add-day', function (el) {
    openEntryDialog({ date: ui.selectedDay, type: el.getAttribute('data-type') });
  });

  on('cal-prev', function () {
    ui.calMonth = C.addMonths(ui.calMonth, -1);
    if (!ui.selectedDay || C.monthKeyOf(ui.selectedDay) !== ui.calMonth) {
      ui.selectedDay = ui.calMonth === currentMonth() ? todayKey() : ui.calMonth + '-01';
    }
    renderCalendar();
    renderDayPanel();
  });
  on('cal-next', function () {
    ui.calMonth = C.addMonths(ui.calMonth, 1);
    ui.selectedDay = ui.calMonth === currentMonth() ? todayKey() : ui.calMonth + '-01';
    renderCalendar();
    renderDayPanel();
  });
  on('cal-today', function () {
    ui.calMonth = currentMonth();
    ui.selectedDay = todayKey();
    renderCalendar();
    renderDayPanel();
  });
  on('pick-day', function (el) {
    ui.selectedDay = el.getAttribute('data-day');
    if (C.monthKeyOf(ui.selectedDay) !== ui.calMonth) ui.calMonth = C.monthKeyOf(ui.selectedDay);
    renderCalendar();
    renderDayPanel();
    var panel = $('#dayPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  on('sum-prev', function () { ui.sumMonth = C.addMonths(ui.sumMonth, -1); renderSummary(); });
  on('sum-next', function () { ui.sumMonth = C.addMonths(ui.sumMonth, 1); renderSummary(); });

  on('sheet-type', function (el) {
    var s = ui.sheet;
    if (!s) return;
    var type = el.getAttribute('data-type');
    s.type = type === 'income' ? 'income' : (type === 'transfer' ? 'transfer' : 'expense');
    if (s.type === 'transfer') {
      var t = defaultTransferIds();
      s.fromId = t.from;
      s.toId = t.to;
    } else {
      s.catId = s.type === 'income' ? (state.lastIncomeCategoryId || state.incomeCategories[0].id) : null;
      s.methodId = defaultMethodId(s.type);
    }
    s.exclude = false;
    renderEntrySheet();
  });
  on('sheet-cat', function (el) {
    if (!ui.sheet) return;
    ui.sheet.catId = el.getAttribute('data-cat');
    $$('#shCats .cat-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-cat') === ui.sheet.catId);
    });
  });
  on('sheet-method', function (el) {
    if (!ui.sheet) return;
    ui.sheet.methodId = el.getAttribute('data-method');
    renderEntrySheet();
  });
  on('sheet-from', function (el) {
    if (!ui.sheet) return;
    ui.sheet.fromId = el.getAttribute('data-account');
    if (ui.sheet.fromId === ui.sheet.toId) {
      var alt = state.accounts.filter(function (a) { return a.id !== ui.sheet.fromId; })[0];
      if (alt) ui.sheet.toId = alt.id;
    }
    renderEntrySheet();
  });
  on('sheet-to', function (el) {
    if (!ui.sheet) return;
    ui.sheet.toId = el.getAttribute('data-account');
    if (ui.sheet.toId === ui.sheet.fromId) {
      var alt = state.accounts.filter(function (a) { return a.id !== ui.sheet.toId; })[0];
      if (alt) ui.sheet.fromId = alt.id;
    }
    renderEntrySheet();
  });
  on('save-entry', saveSheetEntry);
  on('delete-entry', deleteSheetEntry);
  on('close-sheet', closeSheet);

  on('add-account', function (el) { openAccountDialog(null, el.getAttribute('data-kind')); });
  on('edit-account', function (el) { openAccountDialog(C.findAccount(state, el.getAttribute('data-id'))); });
  on('del-account', function (el) {
    ui.item = { mode: 'account', id: el.getAttribute('data-id') };
    deleteAccount();
  });
  on('account-save', saveAccount);
  on('account-delete', deleteAccount);

  on('edit-goal', openGoalDialog);
  on('goal-save', saveGoal);

  on('add-card', function () {
    openCardDialog(null);
  });
  on('edit-card', function (el) { openCardDialog(C.findCard(state, el.getAttribute('data-id'))); });
  on('del-card', function (el) {
    var id = el.getAttribute('data-id');
    var card = C.findCard(state, id);
    if (!card) return;
    var used = state.entries.filter(function (e) { return e.cardId === id; }).length;
    var msg = '‘' + card.name + '’ 카드를 지울까요?' +
      (used ? '\n이 카드로 기록한 ' + used + '건은 그대로 남고 이름만 표시돼요.' : '');
    if (!window.confirm(msg)) return;
    state.cards = state.cards.filter(function (c) { return c.id !== id; });
    persist();
    refresh();
    renderForm();
    toast('카드를 지웠어요');
  });

  on('add-fixed', function () {
    openItemDialog({
      title: '고정비 추가',
      nameLabel: '항목 이름',
      namePlaceholder: '예: 월세, 통신비, 보험료',
      amountLabel: '한 달 금액 (원)',
      amount: 0,
      note: '매달 거의 같은 금액이 나가는 항목을 적어 두세요. 여유 돈과 주간 필요 수입 계산에 쓰여요.',
      requireAmount: true,
      onSave: function (name, amount) {
        state.fixedCosts.push({ id: C.createId('fx'), name: name, amount: amount });
      }
    });
  });
  on('edit-fixed', function (el) {
    var item = null;
    var id = el.getAttribute('data-id');
    for (var i = 0; i < state.fixedCosts.length; i++) if (state.fixedCosts[i].id === id) item = state.fixedCosts[i];
    if (!item) return;
    openItemDialog({
      title: '고정비 수정',
      nameLabel: '항목 이름',
      amountLabel: '한 달 금액 (원)',
      name: item.name,
      amount: item.amount,
      requireAmount: true,
      deleteAct: true,
      id: id,
      onSave: function (name, amount) { item.name = name; item.amount = amount; }
    });
  });
  on('del-fixed', function (el) {
    var id = el.getAttribute('data-id');
    var item = null;
    for (var i = 0; i < state.fixedCosts.length; i++) if (state.fixedCosts[i].id === id) item = state.fixedCosts[i];
    if (!item) return;
    if (!window.confirm('‘' + item.name + '’ 고정비를 지울까요?')) return;
    state.fixedCosts = state.fixedCosts.filter(function (f) { return f.id !== id; });
    persist();
    refresh();
    toast('고정비를 지웠어요');
  });

  on('add-cat', function () {
    openItemDialog({
      title: '카테고리 추가',
      nameLabel: '카테고리 이름',
      namePlaceholder: '예: 반려동물, 교육',
      showAmount: false,
      onSave: function (name) {
        state.categories.push({ id: C.createId('cat'), name: name, emoji: '🏷️' });
      }
    });
  });
  on('edit-cat', function (el) {
    var id = el.getAttribute('data-id');
    var cat = C.findCategory(state, id, 'expense');
    if (!cat) return;
    openItemDialog({
      title: '카테고리 수정',
      nameLabel: '카테고리 이름',
      name: cat.name,
      showAmount: false,
      deleteAct: cat.id !== C.ETC_CATEGORY_ID,
      id: id,
      onSave: function (name) { cat.name = name; }
    });
  });
  on('del-cat', function (el) {
    var id = el.getAttribute('data-id');
    if (id === C.ETC_CATEGORY_ID) return;
    var cat = C.findCategory(state, id, 'expense');
    if (!cat) return;
    var used = state.entries.filter(function (e) { return e.type !== 'income' && e.categoryId === id; }).length;
    var msg = '‘' + cat.name + '’ 카테고리를 지울까요?' +
      (used ? '\n이 카테고리의 ' + used + '건은 ‘기타’로 옮겨요.' : '');
    if (!window.confirm(msg)) return;
    state.entries.forEach(function (e) {
      if (e.type !== 'income' && e.categoryId === id) e.categoryId = C.ETC_CATEGORY_ID;
    });
    state.categories = state.categories.filter(function (c) { return c.id !== id; });
    persist();
    refresh();
    renderForm();
    toast('카테고리를 지웠어요');
  });

  on('add-income-cat', function () {
    openItemDialog({
      title: '수입 카테고리 추가',
      nameLabel: '카테고리 이름',
      namePlaceholder: '예: 온라인 수입, 급여',
      showAmount: false,
      onSave: function (name) {
        state.incomeCategories.push({ id: C.createId('icat'), name: name, emoji: '🏷️' });
      }
    });
  });
  on('edit-income-cat', function (el) {
    var id = el.getAttribute('data-id');
    var cat = C.findCategory(state, id, 'income');
    if (!cat) return;
    openItemDialog({
      title: '수입 카테고리 수정',
      nameLabel: '카테고리 이름',
      name: cat.name,
      showAmount: false,
      deleteAct: cat.id !== C.ETC_INCOME_CATEGORY_ID,
      id: id,
      onSave: function (name) { cat.name = name; }
    });
  });
  on('del-income-cat', function (el) {
    var id = el.getAttribute('data-id');
    if (id === C.ETC_INCOME_CATEGORY_ID) return;
    var cat = C.findCategory(state, id, 'income');
    if (!cat) return;
    var used = state.entries.filter(function (e) { return e.type === 'income' && e.categoryId === id; }).length;
    if (!window.confirm('‘' + cat.name + '’ 카테고리를 지울까요?' + (used ? '\n이 카테고리의 ' + used + '건은 ‘기타 수입’으로 옮겨요.' : ''))) return;
    state.entries.forEach(function (e) {
      if (e.type === 'income' && e.categoryId === id) e.categoryId = C.ETC_INCOME_CATEGORY_ID;
    });
    state.incomeCategories = state.incomeCategories.filter(function (c) { return c.id !== id; });
    persist();
    refresh();
    renderForm();
    toast('카테고리를 지웠어요');
  });

  on('item-save', saveItem);
  on('item-delete', function () {
    var cfg = ui.item;
    if (!cfg || !cfg.deleteAct) return;
    cfg.onDelete ? cfg.onDelete() : null;
    closeSheet();
    refresh();
  });

  on('export', exportData);
  on('reset', resetEntries);
  on('install', function () {
    var p = ui.installPrompt;
    if (!p) return toast('브라우저 메뉴에서 ‘홈 화면에 추가’를 눌러 주세요');
    p.prompt();
    p.userChoice.then(function () { ui.installPrompt = null; $('#installBtn').hidden = true; });
  });

  function openCardDialog(card) {
    var editing = !!card;
    ui.item = { mode: 'card', id: card ? card.id : '' };
    var accountOptions = state.accounts.map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (card && card.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
    $('#itemBody').innerHTML =
      '<h2>' + (editing ? '카드 수정' : '카드 추가') + '</h2>' +
      '<label class="sheet-label">카드 이름</label>' +
      '<input class="sheet-input" type="text" id="cdName" maxlength="20" placeholder="예: ○○카드" value="' + esc(card ? card.name : '') + '">' +
      '<label class="sheet-label">목표 실적 (한 달, 원)</label>' +
      '<input class="sheet-input" type="text" inputmode="numeric" id="cdGoal" placeholder="0" value="' + (card && card.goal ? C.formatNumber(card.goal) : '') + '">' +
      '<label class="sheet-label">카드 종류</label>' +
      '<select class="sheet-input" id="cdCredit">' +
        '<option value="credit"' + (!card || card.credit !== false ? ' selected' : '') + '>신용카드 (잔액 차감 없음, 실적만)</option>' +
        '<option value="check"' + (card && card.credit === false ? ' selected' : '') + '>체크카드 (연결 계좌에서 바로 출금)</option>' +
      '</select>' +
      '<div id="cdAccountWrap">' +
        '<label class="sheet-label">출금 계좌</label>' +
        '<select class="sheet-input" id="cdAccount">' +
          '<option value="">연결 안 함</option>' + accountOptions +
        '</select>' +
      '</div>' +
      '<p class="sheet-note">목표 실적이 0이면 진행률 없이 사용액만 보여드려요.</p>' +
      '<div class="sheet-actions">' +
        (editing ? '<button class="btn danger" data-act="card-delete">삭제</button>' : '<button class="btn" data-act="close-sheet">취소</button>') +
        '<button class="btn primary" data-act="card-save">저장</button>' +
      '</div>';

    var goalEl = $('#cdGoal');
    goalEl.addEventListener('input', function () {
      var formatted = C.sanitizeAmountInput(goalEl.value);
      if (formatted !== goalEl.value) goalEl.value = formatted;
    });
    function syncType() {
      $('#cdAccountWrap').hidden = $('#cdCredit').value !== 'check';
    }
    $('#cdCredit').addEventListener('change', syncType);
    syncType();

    var dlg = $('#itemDialog');
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { $('#cdName').focus(); }, 60);
  }

  function saveCard() {
    var cfg = ui.item;
    if (!cfg || cfg.mode !== 'card') return;
    var name = ($('#cdName').value || '').replace(/\s+/g, ' ').trim();
    if (!name) return toast('카드 이름을 입력해 주세요');
    var goal = C.parseAmount($('#cdGoal').value);
    var credit = $('#cdCredit').value !== 'check';
    var accountId = credit ? '' : ($('#cdAccount').value || '');
    if (!credit && !accountId) return toast('체크카드는 출금 계좌를 골라 주세요');

    var card = cfg.id ? C.findCard(state, cfg.id) : null;
    if (card) {
      card.name = name;
      card.goal = goal;
      card.credit = credit;
      card.accountId = accountId;
    } else {
      state.cards.push({ id: C.createId('card'), name: name, goal: goal, credit: credit, accountId: accountId });
    }
    persist();
    closeSheet();
    refresh();
    renderForm();
    toast('저장했어요');
  }

  on('card-save', saveCard);
  on('card-delete', function () {
    var cfg = ui.item;
    if (!cfg || cfg.mode !== 'card' || !cfg.id) return;
    var card = C.findCard(state, cfg.id);
    if (!card) return;
    var used = state.entries.filter(function (e) { return e.cardId === card.id; }).length;
    if (!window.confirm('‘' + card.name + '’ 카드를 지울까요?' + (used ? '\n이 카드로 기록한 ' + used + '건은 그대로 남고 이름만 표시돼요.' : ''))) return;
    state.cards = state.cards.filter(function (c) { return c.id !== card.id; });
    persist();
    closeSheet();
    refresh();
    renderForm();
    toast('카드를 지웠어요');
  });

  function bindEvents() {
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      var fn = actions[act];
      if (fn) {
        ev.preventDefault();
        fn(el, ev);
      }
    });

    $('#amountInput').addEventListener('input', function (ev) {
      var formatted = C.sanitizeAmountInput(ev.target.value);
      if (formatted !== ev.target.value) ev.target.value = formatted;
      ui.amount = C.parseAmount(formatted);
      $('#clearAmount').hidden = !ui.amount;
      var quick = $('#quickChips');
      var clearChip = quick.querySelector('[data-act="clear-amount"]');
      if (ui.amount && !clearChip) quick.insertAdjacentHTML('beforeend', '<button class="chip" data-act="clear-amount">지우기</button>');
      if (!ui.amount && clearChip) clearChip.remove();
    });

    $('#amountInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveMain(); }
    });

    $('#excludeCheck').addEventListener('change', function (ev) { ui.exclude = ev.target.checked; });
    $('#memoInput').addEventListener('input', function (ev) { ui.memo = ev.target.value; });

    $('#importFile').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (file) importData(file);
      ev.target.value = '';
    });

    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      ui.installPrompt = ev;
      $('#installBtn').hidden = false;
    });

    window.addEventListener('hashchange', function () { applySetupFromHash(); });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkDayChange();
    });

    setInterval(checkDayChange, 30000);
  }

  var lastKnownDay = todayKey();
  function checkDayChange() {
    var now = todayKey();
    if (now === lastKnownDay) return;
    lastKnownDay = now;
    renderCalendar();
    renderToday();
    renderHero();
    $('#todayLabel').textContent = dateLabel(now);
  }

  /* ---------- service worker ---------- */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline install is optional */ });
    });
  }

  /* ---------- init ---------- */

  function init() {
    bindEvents();
    $('#todayLabel').textContent = dateLabel(todayKey());
    ensureSelection();
    renderForm();
    refresh();
    applySetupFromHash();
    registerSW();
  }

  init();
})();
