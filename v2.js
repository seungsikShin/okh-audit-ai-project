// ══════════════════════════════════════════════════════════════
//  v2.js — AI 과제 재편 트랙 (16 에이전트 · 25 과제)
//
//  · 편집 주체는 이 트랙이다. 25건의 진척률·착수상태를 여기서 수정하면
//    원과제 80건 트랙(app.js)에 자동으로 안분 반영된다.
//  · 저장 경로는 Firebase okh_audit/tasks_v2 (원과제 트랙과 완전히 분리)
// ══════════════════════════════════════════════════════════════

/* ── 상태 ─────────────────────────────────────────────────── */
let v2data = JSON.parse(JSON.stringify(V2_TASKS));
let v2charts = {};
let v2EditNo = null;

/* 원과제 no → 신과제 no 매핑 (안분의 근거) */
const V2_LINK = (() => {
  const m = {};
  V2_TASKS.forEach(t => t.origins.forEach(o => { m[o] = t.no; }));
  return m;
})();

/* 원과제 no → 처리 이력 */
const V2_LEGACY_BY_NO = Object.fromEntries(V2_LEGACY.map(l => [l.no, l]));

const V2_ACTION_META = {
  '통합':     { tone: 'ok',   desc: '신과제에 흡수됨. 진척률이 안분 반영된다' },
  '분할':     { tone: 'ok',   desc: '일부만 신과제로 흡수되고 나머지는 비AI 자산으로 분리' },
  'AX취소':   { tone: 'stop', desc: 'AI 개발 취소. AI를 쓸 지점이 아니라고 판정' },
  '비AI이관': { tone: 'warn', desc: 'LLM 미사용 자동화. 계속 운영하되 AI 집계에서 분리' },
  '범용도구': { tone: 'info', desc: '범용 AI를 그대로 쓰는 일. 개발 과제가 아님' },
  '수기유지': { tone: 'mute', desc: 'As-Is·To-Be 모두 AI 미활용. 수기 유지' }
};

const V2_PALETTE = ['#147B52','#1B8F61','#3FA97F','#67C29B','#0EA5E9','#6366F1',
                    '#F59E0B','#EF4444','#8B5CF6','#14B8A6','#F97316','#64748B'];

/* ── 조회 유틸 ─────────────────────────────────────────────── */
function v2Task(no) { return v2data.find(t => t.no === Number(no)); }
function v2Agent(no) { return V2_AGENTS.find(a => a.no === Number(no)); }

/** 집계 대상 과제 (BSP 권한 대기 2건 제외) */
function v2Scored() { return v2data.filter(t => !t.planned); }

/**
 * 안분 결과 — 원과제 no로 조회한다.
 * @returns {{progress:number, status:string, task:object}|null}  progress는 0~1
 */
function v2ProrationFor(legacyNo) {
  const tno = V2_LINK[legacyNo];
  if (!tno) return null;
  const t = v2Task(tno);
  if (!t) return null;
  return { progress: (t.progress || 0) / 100, status: t.status || '미착수', task: t };
}
window._v2ProrationFor = v2ProrationFor;

/**
 * 안분 규칙 — 보고 기준이 바뀌면 이 두 줄만 고치면 된다.
 *
 * V2_PROGRESS_MODE
 *   'max'     — max(자체 값, 상위 과제 값). 흡수 덕분에 올라가기만 하고 내려가지 않는다. [현행]
 *   'inherit' — 상위 과제 값을 그대로 받는다. 재편안 엑셀과 1:1로 맞지만,
 *               자체 진척률이 상위 과제보다 높게 보고돼 있던 26건이 하락한다.
 *
 * V2_STATUS_MODE
 *   'inherit' — 착수상태는 상위 과제를 그대로 따른다. 재편안에 미착수(설계안)로
 *               적힌 과제19·20의 원과제는 미착수로 내려간다. [현행]
 *   'max'     — 자체·상위 중 하나라도 착수면 착수로 둔다.
 */
const V2_PROGRESS_MODE = 'max';
const V2_STATUS_MODE = 'inherit';

/**
 * 원과제 80건 배열에 안분 진척률을 적용한다.
 * 자체 값은 _자체진척률·_자체착수상태에 보존하므로 되돌릴 수 있다.
 */
