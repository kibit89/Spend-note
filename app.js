/* Spend Note — app shell, rendering, storage */
(function () {
  'use strict';

  var C = window.SpendCore;
  var STORE_KEY = 'spend-note:v2';
  var VERSION_LABEL = 'v1';

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
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + C.formatNumber(Math.abs(n)); }
  function dateLabel(key) {
    var d = C.parseDateKey(key);
    if (!d) return key;
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + C.weekdayLabels()[d.getDay()] + ')';
  }

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
    exclude: false,
    calMonth: currentMonth(),
    selectedDay: todayKey(),
    sumMonth: currentMonth(),
    sheet: null,
    item: null,
    installPrompt: null
  };

  function defaultMethodId() {
    var card = state.cards[0];
    return card ? 'card:' + card.id : 'cash';
  }

  function ensureSelection() {
    if (ui.type === 'income') {
      var incIds = state.incomeCategories.map(function (c) { return c.id; });
      if (!ui.catId || incIds.indexOf(ui.catId) === -1) {
        ui.catId = incIds.indexOf(state.lastIncomeCategoryId) >= 0 ? state.lastIncomeCategoryId : incIds[0];
      }
    } else {
      var ids = state.categories.map(function (c) { return c.id; });
      if (ui.catId && ids.indexOf(ui.catId) === -1) ui.catId = null;
    }
    var valid = state.cards.some(function (c) { return 'card:' + c.id === ui.methodId; });
    if (!valid && ui.methodId !== 'cash' && ui.methodId !== 'transfer') ui.methodId = defaultMethodId();
  }

  /* ---------- entry construction ---------- */

  function methodParts(type, methodId) {
    if (type === 'income') return { methodType: 'transfer', cardId: '', methodLabel: '입금' };
    if (methodId === 'cash') return { methodType: 'cash', cardId: '', methodLabel: '현금' };
    if (methodId === 'transfer') return { methodType: 'transfer', cardId: '', methodLabel: '이체' };
    if (methodId && methodId.indexOf('card:') === 0) {
      var card = C.findCard(state, methodId.slice(5));
      return {
        methodType: 'card',
        cardId: methodId.slice(5),
        methodLabel: card ? card.name : ''
      };
    }
    return { methodType: 'cash', cardId: '', methodLabel: '현금' };
  }

  function buildEntry(fields) {
    var m = methodParts(fields.type, fields.methodId);
    return {
      id: C.createId('e'),
      type: fields.type,
      date: fields.date,
      amount: fields.amount,
      categoryId: fields.categoryId,
      methodType: m.methodType,
      cardId: m.cardId,
      methodLabel: m.methodLabel,
      memo: (fields.memo || '').slice(0, 60),
      excludePerf: fields.type === 'expense' ? !!fields.exclude : false,
      createdAt: nowIso(),
      updatedAt: ''
    };
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
          '<span class="gauge-name">' + esc(s.name) + (s.done ? ' <span class="gauge-check">✓ 달성</span>' : '') + '</span>' +
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
    $('#saveMain').textContent = ui.type === 'income' ? '수입 저장' : '저장';

    var quick = ui.type === 'income' ? QUICK_INCOME : QUICK_EXPENSE;
    $('#quickChips').innerHTML = quick.map(function (n) {
      return '<button class="chip" data-act="add-amount" data-add="' + n + '">+' + C.formatNumber(n) + '</button>';
    }).join('') + (ui.amount ? '<button class="chip" data-act="clear-amount">지우기</button>' : '');

    var cats = ui.type === 'income' ? state.incomeCategories : state.categories;
    var selected = ui.type === 'income'
      ? (ui.catId || state.lastIncomeCategoryId)
      : ui.catId;
    $('#catGrid').innerHTML = cats.map(function (c) {
      return '<button class="cat-btn' + (c.id === selected ? ' is-on' : '') + '" data-act="pick-cat" data-cat="' + esc(c.id) + '">' +
        '<span class="cat-emoji">' + esc(c.emoji) + '</span>' +
        '<span class="cat-name">' + esc(c.name) + '</span></button>';
    }).join('');

    $('#methodWrap').hidden = ui.type === 'income';
    renderMethodChips();

    var isCard = ui.type === 'expense' && ui.methodId && ui.methodId.indexOf('card:') === 0;
    $('#excludeRow').hidden = !isCard;
    $('#excludeCheck').checked = !!ui.exclude;
  }

  function renderMethodChips() {
    var parts = state.cards.map(function (c) {
      return { id: 'card:' + c.id, label: c.name };
    });
    parts.push({ id: 'cash', label: '현금' });
    parts.push({ id: 'transfer', label: '이체' });

    if (!ui.methodId || !parts.some(function (p) { return p.id === ui.methodId; })) ui.methodId = defaultMethodId();

    $('#methodChips').innerHTML = parts.map(function (p) {
      return '<button class="method-chip' + (p.id === ui.methodId ? ' is-on' : '') + '" data-act="pick-method" data-method="' + esc(p.id) + '">' +
        esc(p.label) + '</button>';
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

  function saveMain() {
    var amount = C.parseAmount($('#amountInput').value);
    ui.amount = amount;
    if (!amount) {
      toast('금액을 입력해 주세요');
      $('#amountInput').focus();
      return;
    }
    var catId;
    if (ui.type === 'income') {
      catId = C.findCategory(state, ui.catId || state.lastIncomeCategoryId, 'income') ? (ui.catId || state.lastIncomeCategoryId) : state.incomeCategories[0].id;
    } else {
      catId = ui.catId;
      if (!catId) {
        toast('카테고리를 골라 주세요');
        return;
      }
    }

    var entry = buildEntry({
      type: ui.type,
      date: todayKey(),
      amount: amount,
      categoryId: catId,
      methodId: ui.methodId,
      memo: $('#memoInput').value,
      exclude: $('#excludeCheck').checked
    });
    state.entries.push(entry);
    if (ui.type === 'income') state.lastIncomeCategoryId = catId;
    else state.lastCategoryId = catId;

    persist();

    var label = C.findCategory(state, catId, ui.type);
    toast((ui.type === 'income' ? '수입' : (label ? label.name : '지출')) + ' ' + C.formatNumber(amount) + '원 저장했어요');

    ui.amount = 0;
    ui.exclude = false;
    $('#excludeCheck').checked = false;
    $('#memoInput').value = '';

    refresh();
    renderForm();
    $('#amountInput').focus();
  }

  /* ---------- today list ---------- */

  function entryRow(entry, opts) {
    var isIncome = entry.type === 'income';
    var memoBits = [];
    if (isIncome) memoBits.push('수입');
    else memoBits.push(esc(C.methodName(state, entry)));
    if (entry.memo) memoBits.push(esc(entry.memo));
    if (entry.excludePerf) memoBits.push('실적 제외');
    var meta = memoBits.join(' · ');
    return '<li><button class="entry" data-act="open-entry" data-id="' + esc(entry.id) + '">' +
      '<span class="entry-emoji">' + esc(C.categoryEmoji(state, entry)) + '</span>' +
      '<span class="entry-main">' +
        '<span class="entry-cat">' + esc(C.categoryName(state, entry)) + '</span>' +
        (meta ? '<span class="entry-meta"' + (isIncome ? ' style="color:var(--green)"' : '') + '>' + meta + '</span>' : '') +
      '</span>' +
      '<span class="entry-amt' + (isIncome ? ' income' : '') + '"><span class="sign">' + (isIncome ? '+' : '') + '</span>' + C.formatNumber(entry.amount) + '원</span>' +
    '</button></li>';
  }

  function renderToday() {
    var today = todayKey();
    var list = C.entriesOnDay(state.entries, today);
    var expense = C.sumAmounts(C.entriesOfType(list, 'expense'));
    var income = C.sumAmounts(C.entriesOfType(list, 'income'));

    $('#todayTitle').textContent = '오늘 · ' + dateLabel(today);
    $('#todayTotal').textContent = '지출 ' + C.formatNumber(expense) + '원' + (income ? ' · 수입 ' + C.formatNumber(income) + '원' : '');
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
    var cells = C.monthGrid(mk, today);

    $('#calGrid').innerHTML = cells.map(function (cell) {
      var cls = 'cal-cell' + (cell.inMonth ? '' : ' out') + (cell.isToday ? ' is-today' : '') + (cell.key === ui.selectedDay ? ' is-on' : '');
      var amt = cell.inMonth ? C.compactWon(totals[cell.key] || 0) : '';
      return '<button class="' + cls + '" data-act="pick-day" data-day="' + cell.key + '">' +
        (incomes[cell.key] ? '<span class="income-dot"></span>' : '') +
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

    var html = '<div class="card day-panel">' +
      '<div class="day-head"><span class="day-title">' + dateLabel(day) + '</span>' +
      '<span class="day-sub">' + (list.length ? '지출 ' + C.formatNumber(expense) + '원' + (income ? ' · 수입 ' + C.formatNumber(income) + '원' : '') : '기록 없음') + '</span></div>' +
      '<ul class="entry-list">' + (list.length
        ? list.map(function (e) { return entryRow(e); }).join('')
        : '<li class="empty">이 날은 기록이 없어요.</li>') + '</ul>' +
      '<div class="day-actions">' +
        '<button class="btn" data-act="add-day" data-type="expense">+ 지출 추가</button>' +
        '<button class="btn" data-act="add-day" data-type="income">+ 수입 추가</button>' +
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

  function renderSummary() {
    var mk = ui.sumMonth;
    var summary = C.monthSummary(state, mk, todayKey());
    var flow = summary.flow;

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
      '</div>';

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
        barRow('현금', '💵', summary.methods.cash, summary.total ? summary.methods.cash / summary.total : 0) +
        barRow('이체', '🏦', summary.methods.transfer, summary.total ? summary.methods.transfer / summary.total : 0) +
      '</div>' +
      (summary.excluded ? '<p class="fine">카드 실적 제외 ' + C.formatNumber(summary.excluded) + '원은 지출 합계에는 들어가고 실적 게이지에서는 빠져요.</p>' : '');
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
          return itemRow({
            id: c.id,
            name: esc(c.name),
            sub: c.goal > 0 ? '목표 실적' : '목표 미설정',
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
      var e = C.findEntry ? C.findEntry(state, entryOrOpts.id) : state.entries.filter(function (x) { return x.id === entryOrOpts.id; })[0];
      if (!e) return toast('내역을 찾지 못했어요');
      ui.sheet = {
        mode: 'edit',
        id: e.id,
        date: e.date,
        type: e.type,
        amount: e.amount,
        catId: e.categoryId,
        methodId: e.methodType === 'card' ? 'card:' + e.cardId : e.methodType,
        memo: e.memo || '',
        exclude: !!e.excludePerf
      };
    } else {
      var opts = entryOrOpts || {};
      var type = opts.type === 'income' ? 'income' : 'expense';
      ui.sheet = {
        mode: 'add',
        id: null,
        date: opts.date || todayKey(),
        type: type,
        amount: opts.amount || 0,
        catId: type === 'income' ? (state.lastIncomeCategoryId || 'inc_online') : null,
        methodId: defaultMethodId(),
        memo: '',
        exclude: false
      };
    }
    renderEntrySheet();
    var dlg = $('#entryDialog');
    if (!dlg.open) dlg.showModal();
  }

  function renderEntrySheet() {
    var s = ui.sheet;
    if (!s) return;
    var isIncome = s.type === 'income';
    var cats = isIncome ? state.incomeCategories : state.categories;
    var methods = state.cards.map(function (c) { return { id: 'card:' + c.id, label: c.name }; })
      .concat([{ id: 'cash', label: '현금' }, { id: 'transfer', label: '이체' }]);
    if (!methods.some(function (m) { return m.id === s.methodId; })) s.methodId = defaultMethodId();

    var html = '<h2>' + (s.mode === 'edit' ? '내역 수정' : (isIncome ? '수입 추가' : '지출 추가')) + '</h2>' +
      '<div class="type-toggle">' +
        '<button class="type-btn' + (!isIncome ? ' is-on' : '') + '" data-act="sheet-type" data-type="expense">지출</button>' +
        '<button class="type-btn' + (isIncome ? ' is-on' : '') + '" data-act="sheet-type" data-type="income">수입</button>' +
      '</div>' +
      '<label class="sheet-label">날짜</label>' +
      '<input class="sheet-input" type="date" id="shDate" value="' + esc(s.date) + '">' +
      '<label class="sheet-label">금액</label>' +
      '<input class="sheet-input" type="text" inputmode="numeric" id="shAmount" placeholder="0" value="' + (s.amount ? C.formatNumber(s.amount) : '') + '">' +
      '<label class="sheet-label">카테고리</label>' +
      '<div class="cat-grid" id="shCats">' + cats.map(function (c) {
        return '<button class="cat-btn' + (c.id === s.catId ? ' is-on' : '') + '" data-act="sheet-cat" data-cat="' + esc(c.id) + '">' +
          '<span class="cat-emoji">' + esc(c.emoji) + '</span><span class="cat-name">' + esc(c.name) + '</span></button>';
      }).join('') + '</div>' +
      (isIncome ? '' :
        '<label class="sheet-label">결제 수단</label>' +
        '<div class="method-scroll" id="shMethods">' + methods.map(function (m) {
          return '<button class="method-chip' + (m.id === s.methodId ? ' is-on' : '') + '" data-act="sheet-method" data-method="' + esc(m.id) + '">' + esc(m.label) + '</button>';
        }).join('') + '</div>') +
      '<label class="sheet-label">메모 (선택)</label>' +
      '<input class="sheet-input" type="text" id="shMemo" maxlength="60" placeholder="예: 점심, 관리비" value="' + esc(s.memo) + '">' +
      (!isIncome && s.methodId.indexOf('card:') === 0
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

    var catId = s.catId;
    if (!C.findCategory(state, catId, s.type)) {
      catId = s.type === 'income' ? state.incomeCategories[0].id : null;
    }
    if (!catId) return toast('카테고리를 골라 주세요');

    var m = methodParts(s.type, s.methodId);
    var fields = {
      type: s.type,
      date: date,
      amount: amount,
      categoryId: catId,
      methodType: m.methodType,
      cardId: m.cardId,
      methodLabel: m.methodLabel,
      memo: $('#shMemo').value,
      excludePerf: s.type === 'expense' && !!(($('#shExclude') || {}).checked)
    };

    if (s.mode === 'edit') {
      var target = null;
      for (var i = 0; i < state.entries.length; i++) {
        if (state.entries[i].id === s.id) { target = state.entries[i]; break; }
      }
      if (!target) { closeSheet(); return toast('내역을 찾지 못했어요'); }
      Object.keys(fields).forEach(function (k) { target[k] = fields[k]; });
      target.updatedAt = nowIso();
      toast('수정했어요');
    } else {
      state.entries.push({
        id: C.createId('e'),
        type: fields.type,
        date: fields.date,
        amount: fields.amount,
        categoryId: fields.categoryId,
        methodType: fields.methodType,
        cardId: fields.cardId,
        methodLabel: fields.methodLabel,
        memo: fields.memo,
        excludePerf: fields.excludePerf,
        createdAt: nowIso(),
        updatedAt: ''
      });
      if (s.type === 'income') state.lastIncomeCategoryId = catId;
      else state.lastCategoryId = catId;
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
    [$('#entryDialog'), $('#itemDialog')].forEach(function (d) { if (d && d.open) d.close(); });
    ui.sheet = null;
    ui.item = null;
  }

  /* ---------- item (card / fixed / category) dialog ---------- */

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

  /* ---------- setup link ---------- */

  function decodeBase64Url(input) {
    var s = String(input).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function applySetupFromHash() {
    var hash = location.hash || '';
    var match = /^#setup=(.+)$/.exec(hash);
    if (!match) return false;

    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }

    var payload = null;
    try { payload = JSON.parse(decodeBase64Url(match[1])); } catch (e) { payload = null; }
    if (!payload) {
      toast('설정 링크를 읽지 못했어요');
      return false;
    }
    var result = C.applySetup(state, payload);
    persist();
    refresh();
    renderForm();
    setView('settings');
    var parts = [];
    if (result.categories) parts.push('카테고리 ' + result.categories + '개');
    if (result.fixedCosts) parts.push('고정비 ' + result.fixedCosts + '개');
    if (result.cards) parts.push('카드 ' + result.cards + '개');
    toast(parts.length ? parts.join(' · ') + '를 불러왔어요' : '이미 설정되어 있어요.');
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
    if (!window.confirm('지출·수입 기록 ' + state.entries.length + '건을 모두 지울까요? 카드·고정비 설정은 그대로 남아요. 되돌릴 수 없어요.')) return;
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
    var type = el.getAttribute('data-type') === 'income' ? 'income' : 'expense';
    ui.type = type;
    ui.catId = type === 'income' ? (state.lastIncomeCategoryId || state.incomeCategories[0].id) : state.lastCategoryId;
    ui.exclude = false;
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
    s.type = el.getAttribute('data-type') === 'income' ? 'income' : 'expense';
    s.catId = s.type === 'income' ? (state.lastIncomeCategoryId || state.incomeCategories[0].id) : null;
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
  on('save-entry', saveSheetEntry);
  on('delete-entry', deleteSheetEntry);
  on('close-sheet', closeSheet);

  on('add-card', function () {
    openItemDialog({
      title: '카드 추가',
      nameLabel: '카드 이름',
      namePlaceholder: '예: 현대카드, 신한카드',
      amountLabel: '목표 실적 (한 달, 원)',
      amount: 300000,
      note: '목표 실적은 카드사 실적 기준 금액이에요. 0으로 두면 진행률 없이 사용액만 보여드려요.',
      onSave: function (name, amount) {
        state.cards.push({ id: C.createId('card'), name: name, goal: amount });
      }
    });
  });
  on('edit-card', function (el) {
    var card = C.findCard(state, el.getAttribute('data-id'));
    if (!card) return;
    openItemDialog({
      title: '카드 수정',
      nameLabel: '카드 이름',
      amountLabel: '목표 실적 (한 달, 원)',
      name: card.name,
      amount: card.goal,
      onSave: function (name, amount) { card.name = name; card.goal = amount; }
    });
  });
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
      namePlaceholder: '예: 관리비, 통신비, 보험료',
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
    var msg = '‘' + cat.name + '’ 카테고리를 지울까요?' +
      (used ? '\n이 카테고리의 ' + used + '건은 ‘기타 수입’으로 옮겨요.' : '');
    if (!window.confirm(msg)) return;
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
      if (!ui.amount && clearChip && !clearChip.classList.contains('x')) clearChip.remove();
    });

    $('#amountInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveMain(); }
    });

    $('#excludeCheck').addEventListener('change', function (ev) { ui.exclude = ev.target.checked; });
    $('#memoInput').addEventListener('input', function (ev) { /* value read at save */ });

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
    if (ui.selectedDay !== lastKnownDay) {
      // keep an explicitly chosen day, but follow "today" if it was yesterday's today
    }
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
