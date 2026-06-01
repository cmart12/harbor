// Slide mockup — scheduled Whim skills spawning Spaces.
const STYLE_ID = 'mk-scheduler-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #widget-scheduler { width: min(560px, 100%); }
  #widget-scheduler .scheduler-wrap { display: grid; gap: 10px; }
  #widget-scheduler .skill-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
  #widget-scheduler .skill-name { display: flex; gap: 9px; align-items: center; font-weight: 750; color: var(--whim-text); }
  #widget-scheduler .skill-icon { width: 34px; height: 34px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: rgba(124, 92, 255, .16); border: 1px solid rgba(124, 92, 255, .28); }
  #widget-scheduler .skill-sub { margin-top: 3px; color: var(--whim-text-dim); font-size: 12px; }
  #widget-scheduler .status-line { min-width: 92px; text-align: right; }
  #widget-scheduler .form-grid { display: grid; grid-template-columns: 1.1fr .8fr 1fr; gap: 10px; align-items: end; }
  #widget-scheduler .field:disabled { opacity: .45; filter: grayscale(.35); cursor: not-allowed; }
  #widget-scheduler .run-card { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--whim-border); border-radius: 12px; background: rgba(255,255,255,.035); }
  #widget-scheduler .next-run { color: var(--whim-text); font-size: 13px; font-weight: 650; }
  #widget-scheduler .run-meta { margin-top: 5px; color: var(--whim-text-dim); font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
  #widget-scheduler .caption { display: none; color: var(--whim-text-faint); font-size: 11px; margin-top: 8px; }
  #widget-scheduler .caption.show { display: block; }
  #widget-scheduler .actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  #widget-scheduler .spawn-area { margin-top: 12px; display: grid; gap: 8px; min-height: 104px; }
  #widget-scheduler .spawn-title { color: var(--whim-text-dim); font-size: 12px; letter-spacing: .02em; text-transform: uppercase; }
  #widget-scheduler .empty-space { border: 1px dashed var(--whim-border); border-radius: 12px; padding: 18px 12px; text-align: center; color: var(--whim-text-faint); font-size: 12px; }
  #widget-scheduler .space-card { display: grid; gap: 6px; border-color: rgba(77, 214, 146, .35); background: linear-gradient(135deg, rgba(77, 214, 146, .11), rgba(124, 92, 255, .07)); }
  #widget-scheduler .space-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  #widget-scheduler .space-name { color: var(--whim-text); font-weight: 720; font-size: 13px; }
  #widget-scheduler .space-note { color: var(--whim-text-dim); font-size: 12px; }
  #widget-scheduler .mockup-toolbar { margin-top: 2px; }
  `;
  document.head.appendChild(s);
}

function clearTimers(el) {
  if (!el.__mkSchedulerTimers) el.__mkSchedulerTimers = [];
  el.__mkSchedulerTimers.forEach((timer) => clearTimeout(timer));
  el.__mkSchedulerTimers = [];
}

function addTimer(el, fn, ms) {
  const timer = setTimeout(() => {
    el.__mkSchedulerTimers = (el.__mkSchedulerTimers || []).filter((t) => t !== timer);
    fn();
  }, ms);
  el.__mkSchedulerTimers.push(timer);
  return timer;
}

function parseTime(value) {
  const [hours, minutes] = (value || '09:00').split(':').map((part) => Number.parseInt(part, 10));
  return {
    hours: Number.isFinite(hours) ? hours : 9,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

function atTime(date, time) {
  const next = new Date(date);
  next.setHours(time.hours, time.minutes, 0, 0);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextWeekday(now, time) {
  let candidate = atTime(now, time);
  for (let i = 0; i < 8; i += 1) {
    const day = candidate.getDay();
    if (day >= 1 && day <= 5 && candidate > now) return candidate;
    candidate = atTime(addDays(candidate, 1), time);
  }
  return candidate;
}

function nextSelectedDay(now, time, weekday, intervalDays) {
  let daysUntil = (weekday - now.getDay() + 7) % 7;
  let candidate = atTime(addDays(now, daysUntil), time);
  if (candidate <= now) {
    candidate = atTime(addDays(candidate, intervalDays), time);
  }
  return candidate;
}

function nextMonthly(now, time) {
  const candidate = atTime(now, time);
  if (candidate > now) return candidate;

  const next = new Date(now);
  const desiredDay = now.getDate();
  next.setMonth(next.getMonth() + 1, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(desiredDay, lastDay));
  return atTime(next, time);
}

function computeNextRun(freq, timeValue, weekdayValue) {
  const now = new Date();
  const time = parseTime(timeValue);
  const weekday = Number.parseInt(weekdayValue, 10);

  if (freq === 'daily') {
    const today = atTime(now, time);
    return today > now ? today : atTime(addDays(now, 1), time);
  }
  if (freq === 'weekdays') return nextWeekday(now, time);
  if (freq === 'weekly') return nextSelectedDay(now, time, weekday, 7);
  if (freq === 'biweekly') return nextSelectedDay(now, time, weekday, 14);
  return nextMonthly(now, time);
}

function humanDelta(date) {
  const diffMs = Math.max(0, date.getTime() - Date.now());
  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `in ${days} ${days === 1 ? 'day' : 'days'}`;
  if (hours > 0) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function formatRun(date) {
  const day = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time} (${humanDelta(date)})`;
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function init(el) {
  clearTimers(el);
  injectStyle();

  el.innerHTML = `
    <div class="scheduler-wrap">
      <div class="win">
        <div class="win-titlebar">
          <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
          <span class="win-title">Schedule · Weekly Dependency Audit</span>
        </div>
        <div class="win-body">
          <div class="skill-head">
            <div>
              <div class="skill-name"><span class="skill-icon">📦</span><span>Weekly Dependency Audit</span></div>
              <div class="skill-sub">Schedule a Whim skill to run automatically and spawn a Space.</div>
            </div>
            <div class="status-line" data-status></div>
          </div>

          <div class="form-grid">
            <label>
              <div class="field-label">Frequency</div>
              <select class="field" data-frequency>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly" selected>Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label>
              <div class="field-label">Time of day</div>
              <input type="time" class="field" value="09:00" data-time>
            </label>
            <label>
              <div class="field-label">Day of week</div>
              <select class="field" data-weekday>
                <option value="0">Sun</option>
                <option value="1" selected>Mon</option>
                <option value="2">Tue</option>
                <option value="3">Wed</option>
                <option value="4">Thu</option>
                <option value="5">Fri</option>
                <option value="6">Sat</option>
              </select>
            </label>
          </div>

          <div class="run-card">
            <div class="next-run" data-next-run>Next run: calculating…</div>
            <div class="run-meta"><span>last_run_at: <strong data-last-run>never</strong></span><span>next_run_at tracked by app</span></div>
            <div class="caption" data-caption>Scheduler checks for due skills every 60s.</div>
          </div>

          <div class="actions">
            <button class="btn btn-primary" data-save>Save schedule</button>
            <button class="btn btn-green" data-trigger>▶ Simulate trigger</button>
          </div>

          <div class="spawn-area">
            <div class="spawn-title">Spawned Space</div>
            <div class="empty-space" data-empty>No Space yet — simulate a due schedule.</div>
            <div data-spawned></div>
          </div>
        </div>
      </div>
      <div class="mockup-toolbar"><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-reset>↻ Reset</button></div>
    </div>
  `;

  const frequency = el.querySelector('[data-frequency]');
  const time = el.querySelector('[data-time]');
  const weekday = el.querySelector('[data-weekday]');
  const nextRun = el.querySelector('[data-next-run]');
  const lastRun = el.querySelector('[data-last-run]');
  const status = el.querySelector('[data-status]');
  const caption = el.querySelector('[data-caption]');
  const spawned = el.querySelector('[data-spawned]');
  const empty = el.querySelector('[data-empty]');
  const save = el.querySelector('[data-save]');
  const trigger = el.querySelector('[data-trigger]');
  const reset = el.querySelector('[data-reset]');

  function renderNextRun() {
    const needsWeekday = frequency.value === 'weekly' || frequency.value === 'biweekly';
    weekday.disabled = !needsWeekday;
    const next = computeNextRun(frequency.value, time.value, weekday.value);
    nextRun.textContent = `Next run: ${formatRun(next)}`;
  }

  function resetState() {
    clearTimers(el);
    frequency.value = 'weekly';
    time.value = '09:00';
    weekday.value = '1';
    lastRun.textContent = 'never';
    status.innerHTML = '';
    caption.classList.remove('show');
    spawned.innerHTML = '';
    empty.style.display = '';
    trigger.disabled = false;
    renderNextRun();
  }

  function saveSchedule() {
    status.innerHTML = '<span class="badge done fade-in">scheduled</span>';
    caption.classList.add('show');
    renderNextRun();
  }

  function simulateTrigger() {
    trigger.disabled = true;
    status.innerHTML = '<span class="badge running fade-in">running skill…</span>';
    addTimer(el, () => {
      status.innerHTML = '<span class="badge done fade-in">captured</span>';
      lastRun.textContent = 'just now';
      empty.style.display = 'none';
      spawned.innerHTML = `
        <div class="card space-card slide-in">
          <div class="space-row"><div class="space-name">Weekly dependency audit — ${todayLabel()}</div><span class="badge done">captured</span></div>
          <div class="space-note">created by 📦 Weekly Dependency Audit</div>
        </div>
      `;
      trigger.disabled = false;
      renderNextRun();
    }, 1000);
  }

  frequency.addEventListener('change', renderNextRun);
  time.addEventListener('change', renderNextRun);
  weekday.addEventListener('change', renderNextRun);
  save.addEventListener('click', saveSchedule);
  trigger.addEventListener('click', simulateTrigger);
  reset.addEventListener('click', resetState);

  renderNextRun();
}
