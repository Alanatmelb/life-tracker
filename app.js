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

  const uid = () => 't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

  // ---------- State (data layer) ----------
  /** Default state shape. */
  const defaultState = () => ({
    version: SCHEMA_VERSION,
    tasks: [],
    checkins: {}, // { "YYYY-MM-DD": { taskId: "done" | "missed" } }
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
  const VIEWS = ['day', 'plans', 'reports'];
  const VIEW_TITLES = { day: '今日', plans: '计划', reports: '报告' };

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
    switchView('day');
    registerSW();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
