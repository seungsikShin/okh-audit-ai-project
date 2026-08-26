/* ══════════════════════════════════════════════════════════
   월간 보고 장표 (monthly.js)
   ─ 상단: AI 과제 진척 현황 — 매월 마지막 주 월요일 기준.
     확정 저장된 달은 Firebase 값으로 고정, 이번 달은 라이브 값.
   ─ 하단: 주요 추진 과제 — 재편 25건에서 클릭으로 작성,
     확정 저장 시 okh_audit/monthly/<YYYY_MM> 에 제출본으로 고정.
   ─ 수치 정의는 대시보드와 동일: 안분(_v2ApplyProration) 반영된
     _dashData 기준, AI 적용 대상 = isAiUseRow, 완료 = 진척률 100%·착수.
══════════════════════════════════════════════════════════ */

const MONTHLY_DB = 'https://ai-audit-project-c66bb-default-rtdb.asia-southeast1.firebasedatabase.app/okh_audit/monthly';

let monthlyStore = null;        // { '2026_08': {...확정본}, ... }
const monthlySel = [];          // 이번 달 선택된 재편 과제 no (클릭 순서)
let monthlyViewKey = null;      // 과거 제출본 조회 중이면 해당 월 키

/* 장표 고정 주석 — 상단 표 하단에 항상 표기, 확정본에도 저장됨 */
const MONTHLY_FOOTNOTE = '미 배정 과제 2건 : 정보계 데이터 상시분석, 부정행위 상시 모니터링';

