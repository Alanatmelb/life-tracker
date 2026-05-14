/* Life Tracker — pure-frontend habit/checkin PWA */
(() => {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'lifetracker:v1';
  const SCHEMA_VERSION = 1;
  const CHECKIN_DONE = 'done';
  const CHECKIN_MISSED = 'missed';

  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const pad2 = (n) => String(n).padStart(2, '0');

  /** Format a Date as local YYYY-MM-DD (NOT UTC). */
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /** Parse a YYYY-MM-DD into a local Date at midnight. */
  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const todayStr = () => fmtDate(new Date());

  const addDays = (dateStr, n) => {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return fmtDate(d);
  };

  const weekdayOf = (dateStr) => parseDate(dateStr).getDay(); // 0=Sun .. 6=Sat

  const uid = (prefix = 't') => prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

  // ---------- State (data layer) ----------
  /** Default state shape. */
  const defaultState = () => ({
    version: SCHEMA_VERSION,
    tasks: [],
    checkins: {}, // { "YYYY-MM-DD": { taskId: "done" | "missed" } }
    goalPeriods: [],
  });

  /** Load and migrate state from localStorage. Falls back to default on any failure. */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaultState();
      // Minimal forward-compatible normalisation.
      return {
        version: parsed.version || SCHEMA_VERSION,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        checkins: parsed.checkins && typeof parsed.checkins === 'object' ? parsed.checkins : {},
        goalPeriods: Array.isArray(parsed.goalPeriods) ? parsed.goalPeriods : [],
      };
    } catch (err) {
      console.error('loadState failed', err);
      return defaultState();
    }
  }

  function saveState(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (err) {
      console.error('saveState failed', err);
      toast('保存失败：存储空间可能已满');
    }
  }

  let state = loadState();

  // ---------- Mutations ----------
  function addTask(input) {
    const task = {
      id: uid(),
      title: input.title.trim(),
      note: (input.note || '').trim(),
      time: input.time || '',
      schedule: input.schedule,
      createdAt: new Date().toISOString(),
      archived: false,
    };
    state.tasks.push(task);
    saveState(state);
    return task;
  }

  function updateTask(id, patch) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    saveState(state);
    return t;
  }

  function archiveTask(id) {
    return updateTask(id, { archived: true });
  }

  function unarchiveTask(id) {
    return updateTask(id, { archived: false });
  }

  /** Permanently delete a task and ALL its check-in history.
   *  Only meant to be called for archived tasks (UI enforces this). */
  function deleteTaskPermanently(id) {
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    state.tasks.splice(idx, 1);
    Object.keys(state.checkins).forEach((dateStr) => {
      const day = state.checkins[dateStr];
      if (day && Object.prototype.hasOwnProperty.call(day, id)) {
        delete day[id];
        if (Object.keys(day).length === 0) delete state.checkins[dateStr];
      }
    });
    saveState(state);
    return true;
  }

  function setCheckin(dateStr, taskId, status) {
    if (!state.checkins[dateStr]) state.checkins[dateStr] = {};
    if (status === null || status === undefined) {
      delete state.checkins[dateStr][taskId];
      if (Object.keys(state.checkins[dateStr]).length === 0) delete state.checkins[dateStr];
    } else {
      state.checkins[dateStr][taskId] = status;
    }
    saveState(state);
  }

  function getCheckin(dateStr, taskId) {
    return state.checkins[dateStr] && state.checkins[dateStr][taskId];
  }

  // ---------- Scheduler ----------
  function matchSchedule(schedule, dateStr) {
    switch (schedule.type) {
      case 'once':
        return schedule.date === dateStr;
      case 'daily':
        return true;
      case 'weekly':
        return Array.isArray(schedule.weekdays) && schedule.weekdays.includes(weekdayOf(dateStr));
      default:
        return false;
    }
  }

  /** Tasks scheduled for a given date string (excludes archived). */
  function tasksDueOn(dateStr, includeArchived = false) {
    return state.tasks.filter((t) => {
      if (!includeArchived && t.archived) return false;
      const start = t.schedule.startDate || '0000-01-01';
      if (dateStr < start) return false;
      return matchSchedule(t.schedule, dateStr);
    });
  }

  function describeSchedule(s) {
    switch (s.type) {
      case 'once':
        return `仅一次 · ${s.date}`;
      case 'daily':
        return '每天';
      case 'weekly': {
        const days = (s.weekdays || []).slice().sort().map((w) => WEEKDAY_LABELS[w]).join('/');
        return days ? `每周 ${days}` : '每周';
      }
      default:
        return '';
    }
  }

  // ---------- Import / Export ----------
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `life-tracker-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
          throw new Error('格式不正确');
        }
        if (!confirm('导入会覆盖当前所有数据，确定继续吗？')) return;
        state = {
          version: parsed.version || SCHEMA_VERSION,
          tasks: parsed.tasks,
          checkins: parsed.checkins || {},
          goalPeriods: Array.isArray(parsed.goalPeriods) ? parsed.goalPeriods : [],
        };
        saveState(state);
        renderAll();
        toast('已导入');
      } catch (err) {
        console.error(err);
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  // ---------- Navigation ----------
  const VIEWS = ['day', 'plans', 'reports', 'goals'];
  const VIEW_TITLES = { day: '今日', plans: '计划', reports: '报告', goals: '目标' };

  function switchView(view) {
    if (!VIEWS.includes(view)) return;
    VIEWS.forEach((v) => {
      const sec = $('#view-' + v);
      if (sec) sec.classList.toggle('hidden', v !== view);
    });
    $$('.tabbar .tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
    $('#view-title').textContent = VIEW_TITLES[view];
    if (view === 'day') renderDay();
    else if (view === 'plans') renderPlans();
    else if (view === 'reports') renderReports();
    else if (view === 'goals') renderGoals();
  }

  // ---------- Day View ----------
  let currentDate = todayStr();

  function renderDay() {
    $('#date-picker').value = currentDate;
    const list = $('#day-list');
    const empty = $('#day-empty');
    list.innerHTML = '';

    const items = tasksDueOn(currentDate);
    if (items.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    items
      .slice()
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title))
      .forEach((t) => {
        const status = getCheckin(currentDate, t.id);
        const li = document.createElement('li');
        li.className = 'task-item';
        li.dataset.id = t.id;
        if (status === CHECKIN_DONE) li.classList.add('is-done');
        if (status === CHECKIN_MISSED) li.classList.add('is-missed');

        const meta = [t.time, describeSchedule(t.schedule)].filter(Boolean).join(' · ');

        li.innerHTML = `
          <div class="task-main">
            <div class="task-title"></div>
            <div class="task-meta"></div>
            <div class="task-note"></div>
          </div>
          <div class="task-actions">
            <button class="check-btn done-btn" data-action="done" aria-label="完成">✓</button>
            <button class="check-btn miss-btn" data-action="missed" aria-label="未做到">✗</button>
          </div>
        `;
        li.querySelector('.task-title').textContent = t.title;
        li.querySelector('.task-meta').textContent = meta;
        const noteEl = li.querySelector('.task-note');
        if (t.note) noteEl.textContent = t.note;
        else noteEl.remove();

        li.querySelectorAll('.check-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const current = getCheckin(currentDate, t.id);
            if (current === action) {
              setCheckin(currentDate, t.id, null);
            } else {
              setCheckin(currentDate, t.id, action);
            }
            renderDay();
          });
        });

        list.appendChild(li);
      });
  }

  function bindDayView() {
    $('#date-picker').addEventListener('change', (e) => {
      if (!e.target.value) return;
      currentDate = e.target.value;
      renderDay();
    });
    $('#prev-day').addEventListener('click', () => {
      currentDate = addDays(currentDate, -1);
      renderDay();
    });
    $('#next-day').addEventListener('click', () => {
      currentDate = addDays(currentDate, 1);
      renderDay();
    });
    $('#today-btn').addEventListener('click', () => {
      currentDate = todayStr();
      renderDay();
    });
  }

  // ---------- Plans View ----------
  function renderPlans() {
    const list = $('#plans-list');
    const archivedList = $('#archived-list');
    const empty = $('#plans-empty');
    const archivedTitle = $('#archived-title');
    list.innerHTML = '';
    archivedList.innerHTML = '';

    const active = state.tasks.filter((t) => !t.archived);
    const archived = state.tasks.filter((t) => t.archived);

    if (active.length === 0) empty.classList.remove('hidden');
    else empty.classList.add('hidden');

    active.forEach((t) => list.appendChild(renderPlanItem(t, false)));
    archived.forEach((t) => archivedList.appendChild(renderPlanItem(t, true)));

    archivedTitle.classList.toggle('hidden', archived.length === 0);
  }

  function renderPlanItem(t, isArchived) {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.innerHTML = `
      <div class="plan-main">
        <div class="plan-title"></div>
        <div class="plan-meta"></div>
      </div>
      <div class="plan-actions"></div>
    `;
    li.querySelector('.plan-title').textContent = t.title;
    const meta = [t.time, describeSchedule(t.schedule), `自 ${t.schedule.startDate}`]
      .filter(Boolean)
      .join(' · ');
    li.querySelector('.plan-meta').textContent = meta;

    const actions = li.querySelector('.plan-actions');
    if (isArchived) {
      const restore = document.createElement('button');
      restore.className = 'link-btn';
      restore.textContent = '恢复';
      restore.addEventListener('click', () => {
        unarchiveTask(t.id);
        renderPlans();
        toast('已恢复');
      });
      actions.appendChild(restore);

      const del = document.createElement('button');
      del.className = 'link-btn danger-link';
      del.textContent = '彻底删除';
      del.addEventListener('click', () => confirmHardDelete(t));
      actions.appendChild(del);
    } else {
      const edit = document.createElement('button');
      edit.className = 'link-btn';
      edit.textContent = '编辑';
      edit.addEventListener('click', () => openTaskDialog(t));
      actions.appendChild(edit);
    }

    return li;
  }

  /** Two-step confirm before wiping an archived task and its history. */
  function confirmHardDelete(task) {
    if (!task.archived) {
      alert('只能彻底删除已归档的计划。请先归档。');
      return;
    }
    // Count affected checkins so the user knows what they're losing.
    let n = 0;
    Object.values(state.checkins).forEach((day) => {
      if (day && Object.prototype.hasOwnProperty.call(day, task.id)) n++;
    });
    const first = confirm(
      `彻底删除 “${task.title}”？\n\n这会同时抹掉 ${n} 条历史打卡记录，无法恢复。`
    );
    if (!first) return;
    const second = prompt('再确认一次：请输入"删除"以执行（可避免误触）');
    if (second === null) return;
    if (second.trim() !== '删除') {
      alert('已取消（输入不匹配）。');
      return;
    }
    deleteTaskPermanently(task.id);
    renderPlans();
    renderReports();
    toast('已彻底删除');
  }

  // ---------- Task Dialog ----------
  let editingId = null;

  function openTaskDialog(task) {
    editingId = task ? task.id : null;
    $('#dialog-title').textContent = task ? '编辑计划' : '新建计划';
    $('#dialog-archive').classList.toggle('hidden', !task);

    const form = $('#task-form');
    form.reset();

    $('#f-title').value = task ? task.title : '';
    $('#f-note').value = task ? task.note || '' : '';
    $('#f-time').value = task ? task.time || '' : '';

    const freq = task ? task.schedule.type : 'daily';
    $$('input[name="freq"]').forEach((r) => (r.checked = r.value === freq));

    $('#f-once-date').value = task && task.schedule.type === 'once' ? task.schedule.date : todayStr();
    $$('#field-weekly input[type="checkbox"]').forEach((cb) => {
      const wd = Number(cb.dataset.weekday);
      cb.checked = !!(task && task.schedule.type === 'weekly' && (task.schedule.weekdays || []).includes(wd));
    });
    $('#f-start-date').value = task ? task.schedule.startDate : todayStr();

    updateFreqFields();

    const dlg = $('#task-dialog');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function closeTaskDialog() {
    const dlg = $('#task-dialog');
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    editingId = null;
  }

  function updateFreqFields() {
    const freq = ($$('input[name="freq"]').find((r) => r.checked) || {}).value || 'daily';
    $('#field-once').hidden = freq !== 'once';
    $('#field-weekly').hidden = freq !== 'weekly';
  }

  function readDialogInput() {
    const title = $('#f-title').value.trim();
    if (!title) {
      alert('请填写标题');
      return null;
    }
    const note = $('#f-note').value.trim();
    const time = $('#f-time').value || '';
    const freq = ($$('input[name="freq"]').find((r) => r.checked) || {}).value || 'daily';
    const startDate = $('#f-start-date').value || todayStr();

    let schedule;
    if (freq === 'once') {
      const date = $('#f-once-date').value;
      if (!date) {
        alert('请选择日期');
        return null;
      }
      schedule = { type: 'once', date, startDate };
    } else if (freq === 'weekly') {
      const weekdays = $$('#field-weekly input[type="checkbox"]:checked').map((cb) => Number(cb.dataset.weekday));
      if (weekdays.length === 0) {
        alert('请至少选择一个星期几');
        return null;
      }
      schedule = { type: 'weekly', weekdays, startDate };
    } else {
      schedule = { type: 'daily', startDate };
    }

    return { title, note, time, schedule };
  }

  function bindPlansView() {
    $('#add-task-btn').addEventListener('click', () => openTaskDialog(null));

    $('#export-btn').addEventListener('click', exportJSON);
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importJSON(f);
      e.target.value = '';
    });

    $$('input[name="freq"]').forEach((r) => r.addEventListener('change', updateFreqFields));

    $('#dialog-cancel').addEventListener('click', closeTaskDialog);

    // Handle both click on Save and Enter key submission via form submit.
    $('#task-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = readDialogInput();
      if (!input) return;
      if (editingId) updateTask(editingId, input);
      else addTask(input);
      closeTaskDialog();
      renderPlans();
      renderDay();
      toast('已保存');
    });

    $('#dialog-archive').addEventListener('click', () => {
      if (!editingId) return;
      if (!confirm('归档后将不再出现在每日列表中（历史记录保留）。确定吗？')) return;
      archiveTask(editingId);
      closeTaskDialog();
      renderPlans();
      renderDay();
      toast('已归档');
    });

    // Click backdrop to close
    $('#task-dialog').addEventListener('click', (e) => {
      if (e.target.id === 'task-dialog') closeTaskDialog();
    });
  }

  // ---------- Reports View ----------
  function computeStats(days) {
    const today = parseDate(todayStr());
    let due = 0;
    let done = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ds = fmtDate(d);
      const items = tasksDueOn(ds, true);
      due += items.length;
      items.forEach((t) => {
        if (getCheckin(ds, t.id) === CHECKIN_DONE) done++;
      });
    }
    return { due, done };
  }

  function computeAllTimeStats() {
    let due = 0;
    let done = 0;
    // Walk from earliest startDate to today.
    if (state.tasks.length === 0) return { due: 0, done: 0 };
    const earliest = state.tasks
      .map((t) => t.schedule.startDate)
      .filter(Boolean)
      .sort()[0];
    if (!earliest) return { due: 0, done: 0 };
    let d = parseDate(earliest);
    const end = parseDate(todayStr());
    while (d <= end) {
      const ds = fmtDate(d);
      const items = tasksDueOn(ds, true);
      due += items.length;
      items.forEach((t) => {
        if (getCheckin(ds, t.id) === CHECKIN_DONE) done++;
      });
      d.setDate(d.getDate() + 1);
    }
    return { due, done };
  }

  function pct(done, due) {
    if (due === 0) return '—';
    return Math.round((done / due) * 100) + '%';
  }

  function renderReports() {
    const s7 = computeStats(7);
    const s30 = computeStats(30);
    const sAll = computeAllTimeStats();
    $('#stat-7').textContent = pct(s7.done, s7.due);
    $('#stat-30').textContent = pct(s30.done, s30.due);
    $('#stat-all').textContent = pct(sAll.done, sAll.due);

    renderTaskBreakdown();
    renderHeatmap();

    const hasAny = state.tasks.length > 0;
    $('#report-empty').classList.toggle('hidden', hasAny);
  }

  function renderTaskBreakdown() {
    const list = $('#report-task-list');
    list.innerHTML = '';

    const today = parseDate(todayStr());
    const dates = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dates.push(fmtDate(d));
    }

    state.tasks
      .filter((t) => !t.archived)
      .forEach((t) => {
        let due = 0;
        let done = 0;
        let missed = 0;
        dates.forEach((ds) => {
          if (ds < t.schedule.startDate) return;
          if (!matchSchedule(t.schedule, ds)) return;
          due++;
          const c = getCheckin(ds, t.id);
          if (c === CHECKIN_DONE) done++;
          else if (c === CHECKIN_MISSED) missed++;
        });

        const li = document.createElement('li');
        li.className = 'report-item';
        const ratio = due > 0 ? Math.round((done / due) * 100) : 0;
        li.innerHTML = `
          <div class="report-row">
            <div class="report-title"></div>
            <div class="report-pct"></div>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${ratio}%"></div></div>
          <div class="report-sub"></div>
        `;
        li.querySelector('.report-title').textContent = t.title;
        li.querySelector('.report-pct').textContent = due > 0 ? `${ratio}%` : '—';
        li.querySelector('.report-sub').textContent =
          due === 0 ? '近 30 天无计划' : `完成 ${done} / 应做 ${due} · 未做到 ${missed}`;
        list.appendChild(li);
      });
  }

  function renderHeatmap() {
    const table = $('#heatmap');
    table.innerHTML = '';

    const tasks = state.tasks.filter((t) => !t.archived);
    if (tasks.length === 0) return;

    const today = parseDate(todayStr());
    const todayDs = fmtDate(today);
    const dates = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dates.push(fmtDate(d));
    }

    /** Compute per-column metadata once: weekday letter, weekend, today, month-start. */
    const WEEKDAY_HEAD = ['日', '一', '二', '三', '四', '五', '六'];
    const meta = dates.map((ds, i) => {
      const d = parseDate(ds);
      const wd = d.getDay();
      const prev = i > 0 ? parseDate(dates[i - 1]) : null;
      return {
        ds,
        day: d.getDate(),
        wdLetter: WEEKDAY_HEAD[wd],
        isWeekend: wd === 0 || wd === 6,
        isToday: ds === todayDs,
        isMonthStart: i > 0 && prev.getMonth() !== d.getMonth(),
      };
    });

    const applyColMods = (cell, m) => {
      if (m.isWeekend) cell.classList.add('weekend');
      if (m.isToday) cell.classList.add('today-col');
      if (m.isMonthStart) cell.classList.add('month-start');
    };

    // Header row 1: weekday letters
    const thead = document.createElement('thead');
    const wdRow = document.createElement('tr');
    wdRow.appendChild(document.createElement('th')); // corner
    meta.forEach((m) => {
      const th = document.createElement('th');
      th.className = 'col-head wd-head';
      th.textContent = m.wdLetter;
      applyColMods(th, m);
      wdRow.appendChild(th);
    });
    thead.appendChild(wdRow);

    // Header row 2: day numbers (month/day for first col + month-start cols)
    const dayRow = document.createElement('tr');
    dayRow.appendChild(document.createElement('th')); // corner
    meta.forEach((m, i) => {
      const th = document.createElement('th');
      th.className = 'col-head day-head';
      const showMonth = i === 0 || m.isMonthStart;
      th.textContent = showMonth ? `${parseDate(m.ds).getMonth() + 1}/${m.day}` : m.day;
      th.title = m.ds;
      applyColMods(th, m);
      dayRow.appendChild(th);
    });
    thead.appendChild(dayRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tasks.forEach((t) => {
      const tr = document.createElement('tr');
      const labelCell = document.createElement('th');
      labelCell.scope = 'row';
      labelCell.className = 'row-head';
      labelCell.textContent = t.title;
      labelCell.title = t.title;
      tr.appendChild(labelCell);
      meta.forEach((m) => {
        const td = document.createElement('td');
        td.className = 'cell';
        const due = m.ds >= t.schedule.startDate && matchSchedule(t.schedule, m.ds);
        if (!due) {
          td.classList.add('na');
        } else {
          const c = getCheckin(m.ds, t.id);
          if (c === CHECKIN_DONE) td.classList.add('done');
          else if (c === CHECKIN_MISSED) td.classList.add('missed');
          else td.classList.add('pending');
        }
        applyColMods(td, m);
        td.title = `${t.title} · ${m.ds}`;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // ---------- Goals View ----------
  let selectedGoalPeriodId = null;
  let goalsPage = 'home';
  let goalDraft = null;

  function isValidDateStr(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return false;
    const d = parseDate(dateStr);
    return fmtDate(d) === dateStr;
  }

  function periodDayCount(startDate, endDate) {
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate) || endDate < startDate) return 0;
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    return Math.round((end - start) / 86400000) + 1;
  }

  function datesInPeriod(period) {
    const days = periodDayCount(period.startDate, period.endDate);
    if (days === 0) return [];
    const dates = [];
    for (let i = 0; i < days; i++) dates.push(addDays(period.startDate, i));
    return dates;
  }

  function formatShortDate(dateStr) {
    if (!isValidDateStr(dateStr)) return '日期无效';
    const d = parseDate(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} 周${WEEKDAY_LABELS[d.getDay()]}`;
  }

  function formatPeriodRange(period) {
    return `${formatShortDate(period.startDate)} - ${formatShortDate(period.endDate)}`;
  }

  function periodStatus(period) {
    const today = todayStr();
    if (!isValidDateStr(period.startDate) || !isValidDateStr(period.endDate)) return '日期无效';
    if (today < period.startDate) return '未开始';
    if (today > period.endDate) return '已结束';
    return '进行中';
  }

  function sortedGoalPeriods() {
    return (Array.isArray(state.goalPeriods) ? state.goalPeriods : [])
      .slice()
      .sort((a, b) =>
        String(b.endDate || '').localeCompare(String(a.endDate || '')) ||
        String(b.startDate || '').localeCompare(String(a.startDate || '')) ||
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );
  }

  function getSelectedGoalPeriod() {
    const periods = sortedGoalPeriods();
    if (periods.length === 0) return null;
    let selected = periods.find((p) => p.id === selectedGoalPeriodId);
    if (!selected) {
      selected = periods[0];
      selectedGoalPeriodId = selected.id;
    }
    return selected;
  }

  function activeDailyTasks() {
    return state.tasks.filter((t) => !t.archived && t.schedule && t.schedule.type === 'daily');
  }

  function defaultTargetDays(days) {
    return Math.max(1, Math.min(6, days || 1));
  }

  function clampDraftTargets() {
    if (!goalDraft) return;
    const days = periodDayCount(goalDraft.startDate, goalDraft.endDate);
    const maxDays = Math.max(1, days || 1);
    goalDraft.goals.forEach((goal) => {
      goal.targetDays = Math.min(maxDays, Math.max(1, Number(goal.targetDays) || 1));
    });
  }

  function openAddGoalPage() {
    const startDate = todayStr();
    const endDate = addDays(startDate, 6);
    const days = periodDayCount(startDate, endDate);
    goalDraft = {
      mode: 'add',
      startDate,
      endDate,
      goals: activeDailyTasks().map((task) => ({
        id: uid('g'),
        sourceTaskId: task.id,
        title: task.title,
        targetDays: defaultTargetDays(days),
      })),
    };
    goalsPage = 'add';
    renderGoals();
  }

  function openEditGoalPage(period) {
    if (!period) return;
    goalDraft = {
      mode: 'edit',
      periodId: period.id,
      createdAt: period.createdAt,
      startDate: period.startDate,
      endDate: period.endDate,
      goals: (Array.isArray(period.goals) ? period.goals : []).map((goal) => ({
        id: goal.id || uid('g'),
        sourceTaskId: goal.sourceTaskId,
        title: goal.title || '未命名目标',
        targetDays: Number(goal.targetDays) || 1,
      })),
    };
    clampDraftTargets();
    goalsPage = 'edit';
    renderGoals();
  }

  function saveGoalDraft() {
    if (!goalDraft) return;
    const days = periodDayCount(goalDraft.startDate, goalDraft.endDate);
    if (days === 0) {
      alert('结束日期不能早于开始日期。');
      return;
    }
    if (goalDraft.goals.length === 0) {
      alert('请至少保留一个目标。');
      return;
    }
    clampDraftTargets();
    const now = new Date().toISOString();
    const goals = goalDraft.goals.map((goal) => ({
      id: goal.id || uid('g'),
      sourceTaskId: goal.sourceTaskId,
      title: goal.title || '未命名目标',
      targetDays: Math.min(days, Math.max(1, Number(goal.targetDays) || 1)),
    }));

    if (goalDraft.mode === 'edit') {
      const existing = state.goalPeriods.find((period) => period.id === goalDraft.periodId);
      if (!existing) {
        alert('这个目标周期不存在。');
        return;
      }
      existing.startDate = goalDraft.startDate;
      existing.endDate = goalDraft.endDate;
      existing.updatedAt = now;
      existing.goals = goals;
      selectedGoalPeriodId = existing.id;
    } else {
      const period = {
        id: uid('gp'),
        startDate: goalDraft.startDate,
        endDate: goalDraft.endDate,
        createdAt: now,
        updatedAt: now,
        goals,
      };
      state.goalPeriods.push(period);
      selectedGoalPeriodId = period.id;
    }

    saveState(state);
    goalDraft = null;
    goalsPage = 'home';
    renderGoals();
    toast('已保存');
  }

  function deleteSelectedGoalPeriod() {
    if (!goalDraft || goalDraft.mode !== 'edit') return;
    state.goalPeriods = state.goalPeriods.filter((period) => period.id !== goalDraft.periodId);
    saveState(state);
    selectedGoalPeriodId = null;
    goalDraft = null;
    goalsPage = 'home';
    renderGoals();
    toast('已删除目标周期');
  }

  function countDoneDays(goal, period) {
    return datesInPeriod(period).reduce((total, dateStr) => total + (getCheckin(dateStr, goal.sourceTaskId) === CHECKIN_DONE ? 1 : 0), 0);
  }

  function periodSummary(period) {
    const goals = Array.isArray(period.goals) ? period.goals : [];
    const achieved = goals.filter((goal) => countDoneDays(goal, period) >= (Number(goal.targetDays) || 1)).length;
    const percent = goals.length === 0 ? null : Math.round((achieved / goals.length) * 100);
    return { achieved, total: goals.length, percent };
  }

  function emojiForPercent(percent) {
    if (percent === null) return '';
    if (percent === 100) return '🎉';
    if (percent >= 50) return '💪';
    if (percent >= 1) return '😅';
    return '🫠';
  }

  function appendGoalProgressCard(parent, goal, period) {
    const doneDays = countDoneDays(goal, period);
    const targetDays = Math.max(1, Number(goal.targetDays) || 1);
    const achieved = doneDays >= targetDays;
    const days = datesInPeriod(period);
    const card = document.createElement('article');
    card.className = 'goal-card';
    card.innerHTML = `
      <div class="goal-card-head">
        <div class="goal-title"></div>
        <div class="goal-ratio"></div>
      </div>
      <div class="bar"><div class="bar-fill"></div></div>
      <div class="goal-days"></div>
    `;
    card.querySelector('.goal-title').textContent = goal.title || '未命名目标';
    card.querySelector('.goal-ratio').textContent = `完成 ${doneDays} / ${targetDays} 天${achieved ? ' 🎉' : ''}`;
    card.querySelector('.bar-fill').style.width = Math.min(100, Math.round((doneDays / targetDays) * 100)) + '%';
    const daysEl = card.querySelector('.goal-days');
    days.forEach((dateStr) => {
      const status = getCheckin(dateStr, goal.sourceTaskId);
      const day = document.createElement('span');
      day.className = 'goal-day';
      if (status === CHECKIN_DONE) day.classList.add('done');
      else if (status === CHECKIN_MISSED) day.classList.add('missed');
      else day.classList.add('none');
      const symbol = status === CHECKIN_DONE ? '✓' : status === CHECKIN_MISSED ? '✗' : '·';
      day.textContent = `周${WEEKDAY_LABELS[weekdayOf(dateStr)]} ${symbol}`;
      day.title = dateStr;
      daysEl.appendChild(day);
    });
    parent.appendChild(card);
  }

  function appendHistoryCard(parent, period, isCurrent) {
    const summary = periodSummary(period);
    const days = periodDayCount(period.startDate, period.endDate);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'history-card' + (isCurrent ? ' current' : '');
    card.dataset.goalAction = 'select-period';
    card.dataset.periodId = period.id;
    card.innerHTML = `
      <div class="history-row">
        <span class="history-status"></span>
        <span class="history-current"></span>
      </div>
      <div class="history-range"></div>
      <div class="history-meta"></div>
    `;
    card.querySelector('.history-status').textContent = periodStatus(period);
    card.querySelector('.history-current').textContent = isCurrent ? '当前' : '';
    card.querySelector('.history-range').textContent = formatPeriodRange(period);
    const percentText = summary.percent === null ? '—' : `${summary.percent}% ${emojiForPercent(summary.percent)}`;
    card.querySelector('.history-meta').textContent = `共 ${days || '—'} 天 · ${summary.achieved}/${summary.total} · ${percentText}`;
    parent.appendChild(card);
  }

  function renderGoalsHome(root) {
    const periods = sortedGoalPeriods();
    const selected = getSelectedGoalPeriod();
    if (!selected) {
      root.innerHTML = `
        <article class="goal-empty-card">
          <h2>还没有目标</h2>
          <p>目标会根据「今日」里的打卡自动计算进度。</p>
          <button class="primary-btn" type="button" data-goal-action="add">添加目标</button>
        </article>
      `;
      return;
    }

    const summary = periodSummary(selected);
    const days = periodDayCount(selected.startDate, selected.endDate);
    root.innerHTML = `
      <article class="goal-summary-card">
        <div class="goal-status-pill"></div>
        <h2 class="goal-period-range"></h2>
        <p class="goal-period-days"></p>
        <div class="goal-summary-score"></div>
        <button class="link-btn" type="button" data-goal-action="edit-current">编辑本期目标</button>
      </article>
      <div id="goal-progress-list" class="goal-progress-list"></div>
      <button class="primary-btn goal-add-wide" type="button" data-goal-action="add">添加目标</button>
      <h2 class="section-title">历史目标</h2>
      <div id="goal-history-list" class="goal-history-list"></div>
    `;

    root.querySelector('.goal-status-pill').textContent = periodStatus(selected);
    root.querySelector('.goal-period-range').textContent = formatPeriodRange(selected);
    root.querySelector('.goal-period-days').textContent = `共 ${days || '—'} 天`;
    const percentText = summary.percent === null ? '—' : `${summary.percent}% ${emojiForPercent(summary.percent)}`;
    root.querySelector('.goal-summary-score').textContent = `${summary.achieved}/${summary.total} goals · ${percentText}`;

    const progressList = root.querySelector('#goal-progress-list');
    (Array.isArray(selected.goals) ? selected.goals : []).forEach((goal) => appendGoalProgressCard(progressList, goal, selected));
    if (progressList.children.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '本期还没有目标。';
      progressList.appendChild(empty);
    }

    const historyList = root.querySelector('#goal-history-list');
    periods.forEach((period) => appendHistoryCard(historyList, period, period.id === selected.id));
  }

  function renderGoalDraftPage(root, title, saveText) {
    if (!goalDraft) {
      goalsPage = 'home';
      renderGoals();
      return;
    }
    const days = periodDayCount(goalDraft.startDate, goalDraft.endDate);
    const canSave = days > 0 && goalDraft.goals.length > 0;
    root.innerHTML = `
      <div class="goal-editor-shell">
        <button class="link-btn goal-back-btn" type="button" data-goal-action="back-home">‹ 返回</button>
        <h2 class="goal-page-title">${title}</h2>

        <section class="goal-form-card">
          <h3>周期</h3>
          <label class="field goal-field">
            <span>开始日期</span>
            <input type="date" data-goal-field="startDate" value="${goalDraft.startDate || ''}" />
          </label>
          <label class="field goal-field">
            <span>结束日期</span>
            <input type="date" data-goal-field="endDate" value="${goalDraft.endDate || ''}" />
          </label>
          <p class="goal-days-count">${days > 0 ? `共 ${days} 天` : '结束日期不能早于开始日期'}</p>
        </section>

        <h2 class="section-title">目标</h2>
        <div id="goal-draft-list" class="goal-draft-list"></div>
        ${goalDraft.mode === 'edit' ? `
          <section class="goal-danger-section">
            <h3>危险操作</h3>
            <p>删除这个目标周期。不会删除每日计划，也不会删除已有打卡记录。</p>
            <button class="danger-btn" type="button" data-goal-action="delete-page">删除周期</button>
          </section>
        ` : ''}
      </div>
      <div class="goal-save-bar">
        <button class="primary-btn" type="button" data-goal-action="save-draft" ${canSave ? '' : 'disabled'}>${saveText}</button>
      </div>
    `;

    const list = root.querySelector('#goal-draft-list');
    if (goalDraft.goals.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = goalDraft.mode === 'add' ? '没有可用的每日计划。请先去「计划」添加每日计划。' : '请至少保留一个目标，或删除整个周期。';
      list.appendChild(empty);
    }
    goalDraft.goals.forEach((goal) => appendGoalDraftCard(list, goal, days));
  }

  function appendGoalDraftCard(parent, goal, days) {
    const maxDays = Math.max(1, days || 1);
    const card = document.createElement('article');
    card.className = 'goal-draft-card';
    card.innerHTML = `
      <div class="goal-title"></div>
      <div class="goal-target-label">目标天数</div>
      <div class="goal-stepper">
        <button class="icon-btn" type="button" data-goal-action="dec-target" data-goal-id="${goal.id}" aria-label="减少目标天数">−</button>
        <span class="goal-target-value"></span>
        <button class="icon-btn" type="button" data-goal-action="inc-target" data-goal-id="${goal.id}" aria-label="增加目标天数">+</button>
      </div>
      <button class="link-btn danger-link goal-remove-btn" type="button" data-goal-action="remove-draft-goal" data-goal-id="${goal.id}">移除目标</button>
    `;
    card.querySelector('.goal-title').textContent = goal.title || '未命名目标';
    card.querySelector('.goal-target-value').textContent = `${Math.min(maxDays, Math.max(1, Number(goal.targetDays) || 1))} 天`;
    parent.appendChild(card);
  }

  function renderGoalDeletePage(root) {
    if (!goalDraft) {
      goalsPage = 'home';
      renderGoals();
      return;
    }
    root.innerHTML = `
      <article class="goal-delete-card">
        <h2>删除目标周期？</h2>
        <p>这个操作会永久删除当前目标周期。</p>
        <p>不会删除每日计划。不会删除已有打卡记录。</p>
        <div class="goal-delete-range"></div>
        <button class="link-btn" type="button" data-goal-action="cancel-delete">取消</button>
        <button class="danger-btn goal-confirm-delete" type="button" data-goal-action="confirm-delete">确认删除</button>
      </article>
    `;
    root.querySelector('.goal-delete-range').textContent = formatPeriodRange(goalDraft);
  }

  function renderGoals() {
    const root = $('#goals-root');
    if (!root) return;
    root.innerHTML = '';
    if (!Array.isArray(state.goalPeriods)) state.goalPeriods = [];
    if (goalsPage === 'add') renderGoalDraftPage(root, '添加目标', '保存目标');
    else if (goalsPage === 'edit') renderGoalDraftPage(root, '编辑本期目标', '保存修改');
    else if (goalsPage === 'delete') renderGoalDeletePage(root);
    else renderGoalsHome(root);
  }

  function bindGoalsView() {
    const root = $('#goals-root');
    root.addEventListener('click', (e) => {
      const control = e.target.closest('[data-goal-action]');
      if (!control || !root.contains(control)) return;
      const action = control.dataset.goalAction;
      if (action === 'add') openAddGoalPage();
      else if (action === 'edit-current') openEditGoalPage(getSelectedGoalPeriod());
      else if (action === 'select-period') {
        selectedGoalPeriodId = control.dataset.periodId;
        goalsPage = 'home';
        renderGoals();
      } else if (action === 'back-home') {
        goalDraft = null;
        goalsPage = 'home';
        renderGoals();
      } else if (action === 'remove-draft-goal' && goalDraft) {
        goalDraft.goals = goalDraft.goals.filter((goal) => goal.id !== control.dataset.goalId);
        renderGoals();
      } else if ((action === 'inc-target' || action === 'dec-target') && goalDraft) {
        const goal = goalDraft.goals.find((item) => item.id === control.dataset.goalId);
        if (!goal) return;
        const days = Math.max(1, periodDayCount(goalDraft.startDate, goalDraft.endDate) || 1);
        const delta = action === 'inc-target' ? 1 : -1;
        goal.targetDays = Math.min(days, Math.max(1, (Number(goal.targetDays) || 1) + delta));
        renderGoals();
      } else if (action === 'save-draft') {
        saveGoalDraft();
      } else if (action === 'delete-page') {
        goalsPage = 'delete';
        renderGoals();
      } else if (action === 'cancel-delete') {
        goalsPage = 'edit';
        renderGoals();
      } else if (action === 'confirm-delete') {
        deleteSelectedGoalPeriod();
      }
    });

    root.addEventListener('change', (e) => {
      if (!goalDraft || !e.target.matches('[data-goal-field]')) return;
      goalDraft[e.target.dataset.goalField] = e.target.value;
      clampDraftTargets();
      renderGoals();
    });
  }

  // ---------- Bind global ----------
  function bindNav() {
    $$('.tabbar .tab').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }

  function renderAll() {
    renderDay();
    renderPlans();
    renderReports();
    renderGoals();
  }

  // ---------- Service Worker ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register failed', err));
    });
  }

  // ---------- Init ----------
  function init() {
    bindNav();
    bindDayView();
    bindPlansView();
    bindGoalsView();
    switchView('day');
    registerSW();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