window._v2ApplyProration = function (rows) {
  if (!Array.isArray(rows)) return;
  rows.forEach(r => {
    if (r._자체진척률 === undefined) r._자체진척률 = r.진척률 || 0;
    if (r._자체착수상태 === undefined) r._자체착수상태 = r.착수상태 || '';
    const p = v2ProrationFor(r.no);
    if (p) {
      r._연동 = true;
      r._연동과제 = p.task.no;
      r.진척률 = V2_PROGRESS_MODE === 'max'
        ? Math.max(r._자체진척률 || 0, p.progress)
        : p.progress;
      r.착수상태 = V2_STATUS_MODE === 'max'
        ? ((r._자체착수상태 === '착수' || p.status === '착수') ? '착수' : p.status)
        : p.status;
    } else {
      r._연동 = false;
      r._연동과제 = null;
      r.진척률 = r._자체진척률;
      r.착수상태 = r._자체착수상태;
    }
  });
};

/** 원과제 80건 기준 안분 집계 — 대시보드 KPI에서 사용 */
window._v2LegacyRollup = function (rows) {
  const linked = rows.filter(r => r._연동);
  const own = rows.filter(r => !r._연동);
  const avg = arr => arr.length ? Math.round(arr.reduce((s, r) => s + (r.진척률 || 0), 0) / arr.length * 100) : 0;
  return {
    linkedCount: linked.length,
    ownCount: own.length,
    linkedAvg: avg(linked),          // AI 과제로 흡수된 68건 기준
    totalAvg: avg(rows),             // 전체 80건 기준
    beforeAvg: rows.length ? Math.round(rows.reduce((s, r) => s + (r._자체진척률 || 0), 0) / rows.length * 100) : 0
  };
};

/* ══ 재편 대시보드 ═══════════════════════════════════════════ */
function v2DestroyChart(id) { if (v2charts[id]) { v2charts[id].destroy(); delete v2charts[id]; } }

function renderV2Dashboard() {
  const scored = v2Scored();
  const started = scored.filter(t => t.status === '착수');
  const done = scored.filter(t => t.progress >= 100);
  const avg = scored.length ? Math.round(scored.reduce((s, t) => s + t.progress, 0) / scored.length) : 0;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('v2k-agents', V2_AGENTS.length);
  set('v2k-tasks', v2data.length);
  set('v2k-avg', avg + '%');
  set('v2k-started', started.length);
  set('v2k-done', done.length);
  set('v2k-absorbed', Object.keys(V2_LINK).length);
  set('v2k-tasks-sub', '집계 ' + scored.length + '건 · 권한대기 ' + (v2data.length - scored.length) + '건');
  set('v2k-started-sub', scored.length ? Math.round(started.length / scored.length * 100) + '%' : '');
  set('v2k-done-sub', scored.length ? Math.round(done.length / scored.length * 100) + '%' : '');
  set('v2k-absorbed-sub', '원과제 80건 중');

  renderV2Rollup();
  renderV2AgentChart();
  renderV2PersonChart();
  renderV2QuarterChart();
  renderV2Ledger();
}

/** 안분 효과 요약 — 원과제 80건의 진척률이 어떻게 움직였는가 */
function renderV2Rollup() {
  const wrap = document.getElementById('v2RollupWrap');
  if (!wrap) return;
  const rows = window._dashData || [];
  if (!rows.length) { wrap.innerHTML = '<div class="v2-empty">원과제 데이터를 불러오는 중입니다.</div>'; return; }
  const r = window._v2LegacyRollup(rows);
  const delta = r.totalAvg - r.beforeAvg;
  const sign = delta > 0 ? '+' : '';

  wrap.innerHTML = `
    <div class="v2-rollup">
      <div class="v2-rollup-main">
        <div class="v2-rollup-figure">
          <span class="from">${r.beforeAvg}%</span>
          <span class="arrow" aria-hidden="true">→</span>
          <span class="to">${r.totalAvg}%</span>
          <span class="delta ${delta >= 0 ? 'up' : 'down'}">${sign}${delta}%p</span>
        </div>
        <p class="v2-rollup-copy">
          원과제 80건의 자체 진척률 평균은 <b>${r.beforeAvg}%</b>였습니다.
          이 중 <b>${r.linkedCount}건</b>이 AI 과제 25건에 흡수되면서
          <b>자체 값과 상위 과제 진척률 중 높은 쪽</b>을 안분받아, 전체 평균이 <b>${r.totalAvg}%</b>가 됩니다.
          이미 자체 진척이 더 앞선 과제는 그 값을 그대로 지키므로 수치가 내려가지 않습니다.
        </p>
      </div>
      <div class="v2-rollup-side">
        <div class="v2-rollup-stat"><span class="k">안분 반영 (${r.linkedCount}건)</span><span class="v">${r.linkedAvg}%</span></div>
        <div class="v2-rollup-stat"><span class="k">자체 유지 (${r.ownCount}건)</span><span class="v">${r.ownCount ? Math.round(rows.filter(x => !x._연동).reduce((s, x) => s + (x.진척률 || 0), 0) / r.ownCount * 100) : 0}%</span></div>
        <div class="v2-rollup-stat total"><span class="k">전체 80건</span><span class="v">${r.totalAvg}%</span></div>
      </div>
    </div>`;
}