/* ── 날짜: 해당 월의 마지막 주 월요일 ── */
function lastMondayOf(year, month /* 0-based */) {
  const last = new Date(year, month + 1, 0);
  const back = (last.getDay() + 6) % 7;   // 월=0 … 일=6
  return new Date(year, month, last.getDate() - back);
}
function monthlyKeyOf(d) { return d.getFullYear() + '_' + String(d.getMonth() + 1).padStart(2, '0'); }
function monthlyLabelOf(key) { const [y, m] = key.split('_'); return y + '년 ' + parseInt(m, 10) + '월'; }
function fmtMD(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

/* ── 상단 KPI 계산 (라이브) ── */
function monthlyKpis() {
  const rows = Array.isArray(window._dashData) ? window._dashData : [];
  const empty = { tot: 0, target: 0, rate: 0, q2: 0, q3: 0, q4: 0, h1: 0, h2: 0, started: 0, startedRate: 0, done: 0, doneRate: 0 };
  if (!rows.length || typeof isAiUseRow !== 'function') return empty;
  const target = rows.filter(isAiUseRow);
  const norm = s => String(s || '').trim();
  const q = { q2: 0, q3: 0, q4: 0, h1: 0, h2: 0 };
  target.forEach(r => {
    const k = norm(r.목표완료);
    if (k === '2026 Q2') q.q2++;
    else if (k === '2026 Q3') q.q3++;
    else if (k === '2026 Q4') q.q4++;
    else if (k.includes('2027') && (k.includes('상') || k.toUpperCase().includes('H1'))) q.h1++;
    else if (k.includes('2027')) q.h2++;
  });
  const started = target.filter(r => r.착수상태 === '착수').length;
  const done = target.filter(r => (r.진척률 || 0) >= 1 && r.착수상태 === '착수').length;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  return {
    tot: rows.length, target: target.length, rate: pct(target.length, rows.length),
    q2: q.q2, q3: q.q3, q4: q.q4, h1: q.h1, h2: q.h2,
    started, startedRate: pct(started, target.length),
    done, doneRate: pct(done, target.length),
  };
}

/* ── Firebase: 저장본 로드 / 저장 ── */
function monthlyLoad() {
  return fetch(MONTHLY_DB + '.json', { cache: 'no-store' })
    .then(r => r.json())
    .then(d => { monthlyStore = d || {}; })
    .catch(() => { if (monthlyStore === null) monthlyStore = {}; });
}

function monthlySave() {
  if (monthlyViewKey) { monthlyViewKey = null; renderMonthly(); return; }   // 조회 중이면 이번 달로 복귀
  const now = new Date();
  const key = monthlyKeyOf(now);
  if (monthlyStore && monthlyStore[key]) {
    if (!confirm(monthlyLabelOf(key) + ' 장표가 이미 확정되어 있습니다. 덮어쓸까요?')) return;
  }
  const items = [];
  document.querySelectorAll('#monthlyItems .monthly-item-row').forEach(tr => {
    items.push({
      no: parseInt(tr.dataset.no, 10),
      body: tr.querySelector('.cell-body').innerText.trim(),
      note: tr.querySelector('.cell-note').innerText.trim(),
    });
  });
  if (!items.length && !confirm('주요 추진 과제가 비어 있습니다. 상단 표만 확정 저장할까요?')) return;
  const anchor = lastMondayOf(now.getFullYear(), now.getMonth());
  const payload = {
    label: monthlyLabelOf(key),
    기준일: anchor.getFullYear() + '-' + String(anchor.getMonth() + 1).padStart(2, '0') + '-' + String(anchor.getDate()).padStart(2, '0'),
    savedAt: now.getTime(),
    savedAtText: now.toLocaleString('ko-KR'),
    top: monthlyKpis(),
    footnote: MONTHLY_FOOTNOTE,
    items,
  };
  fetch(MONTHLY_DB + '/' + key + '.json', { method: 'PUT', body: JSON.stringify(payload) })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(() => {
      monthlyStore[key] = payload;
      if (typeof showToast === 'function') showToast(monthlyLabelOf(key) + ' 장표 확정 저장 완료');
      renderMonthly();
    })
    .catch(e => { if (typeof showToast === 'function') showToast('저장 실패: ' + e.message); });
}

function monthlyClear() { monthlySel.length = 0; renderMonthlyBottom(); }

/* ── 렌더: 상단 표 ── */
const MONTHLY_COLS = ['tot', 'target', 'rate', 'q2', 'q3', 'q4', 'h1', 'h2', 'started', 'startedRate', 'done', 'doneRate'];

function renderMonthlyTop() {
  const el = document.getElementById('monthlyTopTable');
  if (!el) return;
  const now = new Date();
  const curKey = monthlyKeyOf(now);
  const anchor = lastMondayOf(now.getFullYear(), now.getMonth());
  const saved = Object.entries(monthlyStore || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const curSaved = monthlyStore && monthlyStore[curKey];

  const rows = saved.filter(([k]) => k !== curKey).map(([k, v]) => ({ key: k, label: v.label || monthlyLabelOf(k), top: v.top, fixed: true, sub: (v.기준일 || '').slice(5).replace('-', '/') + ' 확정' }));
  if (curSaved) rows.push({ key: curKey, label: curSaved.label, top: curSaved.top, fixed: true, cur: true, sub: '확정 저장됨' });
  else rows.push({ key: curKey, label: monthlyLabelOf(curKey), top: monthlyKpis(), fixed: false, cur: true, sub: '기준일 ' + fmtMD(anchor) + '(월) · 작성중' });

  const tag = document.getElementById('monthlyTopTag');
  if (tag) tag.textContent = curSaved
    ? monthlyLabelOf(curKey) + ' 확정 저장됨 (' + (curSaved.savedAtText || '') + ')'
    : '이번 달 기준일 ' + fmtMD(anchor) + '(월)' + (now >= anchor ? ' — 확정 대기' : '');

  el.innerHTML = `<table class="monthly-table">
    <thead>
      <tr>
        <th rowspan="2" class="mth">월</th>
        <th colspan="3" class="grp">업무 과제</th>
        <th colspan="5" class="grp">AI 개발 완료 시점</th>
        <th colspan="2" class="grp">착수</th>
        <th colspan="2" class="grp">완료</th>
        <th rowspan="2" class="mth">비고</th>
      </tr>
      <tr>
        <th>총 과제</th><th>AI 적용<br>대상</th><th>AI 적용률<br>(%)</th>
        <th>'26 2Q</th><th>3Q</th><th>4Q</th><th>'27 상반기</th><th>하반기</th>
        <th>과제수</th><th>착수율<br>(%)</th><th>과제수</th><th>완료율<br>(%)</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `<tr class="${r.cur ? 'cur' : ''}${r.fixed ? '' : ' draft'}${monthlyViewKey === r.key ? ' sel' : ''} clickable"
        onclick="monthlyViewMonth('${r.key}')" title="${r.cur ? '이번 달 장표' : r.label + ' 제출본 보기'}">
        <td class="mth">${escapeHtml(r.label)}</td>
        ${MONTHLY_COLS.map(c => `<td>${r.top ? (r.top[c] ?? '') : ''}</td>`).join('')}
        <td class="sub">${escapeHtml(r.sub || '')}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p class="monthly-footnote">${escapeHtml(MONTHLY_FOOTNOTE)}</p>`;
}

/* 상단 표에서 월 클릭 → 해당 달 제출본 조회 (이번 달 클릭 시 편집으로 복귀) */
function monthlyViewMonth(key) {
  const curKey = monthlyKeyOf(new Date());
  monthlyViewKey = (key === curKey || !monthlyStore || !monthlyStore[key]) ? null : key;
  renderMonthly();
}

/* ── 렌더: 하단 과제 선택 + 장표 ── */
function monthlyDefaultBody(t) {
  const first = String(t.impl || '').split(/(?<=[함음됨임])\.?\s/)[0] || '';
  const second = String(t.out || '').split(',')[0] || '';
  let s = t.title;
  if (first) s += '\n- ' + first.trim().replace(/\.$/, '');
  if (second) s += '\n- 산출물: ' + second.trim();
  return s;
}

function renderMonthlyBottom() {
  const picker = document.getElementById('monthlyPicker');
  const itemsEl = document.getElementById('monthlyItems');
  if (!picker || !itemsEl) return;
  const now = new Date();
  const curKey = monthlyKeyOf(now);
  const curSaved = monthlyStore && monthlyStore[curKey];
  const tasks = (typeof v2data !== 'undefined' ? v2data : []).slice().sort((a, b) => a.no - b.no);

  /* 과거 제출본 조회 모드 */
  if (monthlyViewKey && monthlyStore && monthlyStore[monthlyViewKey]) {
    const past = monthlyStore[monthlyViewKey];
    picker.innerHTML = `<div class="monthly-fixed-note"><b>${escapeHtml(past.label || monthlyLabelOf(monthlyViewKey))} 제출본</b>을 조회하고 있습니다.<br>
      확정 ${escapeHtml(past.savedAtText || '')} · 기준일 ${escapeHtml(past.기준일 || '')}<br>
      상단 표에서 이번 달을 클릭하거나 오른쪽 버튼을 누르면 돌아갑니다.</div>`;
    itemsEl.innerHTML = monthlyItemsTable(past.items || [], true);
    const vbtn = document.getElementById('monthlySaveBtn');
    if (vbtn) vbtn.textContent = '이번 달 장표로 돌아가기';
    return;
  }

  if (curSaved) {
    picker.innerHTML = `<div class="monthly-fixed-note">이 달 장표가 확정되어 선택이 잠겼습니다.<br>수정하려면 다시 저장해 덮어쓰면 됩니다.</div>`
      + tasks.map(t => {
        const inSaved = (curSaved.items || []).some(i => i.no === t.no);
        return `<button class="monthly-pick${inSaved ? ' on' : ''}" onclick="monthlyUnlock(${t.no})">
          <span class="no">${t.no}</span><span class="tt">${escapeHtml(t.title)}</span><span class="pv">${t.planned ? '대기' : (t.progress || 0) + '%'}</span>
        </button>`;
      }).join('');
    itemsEl.innerHTML = monthlyItemsTable(curSaved.items || [], true);
    const btn = document.getElementById('monthlySaveBtn');
    if (btn) btn.textContent = '다시 확정 저장 (덮어쓰기)';
    return;
  }

  const btn = document.getElementById('monthlySaveBtn');
  if (btn) btn.textContent = '이 달 장표 확정 저장';
  picker.innerHTML = tasks.map(t => `
    <button class="monthly-pick${monthlySel.includes(t.no) ? ' on' : ''}" onclick="monthlyTogglePick(${t.no})">
      <span class="no">${t.no}</span><span class="tt">${escapeHtml(t.title)}</span><span class="pv">${t.planned ? '대기' : (t.progress || 0) + '%'}</span>
    </button>`).join('');

  const items = monthlySel.map(no => {
    const t = tasks.find(x => x.no === no);
    return t ? { no: t.no, body: monthlyDefaultBody(t), note: t.note || '' } : null;
  }).filter(Boolean);
  itemsEl.innerHTML = monthlyItemsTable(items, false);
}

function monthlyItemsTable(items, fixed) {
  if (!items.length) return `<div class="monthly-empty">왼쪽에서 과제를 클릭하면 여기에 작성됩니다.</div>`;
  return `<table class="monthly-items-table">
    <thead><tr><th style="width:36px;">No</th><th>과제명</th><th style="width:34%;">비고(제약 사항 등)</th></tr></thead>
    <tbody>
      ${items.map((it, i) => `<tr class="monthly-item-row" data-no="${it.no}">
        <td class="c">${i + 1}</td>
        <td class="cell-body"${fixed ? '' : ' contenteditable="true"'}>${escapeHtml(it.body).replace(/\n/g, '<br>')}</td>
        <td class="cell-note"${fixed ? '' : ' contenteditable="true"'}>${escapeHtml(it.note)}</td>
      </tr>`).join('')}
    </tbody>
  </table>${fixed ? '' : '<p class="monthly-hint" style="margin-top:8px;">셀을 클릭하면 문구를 직접 수정할 수 있습니다. 수정 후 확정 저장하면 그대로 고정됩니다.</p>'}`;
}

function monthlyTogglePick(no) {
  const i = monthlySel.indexOf(no);
  if (i > -1) monthlySel.splice(i, 1); else monthlySel.push(no);
  renderMonthlyBottom();
}

function monthlyUnlock(no) {
  const curKey = monthlyKeyOf(new Date());
  const curSaved = monthlyStore && monthlyStore[curKey];
  if (!curSaved) return;
  if (!confirm('확정본을 편집 상태로 되돌립니다. 계속할까요?\n(화면에서만 풀리며, 다시 확정 저장해야 서버에 반영됩니다)')) return;
  monthlySel.length = 0;
  (curSaved.items || []).forEach(i => monthlySel.push(i.no));
  if (no && !monthlySel.includes(no)) monthlySel.push(no);
  delete monthlyStore[curKey];        // 화면상 편집 모드 전환 (서버본은 저장 시 덮어씀)
  renderMonthly();
}

/* ── 엔트리 ── */
function renderMonthly() {
  if (monthlyStore === null) {
    monthlyLoad().then(() => { renderMonthlyTop(); renderMonthlyBottom(); });
    return;
  }
  renderMonthlyTop();
  renderMonthlyBottom();
}