function v2ChartFont(size) { return { family: "'Pretendard',sans-serif", size: size || 11 }; }
function v2Muted() { return getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim() || '#667085'; }
function v2Grid() { return getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#F3F4F6'; }

function renderV2AgentChart() {
  const cv = document.getElementById('v2ChartAgent');
  if (!cv) return;
  v2DestroyChart('agent');
  const rows = V2_AGENTS.map(a => {
    const ts = v2data.filter(t => t.agentNo === a.no);
    const scored = ts.filter(t => !t.planned);
    return {
      label: a.code + ' ' + a.name,
      count: ts.length,
      avg: scored.length ? Math.round(scored.reduce((s, t) => s + t.progress, 0) / scored.length) : 0
    };
  });
  v2charts.agent = new Chart(cv, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.label),
      datasets: [{
        label: '평균 진척률(%)', data: rows.map(r => r.avg),
        backgroundColor: rows.map(r => r.avg >= 100 ? '#147B52' : r.avg > 0 ? '#3FA97F' : '#D0D5DD'),
        borderRadius: 4, barThickness: 14
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { footer: items => '과제 ' + rows[items[0].dataIndex].count + '건' } }
      },
      scales: {
        x: { max: 100, grid: { color: v2Grid(), drawBorder: false }, ticks: { font: v2ChartFont(), color: v2Muted(), callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { font: v2ChartFont(11), color: v2Muted() } }
      }
    }
  });
}

function renderV2PersonChart() {
  const cv = document.getElementById('v2ChartPerson');
  if (!cv) return;
  v2DestroyChart('person');
  const map = {};
  v2Scored().forEach(t => {
    (t.person ? t.person.split(',') : ['미지정']).map(s => s.trim()).filter(Boolean).forEach(p => {
      (map[p] = map[p] || { n: 0, sum: 0 }); map[p].n++; map[p].sum += t.progress;
    });
  });
  const names = Object.keys(map).sort((a, b) => map[b].n - map[a].n);
  v2charts.person = new Chart(cv, {
    type: 'bar',
    data: {
      labels: names,
      datasets: [
        { label: '담당 과제 수', data: names.map(n => map[n].n), backgroundColor: '#147B52', borderRadius: 4, yAxisID: 'y', barThickness: 26 },
        { label: '평균 진척률(%)', type: 'line', data: names.map(n => Math.round(map[n].sum / map[n].n)), borderColor: '#F59E0B', backgroundColor: '#F59E0B', yAxisID: 'y1', tension: .3, pointRadius: 4, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', font: v2ChartFont(12), color: v2Muted(), padding: 14 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: v2ChartFont(), color: v2Muted() } },
        y: { beginAtZero: true, grid: { color: v2Grid(), drawBorder: false }, ticks: { precision: 0, font: v2ChartFont(), color: v2Muted() } },
        y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { font: v2ChartFont(), color: v2Muted(), callback: v => v + '%' } }
      }
    }
  });
}

function renderV2QuarterChart() {
  const cv = document.getElementById('v2ChartQuarter');
  if (!cv) return;
  v2DestroyChart('quarter');
  const order = ['2026 Q2', '2026 Q3', '2026 Q4', '미정'];
  const map = {}; order.forEach(q => map[q] = { 착수: 0, 미착수: 0 });
  v2data.forEach(t => {
    const q = order.includes(t.target) ? t.target : '미정';
    map[q][t.status === '착수' ? '착수' : '미착수']++;
  });
  v2charts.quarter = new Chart(cv, {
    type: 'bar',
    data: {
      labels: order,
      datasets: [
        { label: '착수', data: order.map(q => map[q].착수), backgroundColor: '#147B52', borderRadius: 4, barThickness: 40 },
        { label: '미착수', data: order.map(q => map[q].미착수), backgroundColor: '#D0D5DD', borderRadius: 4, barThickness: 40 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', font: v2ChartFont(12), color: v2Muted(), padding: 14 } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: v2ChartFont(12), color: v2Muted() } },
        y: { stacked: true, beginAtZero: true, grid: { color: v2Grid(), drawBorder: false }, ticks: { precision: 0, font: v2ChartFont(), color: v2Muted() } }
      }
    }
  });
}

/** 진척률 원장 — 과제별 한 줄, 밀도 우선 */
function renderV2Ledger() {
  const wrap = document.getElementById('v2Ledger');
  if (!wrap) return;
  wrap.innerHTML = V2_AGENTS.map(a => {
    const ts = v2data.filter(t => t.agentNo === a.no);
    return `<div class="v2-ledger-group">
      <div class="v2-ledger-head"><span class="code">${a.code}</span><span class="nm">${escapeHtml(a.name)}</span><span class="cnt">과제 ${ts.length}건</span></div>
      ${ts.map(t => `
        <div class="v2-ledger-row" onclick="openV2Edit(${t.no})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')openV2Edit(${t.no})">
          <span class="no">${t.no}</span>
          <span class="ttl">${escapeHtml(t.title)}</span>
          <span class="own">${escapeHtml(t.person || '미지정')}</span>
          <span class="bar"><i style="width:${t.progress}%"></i></span>
          <span class="pct${t.progress >= 100 ? ' full' : ''}">${t.planned ? '-' : t.progress + '%'}</span>
        </div>`).join('')}
    </div>`;
  }).join('');
}

/* ══ AI 과제 25건 ════════════════════════════════════════════ */
function renderV2Tasks() {
  const body = document.getElementById('v2TaskBody');
  if (!body) return;
  const fAgent = document.getElementById('v2FilterAgent')?.value || '';
  const fPerson = document.getElementById('v2FilterPerson')?.value || '';
  const fStatus = document.getElementById('v2FilterStatus')?.value || '';
  const q = (document.getElementById('v2Search')?.value || '').trim().toLowerCase();

  const rows = v2data.filter(t => {
    if (fAgent && String(t.agentNo) !== fAgent) return false;
    if (fPerson && !(t.person || '').includes(fPerson)) return false;
    if (fStatus && (t.status || '미착수') !== fStatus) return false;
    if (q) {
      const hay = [t.title, t.agent, t.impl, t.flow, t.out, t.person, t.note].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!rows.length) {
    body.innerHTML = `<div class="v2-empty">
      <p class="t">조건에 맞는 과제가 없습니다.</p>
      <p class="d">필터를 넓히거나 초기화하면 25건 전체를 볼 수 있습니다.</p>
      <button class="btn btn-outline" onclick="resetV2Filter()">필터 초기화</button>
    </div>`;
  } else {
    body.innerHTML = rows.map(t => v2TaskCard(t)).join('');
  }

  const scored = rows.filter(t => !t.planned);
  const stat = document.getElementById('v2TaskStats');
  if (stat) stat.innerHTML = `
    <div class="stat-chip">표시 <span>${rows.length}</span>건</div>
    <div class="stat-chip">착수 <span>${rows.filter(t => t.status === '착수').length}</span>건</div>
    <div class="stat-chip">미착수 <span>${rows.filter(t => t.status !== '착수').length}</span>건</div>
    <div class="stat-chip">평균 진척률 <span>${scored.length ? Math.round(scored.reduce((s, t) => s + t.progress, 0) / scored.length) : 0}</span>%</div>
    <div class="stat-chip">흡수 원과제 <span>${rows.reduce((s, t) => s + t.origins.length, 0)}</span>건</div>`;
}

function v2TaskCard(t) {
  const ag = v2Agent(t.agentNo);
  const pct = t.progress || 0;
  const origins = t.origins.map(o => {
    const l = V2_LEGACY_BY_NO[o];
    return `<button class="v2-origin" onclick="goToTask(${o})" title="${escapeHtml(l ? l.task.replace(/\s+/g, ' ').slice(0, 90) : '')}">#${o}</button>`;
  }).join('');

  return `<article class="v2-card${t.planned ? ' planned' : ''}">
    <header class="v2-card-head">
      <div class="v2-card-id">
        <span class="v2-no">${t.no}</span>
        <span class="v2-agent-tag">${ag ? ag.code : ''} ${escapeHtml(ag ? ag.name : t.agent)}</span>
      </div>
      <div class="v2-card-actions">
        <span class="v2-status ${t.status === '착수' ? 'on' : 'off'}">${t.status || '미착수'}</span>
        <button class="btn btn-outline btn-sm" onclick="openV2Edit(${t.no})">수정</button>
      </div>
    </header>

    <h3 class="v2-card-title">${escapeHtml(t.title)}</h3>

    <div class="v2-progress">
      <div class="v2-progress-track"><i style="width:${pct}%" class="${pct >= 100 ? 'full' : ''}"></i></div>
      <span class="v2-progress-val${pct >= 100 ? ' full' : ''}">${t.planned ? '권한 대기' : pct + '%'}</span>
    </div>

    <dl class="v2-spec">
      ${t.impl ? `<div><dt>구현</dt><dd>${escapeHtml(t.impl)}</dd></div>` : ''}
      ${t.flow ? `<div><dt>작동</dt><dd>${escapeHtml(t.flow)}</dd></div>` : ''}
      ${t.out ? `<div><dt>산출물</dt><dd>${escapeHtml(t.out)}</dd></div>` : ''}
    </dl>

    <footer class="v2-card-foot">
      <div class="v2-meta">
        <span><b>담당</b> ${escapeHtml(t.person || '미지정')}</span>
        <span><b>목표</b> ${escapeHtml(t.target || '미정')}</span>
        ${t.note ? `<span class="warn"><b>제약</b> ${escapeHtml(t.note)}</span>` : ''}
      </div>
      <div class="v2-origins">
        <span class="v2-origins-label">흡수 원과제 ${t.origins.length}건</span>
        ${origins}
      </div>
    </footer>
  </article>`;
}

function resetV2Filter() {
  ['v2FilterAgent', 'v2FilterPerson', 'v2FilterStatus'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const s = document.getElementById('v2Search'); if (s) s.value = '';
  renderV2Tasks();
}

function populateV2Filters() {
  const ag = document.getElementById('v2FilterAgent');
  if (ag && ag.options.length <= 1) {
    V2_AGENTS.forEach(a => { const o = document.createElement('option'); o.value = a.no; o.textContent = a.code + ' ' + a.name; ag.appendChild(o); });
  }
  const pe = document.getElementById('v2FilterPerson');
  if (pe && pe.options.length <= 1) {
    const set = new Set();
    v2data.forEach(t => (t.person || '').split(',').map(s => s.trim()).filter(Boolean).forEach(p => set.add(p)));
    [...set].sort().forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; pe.appendChild(o); });
  }
}

/* ══ AI 에이전트 16개 ════════════════════════════════════════ */
function renderV2Agents() {
  const wrap = document.getElementById('v2AgentGrid');
  if (!wrap) return;
  wrap.innerHTML = V2_AGENTS.map(a => {
    const ts = v2data.filter(t => t.agentNo === a.no);
    const scored = ts.filter(t => !t.planned);
    const avg = scored.length ? Math.round(scored.reduce((s, t) => s + t.progress, 0) / scored.length) : 0;
    const absorbed = ts.reduce((s, t) => s + t.origins.length, 0);
    const people = [...new Set(ts.flatMap(t => (t.person || '').split(',').map(s => s.trim()).filter(Boolean)))];
    return `<article class="v2-agent">
      <header class="v2-agent-head">
        <span class="v2-agent-code">${a.code}</span>
        <h3>${escapeHtml(a.name)}</h3>
      </header>
      <div class="v2-agent-stats">
        <div><span class="k">과제</span><span class="v">${ts.length}</span></div>
        <div><span class="k">흡수 원과제</span><span class="v">${absorbed}</span></div>
        <div><span class="k">평균 진척률</span><span class="v accent">${avg}%</span></div>
      </div>
      <ul class="v2-agent-tasks">
        ${ts.map(t => `<li onclick="openV2Edit(${t.no})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')openV2Edit(${t.no})">
          <span class="n">${t.no}</span>
          <span class="t">${escapeHtml(t.title)}</span>
          <span class="p${t.progress >= 100 ? ' full' : ''}">${t.planned ? '-' : t.progress + '%'}</span>
        </li>`).join('')}
      </ul>
      <footer class="v2-agent-foot">${people.length ? escapeHtml(people.join(', ')) : '담당자 미지정'}</footer>
    </article>`;
  }).join('');

  renderV2BeforeAfter();
}

/** 기존 18개 → 신규 16개 */
function renderV2BeforeAfter() {
  const wrap = document.getElementById('v2BeforeAfter');
  if (!wrap) return;
  const newCodes = new Set(V2_AGENTS.map(a => a.code));
  wrap.innerHTML = `
    <div class="v2-ba-grid">
      ${V2_OLD_AGENTS.map(o => {
        const code = (o.name.match(/^([AB]-\d+)/) || [])[1] || '';
        const kept = newCodes.has(code);
        const dest = [...new Set(o.origins.map(n => V2_LINK[n]).filter(Boolean))].sort((a, b) => a - b);
        return `<div class="v2-ba-row ${kept ? 'kept' : 'gone'}">
          <span class="v2-ba-code">${code}</span>
          <span class="v2-ba-name">${escapeHtml(o.name.replace(/^[AB]-\d+\.\s*/, ''))}</span>
          <span class="v2-ba-origins">원과제 ${o.origins.length}건</span>
          <span class="v2-ba-arrow" aria-hidden="true">→</span>
          <span class="v2-ba-dest">${dest.length
            ? dest.map(d => `<button class="v2-chip" onclick="goToV2Task(${d})">과제 ${d}</button>`).join('')
            : '<span class="v2-ba-none">신과제 없음 (전건 제외)</span>'}</span>
        </div>`;
      }).join('')}
    </div>`;
}

/* ══ 전환 매핑 (80 → 25) ═════════════════════════════════════ */
function renderV2Map() {
  const body = document.getElementById('v2MapBody');
  if (!body) return;
  const fAction = document.getElementById('v2MapAction')?.value || '';
  const q = (document.getElementById('v2MapSearch')?.value || '').trim().toLowerCase();
  const rows = window._dashData || [];
  const byNo = Object.fromEntries(rows.map(r => [r.no, r]));

  const list = V2_LEGACY.filter(l => {
    if (fAction && l.action !== fAction) return false;
    if (q && ![l.task, l.reason, l.oldAgent].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });

  const cnt = document.getElementById('v2MapCount');
  if (cnt) cnt.textContent = '원과제 80건 중 ' + list.length + '건 표시';

  body.innerHTML = list.map(l => {
    const meta = V2_ACTION_META[l.action] || { tone: 'mute' };
    const t = l.to ? v2Task(l.to) : null;
    const live = byNo[l.no];
    const before = live ? Math.round((live._자체진척률 || 0) * 100) : null;
    const after = t ? (t.planned ? null : t.progress) : null;
    const diff = (before !== null && after !== null) ? after - before : null;
    return `<tr>
      <td class="v2m-no"><button class="v2-linkno" onclick="goToTask(${l.no})">#${l.no}</button></td>
      <td class="v2m-task">
        <span class="v2m-task-t">${escapeHtml(l.task.replace(/\s+/g, ' '))}</span>
        <span class="v2m-task-a">${escapeHtml(l.oldAgent || '미배정')}</span>
      </td>
      <td class="v2m-act"><span class="v2-tag ${meta.tone}">${l.action}</span></td>
      <td class="v2m-dest">${t
        ? `<button class="v2-chip" onclick="goToV2Task(${t.no})">과제 ${t.no}</button><span class="v2m-dest-t">${escapeHtml(t.title)}</span>`
        : '<span class="v2m-none">AI 과제 없음</span>'}</td>
      <td class="v2m-prog">${after !== null
        ? `<span class="v2m-before">${before !== null ? before + '%' : '-'}</span><span class="v2m-arrow" aria-hidden="true">→</span><span class="v2m-after">${after}%</span>${diff !== null && diff !== 0 ? `<span class="v2m-diff ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${diff}%p</span>` : ''}`
        : `<span class="v2m-hold">${l.to ? '권한 대기' : '자체 유지'}</span>`}</td>
      <td class="v2m-why">
        ${escapeHtml(l.reason || '')}
        ${l.history ? `<span class="v2m-hist">${escapeHtml(l.history)}</span>` : ''}
        ${l.fix ? `<span class="v2m-fix">${escapeHtml(l.fix)}</span>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function populateV2MapFilter() {
  const sel = document.getElementById('v2MapAction');
  if (!sel || sel.options.length > 1) return;
  const counts = {};
  V2_LEGACY.forEach(l => counts[l.action] = (counts[l.action] || 0) + 1);
  Object.keys(V2_ACTION_META).forEach(k => {
    if (!counts[k]) return;
    const o = document.createElement('option'); o.value = k; o.textContent = `${k} (${counts[k]})`; sel.appendChild(o);
  });
}

function resetV2Map() {
  const a = document.getElementById('v2MapAction'); if (a) a.value = '';
  const s = document.getElementById('v2MapSearch'); if (s) s.value = '';
  renderV2Map();
}

/* ══ 제외 과제 12건 ══════════════════════════════════════════ */
function renderV2Excluded() {
  const wrap = document.getElementById('v2ExcludedWrap');
  if (!wrap) return;
  const groups = {};
  V2_LEGACY.filter(l => !l.to).forEach(l => (groups[l.action] = groups[l.action] || []).push(l));
  const order = ['AX취소', '비AI이관', '범용도구', '수기유지'];

  wrap.innerHTML = order.filter(k => groups[k]).map(k => {
    const meta = V2_ACTION_META[k];
    return `<section class="v2-ex-group">
      <header class="v2-ex-head">
        <span class="v2-tag ${meta.tone} lg">${k}</span>
        <span class="v2-ex-count">${groups[k].length}건</span>
        <p class="v2-ex-desc">${meta.desc}</p>
      </header>
      <div class="v2-ex-list">
        ${groups[k].map(l => `<div class="v2-ex-item">
          <button class="v2-linkno" onclick="goToTask(${l.no})">#${l.no}</button>
          <div class="v2-ex-body">
            <p class="t">${escapeHtml(l.task.replace(/\s+/g, ' '))}</p>
            <p class="r">${escapeHtml(l.reason || '')}</p>
          </div>
          <span class="v2-ex-agent">${escapeHtml(l.oldAgent || '미배정')}</span>
        </div>`).join('')}
      </div>
    </section>`;
  }).join('');
}

/* ══ 편집 ════════════════════════════════════════════════════ */
const V2_EDIT_FIELDS = { title: 'v2m_title', impl: 'v2m_impl', flow: 'v2m_flow', out: 'v2m_out', person: 'v2m_person', target: 'v2m_target', note: 'v2m_note' };

function openV2Edit(no) {
  const t = v2Task(no);
  if (!t) return;
  v2EditNo = no;
  const ag = v2Agent(t.agentNo);
  document.getElementById('v2ModalTitle').textContent = `과제 ${t.no} 수정`;
  document.getElementById('v2ModalAgent').textContent = ag ? ag.code + ' ' + ag.name : t.agent;
  Object.entries(V2_EDIT_FIELDS).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.value = t[k] || ''; });
  document.getElementById('v2m_status').value = t.status || '미착수';
  document.getElementById('v2m_progress').value = t.progress || 0;
  document.getElementById('v2m_progress_val').textContent = (t.progress || 0) + '%';
  document.getElementById('v2m_memo').value = '';

  const origins = t.origins.map(o => `#${o}`).join(', ');
  document.getElementById('v2ModalOrigins').innerHTML = t.origins.length
    ? `이 과제의 진척률은 흡수한 원과제 <b>${t.origins.length}건</b>(${origins})에 안분 반영됩니다.
       원과제는 자체 값과 이 과제의 값 중 <b>높은 쪽</b>을 표시하고, 착수상태는 이 과제를 그대로 따릅니다.`
    : '흡수한 원과제가 없습니다.';

  document.getElementById('v2EditModal').classList.add('open');
}

function closeV2Modal() { document.getElementById('v2EditModal').classList.remove('open'); v2EditNo = null; }

function saveV2Edit() {
  if (v2EditNo === null) return;
  const t = v2Task(v2EditNo);
  if (!t) return;
  const before = JSON.parse(JSON.stringify(t));
  const 변경내역 = {};

  Object.entries(V2_EDIT_FIELDS).forEach(([k, id]) => {
    const el = document.getElementById(id); if (!el) return;
    const v = el.value.trim();
    if ((t[k] || '') !== v) 변경내역[k] = { 이전: t[k] || '', 이후: v };
    t[k] = v;
  });

  const st = document.getElementById('v2m_status').value;
  if ((t.status || '') !== st) 변경내역['착수상태'] = { 이전: t.status || '', 이후: st };
  t.status = st;

  const pg = parseInt(document.getElementById('v2m_progress').value, 10) || 0;
  if ((t.progress || 0) !== pg) 변경내역['진척률'] = { 이전: (t.progress || 0) + '%', 이후: pg + '%' };
  t.progress = pg;
  if (pg > 0) t.planned = false;

  const now = new Date();
  t._수정일 = now.toLocaleDateString('ko-KR');
  t._수정ts = now.getTime();

  if (Object.keys(변경내역).length) {
    const memo = document.getElementById('v2m_memo').value.trim();
    if (typeof window._firebaseSaveLog === 'function') {
      window._firebaseSaveLog({
        트랙: '재편', no: t.no, 태스크: t.title, 변경내역, 메모: memo,
        수정시각: now.toLocaleString('ko-KR'), _ts: now.getTime()
      });
    }
  }

  if (typeof window._firebaseSaveV2 === 'function') window._firebaseSaveV2(t.no, v2Serialize(t));

  closeV2Modal();
  v2Refresh();
  showToast(`과제 ${t.no} 저장 · 원과제 ${before.origins.length}건에 안분 반영`);
}

function v2Serialize(t) {
  return {
    no: t.no, title: t.title, impl: t.impl, flow: t.flow, out: t.out,
    person: t.person, status: t.status, progress: t.progress, planned: !!t.planned,
    target: t.target, note: t.note, _수정일: t._수정일 || '', _수정ts: t._수정ts || 0
  };
}

/* ── Firebase 수신 ─────────────────────────────────────────── */
const V2_SYNC_ALWAYS = ['status', 'progress', 'planned', 'target', 'note', '_수정일', '_수정ts'];
const V2_SYNC_AFTER_VERSION = ['title', 'impl', 'flow', 'out', 'person'];

window._applyRemoteV2 = function (remote) {
  Object.entries(remote).forEach(([key, val]) => {
    const t = v2Task(Number(key));
    if (!t) return;
    V2_SYNC_ALWAYS.forEach(f => { if (val[f] !== undefined) t[f] = val[f]; });
    if ((parseFloat(val._수정ts) || 0) > V2_VERSION_TS) {
      V2_SYNC_AFTER_VERSION.forEach(f => { if (val[f] !== undefined) t[f] = val[f]; });
    }
    t.progress = parseInt(t.progress, 10) || 0;
  });
  v2Refresh();
};

/** 재편 트랙 값이 바뀌면 원과제 트랙까지 다시 계산해 그린다 */
function v2Refresh() {
  if (window._dashData) {
    window._v2ApplyProration(window._dashData);
    if (typeof window._legacyRerender === 'function') window._legacyRerender();
  }
  const active = document.querySelector('.tab-content.active');
  if (!active) return;
  switch (active.id) {
    case 'tab-v2-dashboard': renderV2Dashboard(); break;
    case 'tab-v2-tasks': renderV2Tasks(); break;
    case 'tab-v2-agents': renderV2Agents(); break;
    case 'tab-v2-map': renderV2Map(); break;
    case 'tab-v2-excluded': renderV2Excluded(); break;
    default: renderV2Dashboard();
  }
}
window._v2Refresh = v2Refresh;

/* ── 탭 이동 ───────────────────────────────────────────────── */
function goToV2Task(no) {
  const nav = document.querySelector('.tab[data-tab="v2-tasks"]');
  switchTab('v2-tasks', nav);
  resetV2Filter();
  const s = document.getElementById('v2Search');
  if (s) { s.value = ''; }
  setTimeout(() => {
    const cards = document.querySelectorAll('#v2TaskBody .v2-card');
    const card = [...cards].find(c => c.querySelector('.v2-no')?.textContent === String(no));
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1600); }
  }, 120);
}

/* ── 진입점 ───────────────────────────────────────────────── */
window._v2Render = function (tabId) {
  populateV2Filters();
  populateV2MapFilter();
  switch (tabId) {
    case 'v2-dashboard': renderV2Dashboard(); break;
    case 'v2-tasks': renderV2Tasks(); break;
    case 'v2-agents': renderV2Agents(); break;
    case 'v2-map': renderV2Map(); break;
    case 'v2-excluded': renderV2Excluded(); break;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  populateV2Filters();
  populateV2MapFilter();
  const src = document.getElementById('v2Source');
  if (src) src.textContent = `${V2_SOURCE.label} · ${V2_SOURCE.file} (${V2_SOURCE.date})`;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeV2Modal(); });

  // 재편 대시보드가 기본 화면이므로 최초 1회 직접 그린다 (switchTab을 거치지 않음)
  document.body.dataset.track = 'v2';
  const label = document.getElementById('tbTrackLabel');
  if (label) label.textContent = '재편 트랙';
  renderV2Dashboard();
});

// 사이드바 이동 시 상단 트랙 표시를 맞춘다
document.addEventListener('click', e => {
  const nav = e.target.closest('.tab[data-tab]');
  if (!nav) return;
  const label = document.getElementById('tbTrackLabel');
  if (label) label.textContent = nav.dataset.tab.startsWith('v2-') ? '재편 트랙' : '과거 트랙 · 원과제 80건';
});
