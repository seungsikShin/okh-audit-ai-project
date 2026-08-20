
let data = JSON.parse(JSON.stringify(RAW));
data.forEach(r => { r._수정일 = null; r._수정ts = null; });
let changes = {};
let _allLogs = [];   // Firebase에서 로드된 전체 변경 로그

window._applyRemoteLog = function(logs) {
  _allLogs = logs;
  updateLog();
};
let currentEditNo = null;
let charts = {};

// ── 스냅샷 뷰 모드 상태 ──────────────────────────
let liveData = null;          // 라이브 데이터 백업 (스냅샷 진입 시)
let viewingWeek = null;       // 현재 보고 있는 주차 키 (null = 라이브)

function enterSnapshotMode(weekKey) {
  const snap = weeklyHistory[weekKey];
  if (!snap || !Array.isArray(snap.tasks)) {
    showToast('이 주차는 과제 스냅샷이 없습니다 (집계만 기록됨)');
    return;
  }
  // 라이브 데이터 백업 (최초 진입 시에만)
  if (viewingWeek === null) liveData = data;
  viewingWeek = weekKey;
  data = JSON.parse(JSON.stringify(snap.tasks));
  document.body.classList.add('snapshot-mode');
  const banner = document.getElementById('snapshotBanner');
  if (banner) {
    banner.style.display = 'flex';
    document.getElementById('snapshotBannerLabel').textContent =
      `${snap.label} (${snap.savedAt || ''})`;
  }
  highlightWeeklyNav(weekKey);
  populateTargetFilter(data);
  // 스냅샷 데이터는 과거 데이터이므로 '최근 수정' 필터 해제
  const recentFilter = document.getElementById('filterRecent');
  if (recentFilter) recentFilter.value = '';
  applyFilter();
  renderDashboard();
  renderSchedule();
  renderAgents();
}

function exitSnapshotMode() {
  if (viewingWeek === null) return;
  if (liveData) data = liveData;
  liveData = null;
  viewingWeek = null;
  document.body.classList.remove('snapshot-mode');
  const banner = document.getElementById('snapshotBanner');
  if (banner) banner.style.display = 'none';
  highlightWeeklyNav(null);
  populateTargetFilter(data);
  applyFilter();
  renderDashboard();
  renderSchedule();
  renderAgents();
}

function highlightWeeklyNav(weekKey) {
  document.querySelectorAll('#weeklyNav .tab').forEach(el => el.classList.remove('active'));
  if (weekKey === null) {
    const live = document.getElementById('weeklyNavLive');
    if (live) live.classList.add('active');
  } else {
    const el = document.querySelector(`#weeklyNav [data-week="${weekKey}"]`);
    if (el) el.classList.add('active');
  }
}

// ── 탭 전환 ──────────────────────────────
function switchTab(id, el) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  const nav = el || document.querySelector('.tab[data-tab="'+id+'"]');
  if (nav) nav.classList.add('active');
  document.body.dataset.track = id.startsWith('v2-') ? 'v2' : 'legacy';
  if (id==='dashboard') { renderDashboard(); loadWeeklyHistory(); }
  if (id==='schedule') renderSchedule();
  if (id==='agents') renderAgents();
  if (id==='tasklist') { updateTaskStickyOffset(); syncHeaderWidths(); requestAnimationFrame(syncHeaderWidths); }
  if (id.startsWith('v2-') && typeof window._v2Render === 'function') window._v2Render(id);
}

// 재편 트랙(v2.js)에서 진척률이 바뀌면 원과제 트랙 화면을 다시 그린다
window._legacyRerender = function () {
  if (viewingWeek !== null) return;       // 스냅샷 보기 중에는 덮지 않음
  applyFilter();
  const on = id => { const e = document.getElementById(id); return e && e.classList.contains('active'); };
  if (on('tab-dashboard')) renderDashboard();
  if (on('tab-schedule')) renderSchedule();
  if (on('tab-agents')) renderAgents();
};

// ── 차트 헬퍼 ────────────────────────────
function destroyChart(id) { if(charts[id]){charts[id].destroy();delete charts[id];} }

function renderDashboard() {
  const active = data.filter(d=>d.착수상태);
  const started = data.filter(d=>d.착수상태==='착수');
  const notStarted = data.filter(d=>d.착수상태==='미착수');
  const avg = active.length ? Math.round(active.reduce((s,d)=>s+d.진척률,0)/active.length*100) : 0;
  const done = data.filter(d=>d.진척률>=1.0 && d.착수상태==='착수');
  // 전체 과제·에이전트 수는 데이터에서 계산 (하드코딩 금지)
  document.getElementById('kpi-total').textContent = data.length;
  const agentCount = new Set(data.filter(d=>d.에이전트).map(d=>d.에이전트)).size;
  const kpiAgents = document.getElementById('kpi-agents');
  if (kpiAgents) kpiAgents.textContent = agentCount;
  const topCount = document.getElementById('topTaskCount');
  if (topCount) topCount.textContent = data.length;
  document.getElementById('kpi-started').textContent = started.length;
  document.getElementById('kpi-not').textContent = notStarted.length;
  document.getElementById('kpi-avg').textContent = avg+'%';
  document.getElementById('kpi-started-pct').textContent = active.length ? Math.round(started.length/active.length*100)+'%' : '0%';
  document.getElementById('kpi-done').textContent = done.length;
  document.getElementById('kpi-done-pct').textContent = active.length ? Math.round(done.length/active.length*100)+'%' : '0%';
  renderKpiDeltas();
  renderProrationBanner();
  renderRiskCard();

  // 분기별 착수 현황 (분기당 미니 도넛)
  renderQuarterStatus();

  // 담당자별 착수 현황 (쉼표 구분 담당자는 각자 집계)
  const perMap = {};
  data.forEach(d=>{
    if(!d.담당자) return;
    String(d.담당자).split(',').map(p=>p.trim()).filter(Boolean).forEach(p=>{
      if(!perMap[p]) perMap[p]={착수:0,미착수:0,progs:[]};
      if(d.착수상태==='착수') perMap[p].착수++;
      else if(d.착수상태==='미착수') perMap[p].미착수++;
      perMap[p].progs.push(d.진척률||0);
    });
  });
  const perLabels = Object.keys(perMap).sort((a,b)=>(perMap[b].착수+perMap[b].미착수)-(perMap[a].착수+perMap[a].미착수));
  const perAvg = perLabels.map(p=>{const g=perMap[p];return g.progs.length?Math.round(g.progs.reduce((s,v)=>s+v,0)/g.progs.length*100):0;});
  destroyChart('chartPerson');
  const perCanvas = document.getElementById('chartPerson');
  if (perCanvas) {
    charts['chartPerson'] = new Chart(perCanvas, {
      type:'bar',
      data:{labels:perLabels,datasets:[
        {label:'착수',data:perLabels.map(p=>perMap[p].착수),backgroundColor:'#4F46E5',borderRadius:6,maxBarThickness:36},
        {label:'미착수',data:perLabels.map(p=>perMap[p].미착수),backgroundColor:'#E5E7EB',borderRadius:6,maxBarThickness:36}
      ]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',font:{family:"'Pretendard',sans-serif",size:12},color:'#475467',padding:14}},
          tooltip:{callbacks:{footer(items){const i=items[0].dataIndex;return `평균 진척률 ${perAvg[i]}%`;}}}},
        scales:{x:{stacked:true,grid:{display:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#475467'}},y:{stacked:true,grid:{color:'#F3F4F6',drawBorder:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'}}}}
    });
  }

  // 업무영역별 착수 현황 (가로 스택바)
  const areaMap = {};
  data.forEach(d=>{
    if(!d.영역) return;
    if(!areaMap[d.영역]) areaMap[d.영역]={착수:0,미착수:0,progs:[]};
    if(d.착수상태==='착수') areaMap[d.영역].착수++;
    else if(d.착수상태==='미착수') areaMap[d.영역].미착수++;
    areaMap[d.영역].progs.push(d.진척률||0);
  });
  const areaLabels = Object.keys(areaMap).sort();
  const areaAvg = areaLabels.map(a=>{const g=areaMap[a];return g.progs.length?Math.round(g.progs.reduce((s,v)=>s+v,0)/g.progs.length*100):0;});
  destroyChart('chartArea');
  const areaCanvas = document.getElementById('chartArea');
  if (areaCanvas) {
    charts['chartArea'] = new Chart(areaCanvas, {
      type:'bar',
      data:{labels:areaLabels,datasets:[
        {label:'착수',data:areaLabels.map(a=>areaMap[a].착수),backgroundColor:'#4F46E5',borderRadius:6,maxBarThickness:18},
        {label:'미착수',data:areaLabels.map(a=>areaMap[a].미착수),backgroundColor:'#E5E7EB',borderRadius:6,maxBarThickness:18}
      ]},
      options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',font:{family:"'Pretendard',sans-serif",size:12},color:'#475467',padding:14}},
          tooltip:{callbacks:{footer(items){const i=items[0].dataIndex;return `평균 진척률 ${areaAvg[i]}%`;}}}},
        scales:{x:{stacked:true,grid:{color:'#F3F4F6',drawBorder:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'}},
          y:{stacked:true,grid:{display:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#475467'},afterFit(scale){scale.width=170;}}}}
    });
  }
}

// ── 분기별 착수 현황 (목표완료 분기당 미니 도넛) ────────────
function renderQuarterStatus() {
  const grid = document.getElementById('quarterStatusGrid');
  if (!grid) return;
  Object.keys(charts).filter(k=>k.startsWith('qd_')).forEach(destroyChart);
  // 착수상태가 있는 과제만 집계 (기존 착수 현황 도넛과 동일 기준)
  const qMap = {};
  data.filter(d=>d.착수상태).forEach(d=>{
    const q = normalizeTarget(d.목표완료) || '미지정';
    if(!qMap[q]) qMap[q]={완료:0,진행:0,미착수:0,합:0,진척합:0};
    const g = qMap[q]; g.합++; g.진척합+=(d.진척률||0);
    if(d.진척률>=1 && d.착수상태==='착수') g.완료++;
    else if(d.착수상태==='착수') g.진행++;
    else g.미착수++;
  });
  const qs = Object.keys(qMap).sort((a,b)=>{
    if(a==='미지정') return 1;
    if(b==='미지정') return -1;
    return a.localeCompare(b);
  });
  const now = new Date();
  // 스냅샷 보기 중에는 '이번 분기' 배지가 오늘 기준이라 무의미 → 배지 생략 (도넛 수치는 유효)
  const curQLabel = viewingWeek !== null ? null : `${now.getFullYear()} Q${Math.floor(now.getMonth()/3)+1}`;
  grid.innerHTML = qs.map((q,i)=>{
    const g = qMap[q];
    const isCur = curQLabel !== null && q===curQLabel;
    const startedPct = g.합 ? Math.round((g.완료+g.진행)/g.합*100) : 0;
    const avgProg = g.합 ? Math.round(g.진척합/g.합*100) : 0;
    return `<div class="q-donut-cell${isCur?' current':''}">
      ${isCur?'<span class="q-now-badge">이번 분기</span>':''}
      <div class="q-donut-wrap"><canvas id="qd_${i}"></canvas></div>
      <div class="q-donut-label">${q}</div>
      <div class="q-donut-rate">
        <span class="q-rate-pill start">착수율 <b>${startedPct}%</b></span>
        <span class="q-rate-pill prog">평균진척률 <b>${avgProg}%</b></span>
      </div>
      <div class="q-donut-sub">완료 <b style="color:#4F46E5;">${g.완료}</b> · 진행 <b style="color:#0EA5E9;">${g.진행}</b> · 미착수 <b>${g.미착수}</b> / ${g.합}건</div>
    </div>`;
  }).join('') + `<div class="q-donut-legend">
    <span><i style="background:#4F46E5"></i>완료</span>
    <span><i style="background:#A5B4FC"></i>진행 중</span>
    <span><i style="background:#E5E7EB"></i>미착수</span>
    <span class="q-legend-note">도넛 중앙 = 착수율(완료+진행)</span>
  </div>`;
  qs.forEach((q,i)=>{
    const g = qMap[q];
    const startedPct = g.합 ? Math.round((g.완료+g.진행)/g.합*100) : 0;
    const centerText = {
      id:'qdCenter',
      afterDraw(chart){
        const arc = chart.getDatasetMeta(0).data[0];
        if(!arc) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font="700 19px 'Pretendard',sans-serif"; ctx.fillStyle='#101828';
        ctx.fillText(startedPct+'%', arc.x, arc.y-7);
        ctx.font="600 10px 'Pretendard',sans-serif"; ctx.fillStyle='#98A2B3';
        ctx.fillText('착수율', arc.x, arc.y+11);
        ctx.restore();
      }
    };
    charts['qd_'+i] = new Chart(document.getElementById('qd_'+i), {
      type:'doughnut',
      data:{labels:['완료','진행 중','미착수'],datasets:[{data:[g.완료,g.진행,g.미착수],backgroundColor:['#4F46E5','#A5B4FC','#E5E7EB'],borderWidth:0,hoverOffset:4}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label(item){return ` ${item.label} ${item.parsed}건 (${g.합?Math.round(item.parsed/g.합*100):0}%)`;}}}}},
      plugins:[centerText]
    });
  });
}

// ── KPI 전주 대비 증감 (주차 스냅샷 기반) ────────────────
function renderKpiDeltas() {
  const ids = ['kpi-delta-started','kpi-delta-avg','kpi-delta-done'];
  const els = ids.map(id=>document.getElementById(id));
  els.forEach(e=>{ if(e){ e.textContent=''; e.className='kpi-delta'; } });
  // 스냅샷 보기 모드에서는 '전주 대비'가 의미 없으므로 표시하지 않음
  if (viewingWeek !== null) return;
  // 현재 주차를 제외한 가장 최근 기록 주차와 비교
  const curKey = getWeekKey(getMondayOf(new Date()));
  const prevKey = Object.keys(weeklyHistory).filter(k=>k<curKey).sort().pop();
  if (!prevKey) return;
  const prev = weeklyHistory[prevKey];
  const started = data.filter(d=>d.착수상태==='착수').length;
  const active = data.filter(d=>d.착수상태);
  const avg = active.length ? Math.round(active.reduce((s,d)=>s+(d.진척률||0),0)/active.length*100) : 0;
  const done = data.filter(d=>d.진척률>=1.0 && d.착수상태==='착수').length;
  const set = (el, diff, unit) => {
    if (!el) return;
    const cls = diff>0?'up':diff<0?'down':'flat';
    const arrow = diff>0?'▲':diff<0?'▼':'—';
    el.className = 'kpi-delta '+cls;
    el.textContent = `${arrow} ${Math.abs(diff)}${unit} 전주 대비`;
  };
  set(els[0], started-(prev.착수||0), '건');
  set(els[1], avg-(prev.평균진척률||0), '%p');
  set(els[2], done-(prev.완료||0), '건');
}

// ── 일정 리스크 (지연·당분기 마감) ────────────────────
function quarterIndex(target) {
  // 자유 입력이라 표기 변형 허용: 'YYYY Q3' / 'YYYY q3' / 'YYYY 3Q' 등
  const s = normalizeTarget(target).toUpperCase();
  const m = s.match(/^(\d{4})\s*Q\s*([1-4])$/) || s.match(/^(\d{4})\s*([1-4])\s*Q$/);
  return m ? parseInt(m[1])*4 + parseInt(m[2]) : null;
}

// ── 안분 배너: 원과제 80건의 진척률이 재편 25건에서 어떻게 내려왔는지 ──
function renderProrationBanner() {
  const wrap = document.getElementById('prorationBanner');
  if (!wrap) return;
  if (typeof window._v2LegacyRollup !== 'function') { wrap.innerHTML = ''; return; }
  const r = window._v2LegacyRollup(data);
  const delta = r.totalAvg - r.beforeAvg;
  wrap.innerHTML = `
    <div class="prorate">
      <div class="prorate-lead">
        <span class="prorate-badge">안분 연동</span>
        <p>원과제 <b>${r.linkedCount}건</b>이 AI 과제 25건에 흡수되어, 자체 값과 상위 과제 진척률 중 <b>높은 쪽</b>을 반영받습니다.
           나머지 <b>${r.ownCount}건</b>은 AI 과제에서 제외되어 자체 값을 유지합니다.</p>
      </div>
      <div class="prorate-figures">
        <div class="pf"><span class="k">흡수 ${r.linkedCount}건 평균</span><span class="v">${r.linkedAvg}%</span></div>
        <div class="pf"><span class="k">전체 80건 평균</span><span class="v accent">${r.totalAvg}%</span></div>
        <div class="pf"><span class="k">안분 전 대비</span><span class="v ${delta >= 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}%p</span></div>
      </div>
    </div>`;
}

function renderRiskCard() {
  const el = document.getElementById('riskCard');
  if (!el) return;
  // 지연사유 입력 중(포커스)에는 재렌더로 입력이 날아가지 않도록 이번 갱신을 건너뜀
  // (타 사용자 저장으로 인한 원격 수신 시 입력 보존 — blur 후 다음 렌더에 반영됨)
  if (document.activeElement && document.activeElement.classList
      && document.activeElement.classList.contains('risk-reason-input')) return;
  // 스냅샷 보기 모드: '지연' 판정은 오늘 날짜 기준이라 과거 스냅샷에 적용하면 오해를 부름
  // (당시엔 지연이 아니던 과제가 지연으로 표시됨) → 라이브에서만 계산
  if (viewingWeek !== null) {
    el.innerHTML = `<div style="padding:10px 2px;color:#98A2B3;font-size:13px;">📌 과거 스냅샷 보기 중에는 지연 판정을 표시하지 않습니다 (지연은 현재 라이브 기준으로만 계산).</div>`;
    return;
  }
  const now = new Date();
  const curQ = now.getFullYear()*4 + Math.floor(now.getMonth()/3) + 1;
  const curQLabel = `${now.getFullYear()} Q${Math.floor(now.getMonth()/3)+1}`;
  const overdue = [], dueNow = [];
  data.forEach(r=>{
    const qi = quarterIndex(r.목표완료);
    if (qi===null || (r.진척률||0)>=1) return;
    if (qi < curQ) overdue.push(r);
    else if (qi === curQ) dueNow.push(r);
  });
  overdue.sort((a,b)=>(quarterIndex(a.목표완료)-quarterIndex(b.목표완료)) || ((a.진척률||0)-(b.진척률||0)));
  const chips = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:${overdue.length?'12px':'0'};">
      <span style="font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;background:${overdue.length?'#FEF3F2':'#ECFDF3'};border:1px solid ${overdue.length?'#FECDCA':'#ABEFC6'};color:${overdue.length?'#B42318':'#067647'};">지연 ${overdue.length}건</span>
      <span style="font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;background:#FFFAEB;border:1px solid #FEDF89;color:#B54708;">이번 분기(${curQLabel}) 마감 ${dueNow.length}건</span>
      <span style="font-size:11px;color:#98A2B3;align-self:center;">목표완료 분기 경과 + 진척률 100% 미만 기준 · 이번 분기 마감 건은 일정 탭 참고</span>
    </div>`;
  if (overdue.length === 0) {
    el.innerHTML = chips + `<div style="padding:6px 2px;color:#475467;font-size:13px;">지연 과제가 없습니다 🎉</div>`;
    return;
  }
  const rows = overdue.map(r=>{
    const pct = Math.round((r.진척률||0)*100);
    const reason = escapeHtml(r.지연사유 || '');
    const hasReason = !!(r.지연사유 && String(r.지연사유).trim());
    return `<div style="display:flex;flex-direction:column;gap:8px;padding:9px 12px;border:1px solid #FECDCA;border-left:3px solid #D92D20;border-radius:10px;background:#fff;transition:box-shadow .15s;" onmouseover="this.style.boxShadow='0 3px 10px rgba(217,45,32,.12)'" onmouseout="this.style.boxShadow=''">
      <div style="display:flex;align-items:center;gap:12px;cursor:pointer;" onclick="goToTask(${r.no})" title="클릭하면 과제목록에서 보기">
        <span style="flex:0 0 44px;color:#667085;font-weight:600;font-size:12px;">No.${r.no}</span>
        <span style="flex:1;min-width:0;font-size:13px;color:#101828;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((r.태스크||'').split('\n')[0])}</span>
        <span style="flex:0 0 auto;font-size:12px;color:#475467;">${escapeHtml(r.담당자||'-')}</span>
        <span style="flex:0 0 auto;font-size:11px;font-weight:700;color:#B42318;background:#FEF3F2;border:1px solid #FECDCA;border-radius:999px;padding:2px 8px;">${normalizeTarget(r.목표완료)}</span>
        <span class="${r.착수상태==='착수'?'badge-착수':'badge-미착수'}" style="flex:0 0 auto;">${r.착수상태||'-'}</span>
        <span style="flex:0 0 110px;display:flex;align-items:center;gap:6px;">
          <span style="flex:1;height:6px;background:#EEF0FE;border-radius:999px;overflow:hidden;"><span style="display:block;height:100%;width:${pct}%;background:${pct>=50?'#F59E0B':'#D92D20'};border-radius:999px;"></span></span>
          <span style="font-size:11px;font-weight:700;color:#475467;width:32px;text-align:right;">${pct}%</span>
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="flex:0 0 auto;font-size:11px;font-weight:700;color:${hasReason?'#B54708':'#98A2B3'};">📝 지연사유</span>
        <input type="text" class="risk-reason-input" data-no="${r.no}" value="${reason}"
          placeholder="왜 지연되었는지 입력 (Enter 또는 클릭 해제 시 저장)"
          onkeydown="if(event.key==='Enter'){this.blur();}"
          onblur="saveRiskReason(${r.no}, this.value)"
          style="flex:1;min-width:0;font-size:12px;padding:5px 10px;border:1px solid ${hasReason?'#FEC84B':'#E4E7EC'};border-radius:7px;background:${hasReason?'#FFFCF5':'#F9FAFB'};color:#344054;outline:none;"
          onfocus="this.style.borderColor='#D92D20';this.style.background='#fff';">
      </div>
    </div>`;
  }).join('');
  el.innerHTML = chips + `<div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;padding-right:4px;">${rows}</div>`;
}

// 리스크 카드 인라인 지연사유 저장 (단일 필드 — 기존 저장 인프라 재사용)
function saveRiskReason(no, value) {
  if (viewingWeek !== null) return;          // 스냅샷 보기 중에는 저장 불가
  const idx = data.findIndex(d=>d.no===no);
  if (idx < 0) return;
  const oldVal = data[idx].지연사유==null ? '' : String(data[idx].지연사유);
  const newVal = String(value).trim();
  if (oldVal === newVal) return;             // 변경 없으면 조용히 무시
  data[idx].지연사유 = newVal;
  const nowTs = new Date();
  data[idx]._수정ts = nowTs.getTime();
  data[idx]._수정일 = nowTs.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'}) + ' ' + nowTs.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  // 변경 로그 기록 (모달 저장과 동일 형식)
  const logEntry = {
    no, 수정시각: nowTs.toLocaleString('ko-KR'), _ts: nowTs.getTime(),
    변경내역: { 지연사유: { 이전: oldVal, 이후: newVal } }, 메모: ''
  };
  changes[no] = { ...logEntry, 현재값: { ...data[idx] } };
  if (typeof window._firebaseSaveLog === 'function') window._firebaseSaveLog(logEntry);
  if (typeof window._firebaseAutoSave === 'function') window._firebaseAutoSave(no, data[idx]);
  updateLog();
  renderRiskCard();                          // 입력칸 강조색 갱신
  showToast(`No.${no} 지연사유 저장됨`);
}

function renderSchedule() {
  const qMap = {};
  data.forEach(d=>{
    const q = normalizeTarget(d.목표완료);
    if (!q) return;
    if(!qMap[q]) qMap[q]={착수:0,미착수:0,items:[]};
    if(d.착수상태==='착수') qMap[q].착수++;
    else if(d.착수상태==='미착수') qMap[q].미착수++;
    qMap[q].items.push(d);
  });
  const qs = Object.keys(qMap).sort();
  // 분기별 착수율·평균 진척률 산출
  const startRates = qs.map(q=>{const d=qMap[q].착수+qMap[q].미착수; return d?Math.round(qMap[q].착수/d*100):0;});
  const avgProgs = qs.map(q=>{const t=qMap[q].items.length; return t?Math.round(qMap[q].items.reduce((s,it)=>s+(it.진척률||0),0)/t*100):0;});
  const maxVal = Math.max(1,...qs.map(q=>Math.max(qMap[q].착수,qMap[q].미착수)));

  // 막대 위에 착수율·진척률 배지를 직접 그리는 커스텀 플러그인 (datalabels 미사용)
  const roundRect=(c,x,y,w,h,r)=>{c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();};
  const quarterRatePlugin = {
    id:'quarterRate',
    afterDatasetsDraw(chart){
      const ctx=chart.ctx, m0=chart.getDatasetMeta(0), m1=chart.getDatasetMeta(1);
      ctx.save();
      ctx.font="700 11px 'Pretendard',sans-serif";
      qs.forEach((q,i)=>{
        const b0=m0.data[i]; if(!b0) return;
        const b1=m1.data[i];
        const cx=b1?(b0.x+b1.x)/2:b0.x;
        const topY=Math.min(b0.y, b1?b1.y:b0.y);
        const sTxt=`착수 ${startRates[i]}%`, pTxt=`진척 ${avgProgs[i]}%`;
        const padX=9,gap=9,dot=7,dotGap=4,H=22;
        const sW=dot+dotGap+ctx.measureText(sTxt).width;
        const pW=dot+dotGap+ctx.measureText(pTxt).width;
        const W=padX+sW+gap+1+gap+pW+padX;
        let x=cx-W/2, y=topY-H-8;
        if(y<chart.chartArea.top+2) y=topY+6;   // 위 공간 부족 시 막대 상단 안쪽에
        // 배경 pill
        ctx.fillStyle='#ffffff'; ctx.strokeStyle='#E4E7EC'; ctx.lineWidth=1;
        ctx.shadowColor='rgba(16,24,40,.12)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2;
        roundRect(ctx,x,y,W,H,11); ctx.fill();
        ctx.shadowColor='transparent'; ctx.stroke();
        // 내용
        const midY=y+H/2; let tx=x+padX;
        ctx.textBaseline='middle'; ctx.textAlign='left';
        ctx.fillStyle='#818CF8'; ctx.beginPath(); ctx.arc(tx+dot/2,midY,dot/2,0,Math.PI*2); ctx.fill();
        tx+=dot+dotGap; ctx.fillStyle='#067647'; ctx.fillText(sTxt,tx,midY);
        tx+=ctx.measureText(sTxt).width+gap;
        ctx.strokeStyle='#EAECF0'; ctx.beginPath(); ctx.moveTo(tx,y+5); ctx.lineTo(tx,y+H-5); ctx.stroke();
        tx+=1+gap;
        ctx.fillStyle='#0EA5E9'; ctx.beginPath(); ctx.arc(tx+dot/2,midY,dot/2,0,Math.PI*2); ctx.fill();
        tx+=dot+dotGap; ctx.fillStyle='#175CD3'; ctx.fillText(pTxt,tx,midY);
      });
      ctx.restore();
    }
  };

  destroyChart('chartQuarter');
  charts['chartQuarter'] = new Chart(document.getElementById('chartQuarter'), {
    type:'bar',
    data:{labels:qs,datasets:[
      {label:'착수',data:qs.map(q=>qMap[q].착수),backgroundColor:'#818CF8',borderRadius:6,maxBarThickness:40},
      {label:'미착수',data:qs.map(q=>qMap[q].미착수),backgroundColor:'#E5E7EB',borderRadius:6,maxBarThickness:40}
    ]},
    options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:8}},plugins:{legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',font:{family:"'Pretendard',sans-serif",size:12},color:'#475467',padding:14}},tooltip:{callbacks:{title(items){return qs[items[0].dataIndex];},footer(items){const i=items[0].dataIndex;return `착수율 ${startRates[i]}%  ·  평균 진척률 ${avgProgs[i]}%`;}}}},scales:{x:{grid:{display:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'}},y:{suggestedMax:Math.ceil(maxVal*1.25),grid:{color:'#F3F4F6',drawBorder:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'}}}},
    plugins:[quarterRatePlugin]
  });

  // 분기별 목록
  const listDiv = document.getElementById('quarterList');
  listDiv.innerHTML = qs.map((q,qi)=>`
    <div style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="display:inline-flex;align-items:center;gap:8px;font-weight:700;color:#4F46E5;padding:6px 14px;background:#EEF0FE;border:1px solid #C7CBFB;border-radius:999px;font-size:13px;letter-spacing:0;">${q} <span style="color:#3E35C9;">·</span> <span style="color:#475467;font-weight:600;">${qMap[q].items.length}건</span></span>
        <span style="font-size:12px;font-weight:600;color:#475467;padding:5px 11px;background:#F2F4F7;border:1px solid #EAECF0;border-radius:999px;">착수율 <span style="color:#4F46E5;font-weight:700;">${startRates[qi]}%</span></span>
        <span style="font-size:12px;font-weight:600;color:#475467;padding:5px 11px;background:#F2F4F7;border:1px solid #EAECF0;border-radius:999px;">평균 진척률 <span style="color:#4F46E5;font-weight:700;">${avgProgs[qi]}%</span></span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
        ${qMap[q].items.map(it=>{const pct=Math.round((it.진척률||0)*100);return `
          <div style="background:#fff;border:1px solid #EAECF0;border-radius:12px;padding:12px 14px;font-size:13px;cursor:pointer;transition:all .15s;" onclick="goToTask(${it.no})" onmouseover="this.style.boxShadow='0 4px 12px rgba(20,123,82,.12)';this.style.borderColor='#C7CBFB';this.style.transform='translateY(-1px)'" onmouseout="this.style.boxShadow='';this.style.borderColor='#EAECF0';this.style.transform=''">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <span style="color:#667085;font-weight:600;">No.${it.no}</span>
              <span class="${it.착수상태==='착수'?'badge-착수':'badge-미착수'}">${it.착수상태||'-'}</span>
            </div>
            <div style="color:#101828;font-size:14px;font-weight:500;line-height:1.5;">${it.태스크.split('\n')[0]}</div>
            <div style="margin-top:6px;color:#475467;">${it.담당자||'-'}</div>
            <div style="margin-top:8px;">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:#667085;margin-bottom:3px;"><span>진척률</span><span style="color:#4F46E5;font-weight:700;">${pct}%</span></div>
              <div style="height:6px;background:#EEF0FE;border-radius:999px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:#4F46E5;border-radius:999px;"></div></div>
            </div>
            <div style="margin-top:8px;color:#4F46E5;font-size:11px;font-weight:600;letter-spacing:0;">→ 과제목록에서 보기</div>
          </div>`;}).join('')}
      </div>
    </div>`).join('');
}

// 에이전트별 사용 AI·구축 메타데이터
// est:false = 사용자 확정값 / est:true = 활용계획 기반 추정치(확인 필요)
const AGENT_META = {
  'A-01': {est:false, summary:'보도자료·제재·입법예고 자동 수집 후 영향도 분류·알림',
    ai:['Claude','Make AI'], build:['입법예고 API','크롤링(VBA)','메일 알림']},
  'A-02': {est:false, summary:'지적사례·대외동향 학습으로 감사 대상·전략 자동 도출',
    ai:['AI계','GPTS'], build:['감사지원에이전트']},
  'A-03': {est:false, summary:'회의·인터뷰 녹취 STT 변환 후 리스크 포인트 자동 분석',
    ai:['STT'], build:['Python 프로그램']},
  'A-04': {est:false, summary:'징구자료 전처리 후 착안점·체크리스트·시나리오 자동 생성',
    ai:['AI계','GPTS'], build:['Python 파싱프로그램','감사실시통합에이전트']},
  'A-05': {est:false, summary:'규정·자료·인터뷰 종합해 감사 보고서 초안 자동 작성·검증',
    ai:['Claude 디자인'], build:['보고서 생성']},
  'A-06': {est:true, summary:'통지·사후조치 이행 자동 추적, 기한 도래 시 리마인더',
    ai:['AI계'], build:['메일 알림','대시보드']},
  'A-07': {est:true, summary:'과거 징계사례 비교로 양정 형평성 분석·품의서 생성',
    ai:['AI계'], build:['사례 DB','메일 알림']},
  'A-08': {est:true, summary:'계약서 점검·가격 검증·의견서 작성 및 Q&A 챗봇 응대',
    ai:['AI계','Claude'], build:['Q&A 챗봇','메일 알림']},
  'A-09': {est:true, summary:'법인카드·예산·장부 이상거래 자동 탐지 및 보고서 생성',
    ai:['AI계'], build:['Python 프로그램','BSP 연계','메일 알림']},
  'A-10': {est:true, summary:'추심 통지문구 채권추심법 금지표현 자동 점검',
    ai:['AI계'], build:['규정 점검']},
  'A-11': {est:true, summary:'해외법인 보고서 번역·요약 및 정합성·리스크 자동 분석',
    ai:['Claude','Gemini','범용 LLM','AI계'], build:['OCR·번역','보고서 생성']},
  'A-12': {est:true, summary:'감독기관 요청 분석·수검일지·보고서 자동 작성, 기한 관리',
    ai:['AI계'], build:['메일 알림','대시보드']},
  'B-01': {est:true, summary:'계열사별 AML 지적사항 분류·요약 및 보고서 생성',
    ai:['AI계'], build:['분류·보고서 생성']},
  'B-02': {est:true, summary:'민원 유형 자동 분류·귀책 판단 및 리스크 분석',
    ai:['AI계'], build:['분류·분석']},
  'B-03': {est:true, summary:'익명 제보 상시 수집·법률 검토 및 캠페인 콘텐츠 제작',
    ai:['AI계','범용 LLM'], build:['설문 폼(QR)','콘텐츠 제작']},
  'B-04': {est:true, summary:'보호감시인·위수탁 현황 표준화 및 대시보드 관리',
    ai:['AI계'], build:['메일 알림','대시보드']},
  'B-05': {est:true, summary:'부서 예산 소진율 실시간 시각화·이상 지출 탐지',
    ai:[], build:['BI 대시보드','메일 알림']},
  'B-06': {est:true, summary:'운영계획·이행사항 기반 사후평가 보고서 자동 생성',
    ai:['AI계'], build:['보고서 생성']},
};
function getAgentMeta(name){
  const code = (String(name).match(/^[AB]-\d+/)||[])[0];
  return AGENT_META[code] || {est:true, summary:'', ai:[], build:[]};
}

// ── 구현 AI 플랫폼 (고정 6종) ─────────────
const AI_PLATFORMS = [
  {key:'claude', label:'클로드',   glyph:'<svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-.15em" xmlns="http://www.w3.org/2000/svg"><defs><path id="clB" d="M10.7 2 L13.3 2 L12 11 Z"/></defs><g fill="#CC785C"><use href="#clB"/><use href="#clB" transform="rotate(36 12 12)"/><use href="#clB" transform="rotate(72 12 12)"/><use href="#clB" transform="rotate(108 12 12)"/><use href="#clB" transform="rotate(144 12 12)"/><use href="#clB" transform="rotate(180 12 12)"/><use href="#clB" transform="rotate(216 12 12)"/><use href="#clB" transform="rotate(252 12 12)"/><use href="#clB" transform="rotate(288 12 12)"/><use href="#clB" transform="rotate(324 12 12)"/></g></svg>'},
  {key:'gemini', label:'제미나이', glyph:'<svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-.15em" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gmn" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F94F4F"/><stop offset=".35" stop-color="#F9A23B"/><stop offset=".65" stop-color="#41B36B"/><stop offset="1" stop-color="#3B82F6"/></linearGradient></defs><path d="M12 1 C12.7 6.6 17.4 11.3 23 12 C17.4 12.7 12.7 17.4 12 23 C11.3 17.4 6.6 12.7 1 12 C6.6 11.3 11.3 6.6 12 1 Z" fill="url(#gmn)"/></svg>'},
  {key:'gpt',    label:'GPT',      glyph:'<svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-.15em" xmlns="http://www.w3.org/2000/svg"><path fill="#202123" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z"/></svg>'},
  {key:'aigye',  label:'AI계',     glyph:'<span style="font-family:Arial,Helvetica,sans-serif;font-weight:900;letter-spacing:-.5px;color:#231F20">OK<span style="color:#FF6F00">!</span></span>'},
  {key:'python', label:'python',   glyph:'<svg viewBox="0 0 256 255" style="width:1em;height:1em;vertical-align:-.15em" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="pyB" x1="12.9%" y1="12%" x2="79.6%" y2="78.2%"><stop offset="0" stop-color="#387EB8"/><stop offset="1" stop-color="#366994"/></linearGradient><linearGradient id="pyY" x1="19.1%" y1="20.6%" x2="90.7%" y2="88.4%"><stop offset="0" stop-color="#FFE052"/><stop offset="1" stop-color="#FFC331"/></linearGradient></defs><path fill="url(#pyB)" d="M126.916.072c-64.832 0-60.784 28.115-60.784 28.115l.072 29.128h61.868v8.745H41.631S.145 61.355.145 126.77c0 65.417 36.21 63.097 36.21 63.097h21.61v-30.356s-1.165-36.21 35.632-36.21h61.362s34.475.557 34.475-33.319V33.97S232.115.072 126.916.072zM92.802 19.66a11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13 11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.13z"/><path fill="url(#pyY)" d="M128.757 254.126c64.832 0 60.784-28.115 60.784-28.115l-.072-29.127H127.6v-8.745h86.441s41.486 4.705 41.486-60.711c0-65.416-36.21-63.096-36.21-63.096h-21.61v30.355s1.165 36.21-35.632 36.21h-61.362s-34.475-.557-34.475 33.32v56.013s-5.235 33.897 99.964 33.897zm34.114-19.586a11.12 11.12 0 0 1-11.13-11.131 11.12 11.12 0 0 1 11.13-11.13 11.12 11.12 0 0 1 11.131 11.13 11.12 11.12 0 0 1-11.131 11.13z"/></svg>'},
  {key:'html',   label:'HTML',     glyph:'<svg viewBox="0 0 24 24" style="width:1em;height:1em;vertical-align:-.15em" fill="none" stroke="url(#htmlG)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="htmlG" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2B8EF0"/><stop offset=".5" stop-color="#7E57C2"/><stop offset="1" stop-color="#E5394E"/></linearGradient></defs><path d="M6 2 H14 L19 7 V22 H6 Z"/><path d="M14 2 V7 H19"/><path d="M10 9.5 L7.8 12.5 L10 15.5"/><path d="M13.6 8.8 L11.4 16.2"/><path d="M14.8 9.5 L17 12.5 L14.8 15.5"/></svg>'},
];
// A-03 전용 추가 플랫폼 — SLLM (첨부 이미지 아이콘)
const EXTRA_PLATFORMS = [
  {key:'sllm', label:'SLLM', glyph:'<img src="data:image/png;base64,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" style="width:1.25em;height:1.25em;vertical-align:-.32em;object-fit:contain" alt="SLLM">'},
];
const PLAT = Object.fromEntries([...AI_PLATFORMS, ...EXTRA_PLATFORMS].map(p=>[p.key,p]));

// 에이전트별 구현 AI 타일 목록 오버라이드 (미지정 시 AI_PLATFORMS 전체 사용)
const AGENT_PLATFORMS = {
  'A-03': ['claude','gemini','gpt','aigye','python','sllm'],  // HTML 제거 + SLLM 추가
};

// 에이전트별 사용 AI(used)·운영 플랫폼(oper) 기본값 — 카드에서 직접 변경 가능
const AGENT_AI_DEFAULT = {
  'A-01':{used:['aigye'],oper:['aigye']},
  'A-02':{used:['aigye','gpt'],oper:['aigye']},
  'A-03':{used:['python','sllm'],oper:['python']},
  'A-04':{used:['aigye','python','gpt'],oper:['aigye','gpt']},
  'A-05':{used:['claude'],oper:['claude']},
  'A-06':{used:['aigye','html'],oper:['aigye','html']},
  'A-07':{used:['aigye'],oper:['aigye']},
  'A-08':{used:['claude','aigye'],oper:['claude','aigye']},
  'A-09':{used:['aigye','python'],oper:['aigye']},
  'A-10':{used:['aigye'],oper:['aigye']},
  'A-11':{used:['claude','gemini','gpt','aigye'],oper:['claude']},
  'A-12':{used:['aigye'],oper:['aigye']},
  'B-01':{used:['aigye'],oper:['aigye']},
  'B-02':{used:['aigye'],oper:['aigye']},
  'B-03':{used:['aigye','gpt'],oper:['aigye']},
  'B-04':{used:['aigye'],oper:['aigye']},
  'B-05':{used:[],oper:[]},
  'B-06':{used:['aigye'],oper:['aigye']},
};

// 에이전트별 실제 운영처(제목 아래 표시)
//  name + links:[{label,url}] (링크 1개면 label 생략 → 이름 자체가 링크, 2개+면 칩으로 표시)
const AGENT_OPER_NAME = {
  'A-01':{name:'클로드 스케쥴 자동실행(매일)'},
  'A-03':{name:'감사 AI 플랫폼', links:[{url:'http://172.28.88.115:8000/team-dashboard'}]},
  'A-04':{name:'감사실시통합에이전트', links:[
    {label:'GPT', url:'https://chatgpt.com/g/g-6a0177e4ac9c8191963ea3515cce8cab-gongsig-gamsa-silsi-tonghab-eijeonteu'},
    {label:'AI계', url:'https://aip-works.okfngroup.com/projects/d622c0cc01949b89fc42a6784106c465/apps/TExNQXBwOjZhNTYwMGNjMTEyNGUzMzQ3YzIyMGUxZA=='}
  ]},
  'A-05':{name:'클로드 디자인 감사결과 보고서', links:[
    {label:'클로드', url:'https://claude.ai/design/p/6f5cacf8-a86e-4c07-a7d0-9c0188527a54'},
    {label:'AI계', url:'https://aip-works.okfngroup.com/projects/d622c0cc01949b89fc42a6784106c465/apps/TExNQXBwOjZhMmY4OTVkYTJjYTRiOGIwMjkwYjllMA=='}
  ]},
  'A-06':{name:'사후관리 대시보드', links:[
    {label:'AI계', url:'https://aip-works.okfngroup.com/projects/d622c0cc01949b89fc42a6784106c465/apps/TExNQXBwOjY5ZjE1NDAwYTlmMTY2MmNmZmZlZjUwOA=='},
    {label:'클로드', url:'https://claude.ai/project/019eaa7f-55aa-75af-bdbf-96b80660ffb8'}
  ]},
  'A-08':{name:'클로드 프로젝트 일상감사', links:[{url:'https://claude.ai/project/019ea9c6-5709-7625-97cb-17e73e28d4e3'}]},
  'A-10':{name:'채권추심문구 적법성 검토 에이전트', links:[{url:'https://aip-works.okfngroup.com/projects/d622c0cc01949b89fc42a6784106c465/apps/TExNQXBwOjZhMmZhZjZiYmNlNGJjY2JiZTQ2MDI5OQ=='}]},
  'A-11':{name:'클로드 프로젝트 해외법인 감사 지원 에이전트', links:[
    {label:'인니', url:'https://claude.ai/project/019df209-25d4-7384-81e7-4d1e46a7d10d'},
    {label:'PPCB', url:'https://claude.ai/project/019d9412-8a54-76fe-b7a3-d55ae853a2f7'}
  ]},
  'B-03':{name:'AI계 내부제보분석에이전트', links:[{url:'https://aip-works.okfngroup.com/projects/d622c0cc01949b89fc42a6784106c465/apps/TExNQXBwOjZhMzBmY2IzZWVjZjk2NmU2OGUxZTY2OA=='}]},
  'B-04':{name:'HTML 감사 위수탁'},
  'B-05':{name:'HTML 감사부 예산', links:[{url:'https://gorgeous-phoenix-af09c9.netlify.app/'}]},
};

// 런타임 선택 상태 — 기본값 시드 후 localStorage(오프라인) → Firebase(원격) 순으로 덮어씀
let agentAI = {};
Object.entries(AGENT_AI_DEFAULT).forEach(([k,v])=>{ agentAI[k]={used:[...v.used],oper:[...v.oper]}; });
(function(){ try{ const raw=localStorage.getItem('okh_agentAI'); if(raw){ const o=JSON.parse(raw); Object.entries(o).forEach(([k,v])=>{ if(v) agentAI[k]={used:v.used||[],oper:v.oper||[]}; }); } }catch(e){} })();

// A-03: SLLM 항상 선택 고정, HTML 제외 (저장된 상태와 무관하게 강제)
function enforceAgentPins(){
  const s = agentAI['A-03'] || (agentAI['A-03']={used:[],oper:[]});
  if(!s.used.includes('sllm')) s.used.push('sllm');
  if(!s.oper.includes('sllm')) s.oper.push('sllm');
  s.used = s.used.filter(k=>k!=='html');
  s.oper = s.oper.filter(k=>k!=='html');
}
enforceAgentPins();

function persistAgentAI(code){
  try{ localStorage.setItem('okh_agentAI', JSON.stringify(agentAI)); }catch(e){}
  if(typeof window._firebaseSaveAgentMeta==='function') window._firebaseSaveAgentMeta(code, agentAI[code]);
}
window._applyRemoteAgentMeta = function(remote){
  if(!remote) return;
  Object.entries(remote).forEach(([k,v])=>{ if(v) agentAI[k]={used:v.used||[],oper:v.oper||[]}; });
  enforceAgentPins();
  try{ localStorage.setItem('okh_agentAI', JSON.stringify(agentAI)); }catch(e){}
  const at=document.getElementById('tab-agents'); if(at&&at.classList.contains('active')) renderAgents();
};
function agentSel(code){ return agentAI[code] || (agentAI[code]={used:[],oper:[]}); }
function toggleAgentAI(code, key){
  return;  // 구현 AI 선택 고정 — 추가 선택·해제 모두 불가 (운영 지정은 ★로만 변경)
}
function toggleAgentOper(code, key, ev){
  if(ev) ev.stopPropagation();
  const s=agentSel(code); if(!s.used.includes(key)) return;  // 사용 중인 것만 운영 지정 가능
  const j=s.oper.indexOf(key); if(j>=0)s.oper.splice(j,1); else s.oper.push(key);
  persistAgentAI(code); renderAgents();
}

function renderAgents() {
  const agMap = {};
  data.filter(d=>d.에이전트).forEach(d=>{
    if(!agMap[d.에이전트]) agMap[d.에이전트]={items:[],완료:0,진행:0,미착수:0,진척합:0};
    const g = agMap[d.에이전트];
    g.items.push(d);
    if(d.진척률>=1) g.완료++;
    else if(d.착수상태==='착수') g.진행++;
    else g.미착수++;
    g.진척합+=d.진척률;
  });
  const grid = document.getElementById('agentGrid');
  const legend = `<div class="agent-legend">
    <span class="lg-item"><span class="ai-tile sel mini"><span class="tile-check">✓</span></span> 선택된 구현 AI</span>
    <span class="lg-item"><span class="ai-tile mini"></span> 미사용</span>
    <span class="lg-item"><span class="oper-badge p-aigye">${PLAT.aigye.glyph} AI계 운영</span></span>
    <span class="lg-note">타이틀 옆 = 실제 운영 플랫폼</span>
  </div>`;
  const cards = Object.entries(agMap).sort((a,b)=>a[0].localeCompare(b[0])).map(([name,v])=>{
    const avg = Math.round(v.진척합/v.items.length*100);
    const quarters = [...new Set(v.items.map(it=>normalizeTarget(it.목표완료)).filter(Boolean))].sort();
    const deadlineHtml = quarters.length
      ? `<div class="ag-deadline">🗓 마감 <b>${quarters[quarters.length-1]}</b>${quarters.length>1?`<span class="ag-dl-range">${quarters[0].replace(/^2026\s*/,'')}~${quarters[quarters.length-1].replace(/^2026\s*/,'')}</span>`:''}</div>`
      : '';
    const meta = getAgentMeta(name);
    const code = (String(name).match(/^[AB]-\d+/)||[])[0];
    const sel = agentSel(code);
    const allowedPlats = AGENT_PLATFORMS[code] || AI_PLATFORMS.map(p=>p.key);
    const selUsed = sel.used.filter(k=>allowedPlats.includes(k));
    const selOper = sel.oper.filter(k=>allowedPlats.includes(k));
    const operBadges = selOper.map(k=>`<span class="oper-badge p-${k}">${PLAT[k].glyph} ${PLAT[k].label} 운영</span>`).join('');
    const on = AGENT_OPER_NAME[code];
    let operNameHtml = '';
    if(on){
      const lks = on.links || (on.url ? [{url:on.url}] : []);
      let inner;
      if(lks.length===0) inner = on.name;
      else if(lks.length===1) inner = `<a href="${lks[0].url}" target="_blank" rel="noopener">${on.name} ↗</a>`;
      else inner = `${on.name} ` + lks.map(l=>`<a class="oper-link" href="${l.url}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('');
      operNameHtml = `<div class="ag-oper-name">📍 ${inner}</div>`;
    }
    const tiles = allowedPlats.map(k=>PLAT[k]).map(p=>{
      const on = selUsed.includes(p.key);
      const isOper = selOper.includes(p.key);
      return `<button type="button" class="ai-tile p-${p.key} ${on?'sel':''}" onclick="toggleAgentAI('${code}','${p.key}')" title="${p.label} — ${on?'사용중 (고정됨)':'미사용 (고정됨)'}">
        ${on?'<span class="tile-check">✓</span>':''}
        ${on?`<span class="tile-star ${isOper?'on':''}" onclick="toggleAgentOper('${code}','${p.key}',event)" title="운영 플랫폼 지정/해제">${isOper?'★':'☆'}</span>`:''}
        <span class="tile-ico">${p.glyph}</span>
        <span class="tile-label">${p.label}</span>
      </button>`;
    }).join('');
    return `<div class="agent-card">
      <div class="ag-head"><h4>${name}</h4>${operBadges}${operNameHtml}</div>
      <div class="ag-summary">${meta.summary||''}</div>
      <div class="ag-impl-label">구현 AI</div>
      <div class="ai-tile-grid">${tiles}</div>
      <div class="ag-count">
        <span>과제 <b>${v.items.length}</b>건</span>
        <span style="color:var(--primary);">완료 <b>${v.완료}</b></span>
        <span style="color:var(--info);">진행 <b>${v.진행}</b></span>
        <span style="color:var(--text-3);">미착수 <b>${v.미착수}</b></span>
      </div>
      <div class="ag-bar-wrap"><div class="ag-bar-fill" style="width:${avg}%"></div></div>
      <div class="ag-stat"><span>평균 진척률</span><span style="font-weight:700;color:#4F46E5;">${avg}%</span></div>
      ${deadlineHtml}
    </div>`;
  }).join('');
  grid.innerHTML = legend + cards;
}

// ── 과제 목록 ────────────────────────────
function getPersonList(source) {
  const set = new Set();
  [...RAW, ...(source || data)].forEach(r=>{ if(r.담당자) String(r.담당자).split(',').forEach(p=>set.add(p.trim())); });
  return [...set].filter(Boolean).sort();
}

function populatePersonFilter(source) {
  const sel = document.getElementById('filterPerson');
  if (!sel) return;
  const selected = sel.value;
  sel.innerHTML = '<option value="">전체</option>';
  getPersonList(source).forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; sel.appendChild(o); });
  if (selected && [...sel.options].some(o=>o.value===selected)) sel.value = selected;
}

function normalizeTarget(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// HTML \uc774\uc2a4\ucf00\uc774\ud504 (innerHTML \uc0bd\uc785 \uc2dc \uc0ac\uc6a9\uc790 \uc785\ub825\uc758 \ud0dc\uadf8\u00b7\ub530\uc634\ud45c \ubb34\ud574\ud654)
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function isAiUseRow(row) {
  const aiFlag = normalizeTarget(row.AI활용가능).toUpperCase();
  const plan = normalizeTarget(row.활용계획);
  if (!plan) return false;
  if (aiFlag === 'X') return false;
  if (plan.includes('AI 미활용')) return false;
  return true;
}

// ── 활용계획 파싱: "[현재] X → [AI 활용] Y" (Y는 [구현]/[작동]/[산출물] 태그 가능) ──
function parsePlan(str) {
  const s = (str || '').trim();
  const m = s.match(/^\[현재\]\s*([\s\S]*?)\s*→\s*\[AI\s*활용\]\s*([\s\S]*)$/);
  if (!m) return { matched: false, structured: false, asis: s, tobe: '', impl: '', flow: '', out: '' };
  const tobe = m[2].trim();
  const tag = (name) => {
    const t = tobe.match(new RegExp('\\[' + name + '\\]\\s*([\\s\\S]*?)(?=\\s*\\[(?:구현|작동|산출물)\\]|$)'));
    return t ? t[1].trim() : '';
  };
  const structured = /\[구현\]|\[작동\]|\[산출물\]/.test(tobe);
  return {
    matched: true, structured,
    asis: m[1].trim(), tobe,
    impl: structured ? tag('구현') : '',
    flow: structured ? tag('작동') : tobe,
    out: structured ? tag('산출물') : ''
  };
}

// 수정 모달 4칸 → 저장 문자열 재조립 (파싱→재조립이 원문과 동일하도록 유지)
function assemblePlan(asis, impl, flow, out, origStr) {
  asis = asis.trim(); impl = impl.trim(); flow = flow.trim(); out = out.trim();
  if (!asis && !impl && !flow && !out) return '';
  const orig = parsePlan(origStr);
  // 4칸 모두 변경 없음 → 원문 그대로 반환 (U+00A0 등 공백 차이로 인한 가짜 변경 로그 방지)
  if (orig.asis === asis && orig.impl === impl && orig.flow === flow && orig.out === out) return origStr || '';
  // AI 미활용 등 패턴 없는 행: To-Be 입력이 없으면 원문 형태 그대로 유지
  if (!orig.matched && !impl && !flow && !out) return asis;
  let tobe;
  if (impl || out) {
    tobe = [impl && '[구현] ' + impl, flow && '[작동] ' + flow, out && '[산출물] ' + out].filter(Boolean).join(' ');
  } else {
    tobe = flow;
  }
  return '[현재] ' + asis + ' → [AI 활용] ' + tobe;
}

function updateTaskStickyOffset() {
  const shell = document.getElementById('taskStickyShell');
  const taskList = document.getElementById('tab-tasklist');
  if (!shell || !taskList || !taskList.classList.contains('active')) {
    updatePinnedTableHeader();
    return;
  }
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 64;
  const offset = Math.ceil(topbar + shell.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--task-sticky-offset', offset + 'px');
  updatePinnedTableHeader();
}

function updatePinnedTableHeader() {
  const wrap = document.getElementById('tableWrap');
  const taskList = document.getElementById('tab-tasklist');
  if (!wrap || !taskList || !taskList.classList.contains('active')) return;
  const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--task-sticky-offset')) || 0;
  const rect = wrap.getBoundingClientRect();
  const shouldPin = rect.top <= offset && rect.bottom > offset + 80;
  wrap.classList.toggle('pin-head', shouldPin);
}

let syncingTableScroll = false;
function syncFloatingHeaderMode() {
  const wrap = document.getElementById('tableWrap');
  const head = document.getElementById('floatingTableHead');
  if (!wrap || !head) return;
  head.classList.toggle('wide', wrap.classList.contains('wide'));
  head.classList.toggle('compact', wrap.classList.contains('compact'));
  syncHeaderWidths();
  head.scrollLeft = wrap.scrollLeft;
}

// 헤더(flex) 셀 너비를 본문 table(table-layout:fixed, width:100%)의 실제 컬럼 폭에
// 맞춰 동기화 → 컬럼 펼침/닫힘에 따라 제목 위치가 본문과 정확히 정렬됨.
function syncHeaderWidths() {
  const wrap = document.getElementById('tableWrap');
  const head = document.getElementById('floatingTableHead');
  if (!wrap || !head) return;
  const table = wrap.querySelector('#mainTable');
  const headRow = head.querySelector('.head-row');
  const firstRow = table && table.querySelector('tbody tr');
  const headCells = [...head.querySelectorAll('.head-cell')];
  // 표가 숨겨진 탭(width 0)에서는 동기화하지 않고 인라인 스타일을 비워 CSS 기본값 사용.
  if (!table || !headRow || !firstRow || table.offsetParent === null) {
    headCells.forEach(c => { c.style.width = ''; c.style.flex = ''; });
    if (headRow) headRow.style.minWidth = '';
    return;
  }
  const visBody = [...firstRow.children].filter(c => getComputedStyle(c).display !== 'none');
  const visHead = headCells.filter(c => getComputedStyle(c).display !== 'none');
  const n = Math.min(visBody.length, visHead.length);
  headRow.style.minWidth = table.offsetWidth + 'px';
  for (let i = 0; i < n; i++) {
    const w = visBody[i].getBoundingClientRect().width;
    visHead[i].style.flex = '0 0 ' + w + 'px';
    visHead[i].style.width = w + 'px';
  }
}

function bindFloatingHeaderScroll() {
  const wrap = document.getElementById('tableWrap');
  const head = document.getElementById('floatingTableHead');
  if (!wrap || !head || wrap.dataset.scrollBound === 'true') return;
  wrap.dataset.scrollBound = 'true';
  wrap.addEventListener('scroll', () => {
    if (syncingTableScroll) return;
    syncingTableScroll = true;
    head.scrollLeft = wrap.scrollLeft;
    syncingTableScroll = false;
  }, { passive: true });
  head.addEventListener('scroll', () => {
    if (syncingTableScroll) return;
    syncingTableScroll = true;
    wrap.scrollLeft = head.scrollLeft;
    syncingTableScroll = false;
  }, { passive: true });
}

function getTargetList(source) {
  const set = new Set();
  [...RAW, ...(source || data)].forEach(r => {
    const target = normalizeTarget(r.목표완료);
    if (target) set.add(target);
  });
  return [...set].sort();
}

function populateTargetFilter(source) {
  const tsel = document.getElementById('filterTarget');
  if (!tsel) return;
  const selected = normalizeTarget(tsel.value);
  tsel.innerHTML = '<option value="">전체</option>';
  getTargetList(source).forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    tsel.appendChild(o);
  });
  if (selected && [...tsel.options].some(o => o.value === selected)) tsel.value = selected;
}

// ── 활용계획 → 현재 업무(As-Is) / AI 활용(To-Be) 2개 셀 렌더링 ──
function renderPlanCells(r) {
  const p = parsePlan(r.활용계획);
  const TAG_COLORS = {
    '구현':   { bg:'#EFF6FF', border:'#BFDBFE', color:'#1D4ED8' },
    '작동':   { bg:'#ECFDF5', border:'#A7F3D0', color:'#047857' },
    '산출물': { bg:'#FFF7ED', border:'#FED7AA', color:'#C2410C' }
  };
  const tagChip = (label) => {
    const c = TAG_COLORS[label] || { bg:'var(--surface-2)', border:'var(--border)', color:'var(--text-2)' };
    return `<span style="flex:0 0 auto;min-width:44px;text-align:center;background:${c.bg};border:1px solid ${c.border};border-radius:4px;padding:0 5px;font-size:11px;line-height:18px;color:${c.color};font-weight:700;margin-right:6px;">${label}</span>`;
  };
  // 칩+텍스트 flex 배치 → 텍스트 줄바꿈 시 둘째 줄부터 칩 너비만큼 들여쓰기 유지
  const tagLine = (label, text, mt) => `<div style="display:flex;align-items:flex-start;${mt ? 'margin-top:5px;' : ''}">${tagChip(label)}<span style="flex:1;min-width:0;">${text}</span></div>`;
  let asisCell, tobeCell;
  if (!p.matched) {
    // AI 미활용 등 패턴 없는 행: As-Is에 원문, To-Be에 미활용 배지
    asisCell = `<div class="cell-text" style="font-size:13px;color:var(--text-2);">${p.asis || '-'}</div>`;
    tobeCell = `<span style="background:#EEF0FE;color:#475467;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;">AI 미활용</span>`;
  } else {
    asisCell = `<div class="cell-text" style="font-size:13px;color:var(--text-2);">${p.asis}</div>`;
    if (p.structured) {
      tobeCell = `<div class="cell-text" style="font-size:13px;">` +
        (p.impl ? tagLine('구현', p.impl, false) : '') +
        (p.flow ? tagLine('작동', p.flow, !!p.impl) : '') +
        (p.out ? tagLine('산출물', p.out, !!(p.impl || p.flow)) : '') +
        `</div>`;
    } else {
      tobeCell = `<div class="cell-text" style="font-size:14px;color:var(--text);font-weight:500;">${p.tobe}</div>`;
    }
  }
  return `<td class="col-plan-asis">${asisCell}</td><td class="col-plan">${tobeCell}</td>`;
}

// 진척률 셀 하단의 안분 표기 — 어느 과제에서 내려온 값인지, 자체 값 대비 얼마나 움직였는지
function linkNote(r) {
  if (!r._연동) return '<span class="prog-note own">자체</span>';
  const before = Math.round((r._자체진척률 || 0) * 100);
  const now = Math.round((r.진척률 || 0) * 100);
  const d = now - before;
  return `<span class="prog-note linked" title="AI 과제 ${r._연동과제}번에서 안분 · 안분 전 ${before}%">
    과제 ${r._연동과제}${d ? `<i class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</i>` : ''}</span>`;
}

function renderTable(rows) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  rows.forEach(r=>{
    const isModified = changes[r.no]!==undefined;
    const pct = Math.round(r.진척률*100);
    // SHIFT 배지
    const shiftColors = {S:'#818CF8',H:'#0EA5E9',I:'#6366F1',T:'#F59E0B',SH:'#4F46E5',F:'#64748B'};
    const shiftBadge = r.shift ? `<span style="background:${shiftColors[r.shift]||'#999'};color:#fff;border-radius:10px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:0;">${r.shift}</span>` : '<span style="color:#667085;font-size:11px;">-</span>';
    // 우선순위 배지
    const priorityColors = {'상':'#EF4444','중':'#F59E0B','하':'#94A3B8'};
    const priorityBadge = r.우선순위 ? `<span style="background:${priorityColors[r.우선순위]||'#999'};color:#fff;border-radius:10px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:0;">${r.우선순위}</span>` : '<span style="color:#667085;font-size:11px;">-</span>';
    // AI 활용 여부 배지
    const isAiUse = isAiUseRow(r);
    const aiUseBadge = !r.활용계획 || r.활용계획.trim()==='' ? '<span style="color:#667085;font-size:11px;">-</span>' : isAiUse ? '<span style="background:#e3f2fd;color:#1565c0;border-radius:10px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:0;">AI 활용</span>' : '<span style="background:#EEF0FE;color:#475467;border-radius:10px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:0;">AI 미활용</span>';
    const statusBadge = r.착수상태==='착수'?`<span class="badge-착수">착수</span>`:r.착수상태==='미착수'?`<span class="badge-미착수">미착수</span>`:`<span class="badge-empty">-</span>`;
    const tr = document.createElement('tr');
    if(isModified) tr.classList.add('modified');
    tr.innerHTML = `
      <td class="cell-no">${r.no}</td>
      <td class="col-area col-extra"><div class="cell-text" style="font-size:13px;color:var(--text-2);font-weight:500;">${r.영역}</div><div class="cell-text" style="font-size:13px;color:var(--text-2);margin-top:2px;">${r.프로세스}</div></td>
      <td class="col-agent"><div class="cell-text" style="font-size:14px;font-weight:500;">${r.에이전트||'-'}</div></td>
      <td class="col-task"><div class="cell-text">${r.태스크}</div></td>
      ${renderPlanCells(r)}
      <td class="col-person"><div class="cell-text">${r.담당자||'-'}</div></td>
      <td class="col-shift col-extra" style="text-align:center;">${shiftBadge}</td>
      <td class="col-type col-extra" style="text-align:center;"><div class="cell-text" style="font-size:13px;">${r.과제유형||'-'}</div></td>
      <td class="col-priority col-extra" style="text-align:center;">${priorityBadge}</td>
      <td class="col-aiuse col-extra" style="text-align:center;">${aiUseBadge}</td>
      <td class="col-method col-extra"><div class="cell-text" style="font-size:13px;">${r.구현방법||'-'}</div></td>
      <td class="col-status">${statusBadge}</td>
      <td class="col-progress"><div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-pct">${pct}%</div>${linkNote(r)}</div></td>
      <td class="col-target"><div class="cell-text" style="font-size:13px;">${normalizeTarget(r.목표완료)||'-'}</div></td>
      <td class="col-official col-extra"><div class="cell-text" style="font-size:13px;color:var(--accent);font-weight:600;">${r.공식완료일||'-'}</div></td>
      <td class="col-constraint col-extra"><div class="cell-text" style="font-size:13px;color:var(--text-2);">${r.제약사유||'-'}</div></td>
      <td class="col-support col-extra"><div class="cell-text" style="font-size:13px;color:var(--text-2);">${r.필요지원||'-'}</div></td>
      <td class="col-measure col-extra"><div class="cell-text" style="font-size:13px;">${r.측정유형||'-'}</div></td>
      <td class="col-asis col-extra"><div class="cell-text" style="font-size:13px;">${r.AsIs||'-'}</div></td>
      <td class="col-tobe col-extra"><div class="cell-text" style="font-size:13px;">${r.ToBe||'-'}</div></td>
      <td class="col-effect col-extra"><div class="cell-text" style="font-size:13px;color:var(--info);">${r.기대효과||'-'}</div></td>
      <td class="col-cycle col-extra"><div class="cell-text" style="font-size:13px;text-align:center;">${r.측정주기||'-'}</div></td>
      <td class="col-note col-extra"><div class="cell-text" style="font-size:13px;color:var(--text-2);">${r.비고||'-'}</div></td>
      <td class="col-modified col-extra">${r._수정일 ? `<div class="cell-modified">${r._수정일}</div>` : `<div class="cell-modified-none">-</div>`}</td>
      <td class="col-action"><button class="btn-edit" onclick="openEdit(${r.no})">✏️ 수정</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('statVisible').textContent = rows.length;
  document.getElementById('statStart').textContent = rows.filter(r=>r.착수상태==='착수').length;
  document.getElementById('statNot').textContent = rows.filter(r=>r.착수상태==='미착수').length;
  const ap = rows.filter(r=>r.착수상태);
  document.getElementById('statAvg').textContent = ap.length ? Math.round(ap.reduce((s,d)=>s+d.진척률,0)/ap.length*100) : 0;
  syncFloatingHeaderMode();
  updateTaskStickyOffset();
}

function applyFilter() {
  const person = document.getElementById('filterPerson').value;
  const status = document.getElementById('filterStatus').value;
  const aiuse = document.getElementById('filterAiUse').value;
  const target = normalizeTarget(document.getElementById('filterTarget').value);
  const search = document.getElementById('searchInput').value.toLowerCase();
  const recent = document.getElementById('filterRecent').value;
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  renderTable(data.filter(r=>{
    const recentOk = !recent || (r._수정ts !== null && (now - r._수정ts) <= weekMs);
    const isAiUse = isAiUseRow(r);
    const aiuseOk = !aiuse || (aiuse==='활용' ? isAiUse : !isAiUse);
    return (!person || (r.담당자&&r.담당자.includes(person)))
      && (!status || r.착수상태===status)
      && (!target || normalizeTarget(r.목표완료)===target)
      && aiuseOk
      && (!search || r.태스크.toLowerCase().includes(search)||(r.에이전트||'').toLowerCase().includes(search))
      && recentOk;
  }));
}

function resetFilter() {
  ['filterPerson','filterStatus','filterAiUse','filterTarget','filterRecent'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('searchInput').value='';
  renderTable(data);
}

// ── 편집 모달 ────────────────────────────
// 편집 가능 필드 매핑: data 키 ↔ DOM ID. 진척률은 슬라이더로 별도 처리.
// Firebase에는 안분 파생값(_연동·표시용 진척률)이 아닌 자체 값만 남긴다
function sanitizeForSave(row) {
  const out = { ...row };
  if (out._연동) {
    out.진척률 = out._자체진척률 || 0;
    out.착수상태 = out._자체착수상태 || '';
  }
  delete out._연동; delete out._연동과제;
  delete out._자체진척률; delete out._자체착수상태;
  return out;
}
window._sanitizeForSave = sanitizeForSave;

const EDITABLE_FIELDS = [
  ['영역','m_area'],['프로세스','m_process'],['에이전트','m_agent'],
  ['태스크','m_task'],
  ['담당자','m_person'],['목표완료','m_target'],['공식완료일','m_official'],
  ['shift','m_shift'],['과제유형','m_type'],['우선순위','m_priority'],
  ['AI활용가능','m_aiuse'],['구현방법','m_method'],['착수상태','m_status'],
  ['AsIs','m_asis'],['ToBe','m_tobe'],['기대효과','m_effect'],
  ['제약사유','m_constraint'],['필요지원','m_support'],
  ['측정유형','m_measure'],['측정주기','m_cycle'],['비고','m_note']
];

function openEdit(no) {
  if (viewingWeek !== null) { showToast('스냅샷 보기 모드에서는 수정할 수 없습니다'); return; }
  const r = data.find(d=>d.no===no);
  currentEditNo = no;
  document.getElementById('modalTitle').textContent = `No.${no} — ${r.에이전트||'항목'} 수정`;
  EDITABLE_FIELDS.forEach(([key,id])=>{
    const el = document.getElementById(id);
    if(el) el.value = r[key]==null ? '' : r[key];
  });
  // 활용계획 → 4칸 분해 (현재 업무 / 구현 / 작동 / 산출물)
  // 레거시(태그 없는) 행은 To-Be 원문을 '작동' 칸에 표시 → 수정 시 점진적으로 새 양식 전환
  const pp = parsePlan(r.활용계획);
  document.getElementById('m_plan_asis').value = pp.asis;
  document.getElementById('m_plan_impl').value = pp.impl;
  document.getElementById('m_plan_flow').value = pp.flow;
  document.getElementById('m_plan_out').value = pp.out;
  const pct = Math.round((r.진척률||0)*100);
  const slider = document.getElementById('m_progress');
  slider.value = pct;
  document.getElementById('m_progress_val').textContent = pct+'%';
  // 흡수된 원과제는 진척률을 재편 과제에서만 편집한다 (이중 관리 방지)
  const lock = document.getElementById('m_progress_lock');
  slider.disabled = !!r._연동;
  if (lock) {
    lock.style.display = r._연동 ? 'flex' : 'none';
    if (r._연동) {
      lock.innerHTML = `이 과제는 <b>AI 과제 ${r._연동과제}번</b>에 흡수되어 진척률이 자동 안분됩니다 (자체 값과 상위 과제 값 중 높은 쪽).
        수정하려면 <button type="button" class="linkbtn" onclick="closeModal();goToV2Task(${r._연동과제})">과제 ${r._연동과제}로 이동</button>
        <span class="muted">(안분 전 자체 값 ${Math.round((r._자체진척률||0)*100)}%)</span>`;
    }
  }
  document.getElementById('m_memo').value = '';
  document.getElementById('editModal').classList.add('open');
}

function closeModal() { document.getElementById('editModal').classList.remove('open'); currentEditNo=null; }

function saveEdit() {
  if(!currentEditNo) return;
  const idx = data.findIndex(d=>d.no===currentEditNo);
  const orig = { ...data[idx] };  // 저장 전 현재 값 스냅샷 (변경 로그 비교 기준 — RAW가 아닌 현재값)
  const memo = document.getElementById('m_memo').value.trim();

  // 1) 모든 편집 필드 수집 + 변경분 추출
  const 변경내역 = {};
  EDITABLE_FIELDS.forEach(([key,id])=>{
    const el = document.getElementById(id);
    if(!el) return;
    const newVal = el.value;
    const oldVal = orig[key]==null ? '' : String(orig[key]);
    if(newVal !== oldVal) {
      변경내역[key] = { 이전: oldVal, 이후: newVal };
    }
    data[idx][key] = newVal;
    if (key === '착수상태' && !data[idx]._연동) data[idx]._자체착수상태 = newVal;
  });

  // 1-b) 활용계획: 4칸 재조립 → 단일 문자열 저장 (Firebase·로그 호환)
  {
    const oldPlan = orig.활용계획==null ? '' : String(orig.활용계획);
    const newPlan = assemblePlan(
      document.getElementById('m_plan_asis').value,
      document.getElementById('m_plan_impl').value,
      document.getElementById('m_plan_flow').value,
      document.getElementById('m_plan_out').value,
      data[idx].활용계획 || ''
    );
    if(newPlan !== oldPlan) {
      변경내역['활용계획'] = { 이전: oldPlan, 이후: newPlan };
    }
    data[idx].활용계획 = newPlan;
  }

  // 2) 진척률 (0~1 정규화)
  //    흡수된 행은 재편 과제에서 안분된 값이므로 자체 값만 갱신하고 표시값은 건드리지 않는다
  if (data[idx]._연동) {
    data[idx].진척률 = orig.진척률;
  } else {
    const newProgress = parseInt(document.getElementById('m_progress').value)/100;
    const oldProgress = orig.진척률 || 0;
    if(newProgress !== oldProgress) {
      변경내역['진척률'] = { 이전: Math.round(oldProgress*100)+'%', 이후: Math.round(newProgress*100)+'%' };
    }
    data[idx].진척률 = newProgress;
    data[idx]._자체진척률 = newProgress;
  }

  // 3) 수정 타임스탬프
  const nowTs = new Date();
  data[idx]._수정ts = nowTs.getTime();
  data[idx]._수정일 = nowTs.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'}) + ' ' + nowTs.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});

  // 4) 변경분 또는 메모가 있으면 로그 기록
  const hasChange = Object.keys(변경내역).length > 0;
  if(hasChange || memo) {
    const logEntry = {
      no: currentEditNo,
      수정시각: nowTs.toLocaleString('ko-KR'),
      _ts: nowTs.getTime(),
      변경내역: 변경내역,
      메모: memo
    };
    changes[currentEditNo] = { ...logEntry, 현재값: { ...data[idx] } };
    // Firebase에 영구 저장
    if (typeof window._firebaseSaveLog === 'function') {
      window._firebaseSaveLog(logEntry);
    }
  } else {
    delete changes[currentEditNo];
  }

  closeModal(); applyFilter(); updateLog();
  showToast(`No.${currentEditNo} 저장됨${hasChange?` · ${Object.keys(변경내역).length}개 항목 변경`:memo?' · 메모 기록':''}`);

  // 5) Firebase 자동저장 — 안분된 표시값이 아니라 자체 값을 저장한다
  if (typeof window._firebaseAutoSave === 'function') {
    window._firebaseAutoSave(data[idx].no, sanitizeForSave(data[idx]));
  } else {
    document.getElementById('lastSave').textContent = nowTs.toLocaleString('ko-KR');
  }
}

// ── 컬럼 모드 토글 (compact ↔ wide) ─────────
function toggleColumns() {
  const wrap = document.getElementById('tableWrap');
  const sw = document.getElementById('colSwitch');
  if(wrap.classList.contains('compact')) {
    wrap.classList.remove('compact'); wrap.classList.add('wide');
    sw.classList.add('on'); sw.setAttribute('aria-checked','true');
  } else {
    wrap.classList.remove('wide'); wrap.classList.add('compact');
    sw.classList.remove('on'); sw.setAttribute('aria-checked','false');
  }
  syncFloatingHeaderMode();
  updateTaskStickyOffset();
}


// ── 변경 로그 ────────────────────────────
const FIELD_LABELS = {
  영역:'업무영역', 프로세스:'프로세스', 에이전트:'에이전트', 태스크:'세부태스크',
  활용계획:'AI 활용계획', 담당자:'담당자', 목표완료:'목표완료', 공식완료일:'공식완료일',
  shift:'SHIFT', 과제유형:'과제유형', 우선순위:'우선순위', AI활용가능:'AI활용가능',
  구현방법:'구현방법', 착수상태:'착수상태', 진척률:'진척률',
  AsIs:'As-Is', ToBe:'To-Be', 기대효과:'기대효과',
  제약사유:'제약사유', 필요지원:'필요지원', 측정유형:'측정유형', 측정주기:'측정주기', 비고:'비고',
  지연사유:'지연사유',
  // 재편 트랙(v2.js) 필드
  title:'과제명', impl:'구현', flow:'작동', out:'산출물',
  person:'담당자', target:'목표완료', note:'비고·제약'
};

function updateLog() {
  const wrap = document.getElementById('logWrap');
  const empty = document.getElementById('logEmpty');
  const filterDays = parseInt(document.getElementById('filterLogRecent')?.value) || 0;

  // Firebase 로그 우선, 없으면 세션 changes 사용
  let logs = _allLogs.length > 0 ? [..._allLogs] : Object.values(changes);

  // 최근 1주일 필터
  if (filterDays > 0) {
    const cutoff = Date.now() - filterDays * 24 * 60 * 60 * 1000;
    logs = logs.filter(c => (c._ts || 0) >= cutoff);
  }

  // 최신순 정렬
  logs.sort((a, b) => (b._ts || 0) - (a._ts || 0));

  empty.style.display = logs.length === 0 ? 'block' : 'none';
  wrap.querySelectorAll('.log-item, .log-date-header').forEach(e => e.remove());

  const countEl = document.getElementById('logCount');
  if (countEl) countEl.textContent = logs.length;

  // 날짜별 그룹핑
  let lastDate = '';
  logs.forEach(c => {
    // 날짜 문자열 (그룹 헤더용)
    const dateStr = c._ts
      ? new Date(c._ts).toLocaleDateString('ko-KR', {year:'numeric', month:'long', day:'numeric', weekday:'short'})
      : (c.수정시각 || '').split(' ').slice(0, 2).join(' ');
    // 시간 문자열 (카드 우측)
    const timeStr = c._ts
      ? new Date(c._ts).toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'})
      : (c.수정시각 || '').split(' ').slice(2).join(' ');

    // 날짜가 바뀔 때 구분 헤더 삽입
    if (dateStr !== lastDate) {
      const dh = document.createElement('div');
      dh.className = 'log-date-header';
      dh.textContent = dateStr;
      wrap.appendChild(dh);
      lastDate = dateStr;
    }

    const chg = c.변경내역 || {};
    const fieldRows = Object.entries(chg)
      .filter(([, v]) => v.이전 !== v.이후)
      .map(([k, v]) => `
        <div class="log-row">
          <span class="log-field">${FIELD_LABELS[k] || k}</span>
          <span class="log-before">${String(v.이전 || '').substring(0, 80) || '(없음)'}</span>
          <span class="log-arrow">→</span>
          <span class="log-after">${String(v.이후 || '').substring(0, 80) || '(없음)'}</span>
        </div>`).join('');
    const noFields = fieldRows.length === 0
      ? `<div style="font-size:11px;color:var(--text-2);font-style:italic;padding:4px 0;">필드 변경 없음 · 메모만 기록</div>`
      : '';

    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML = `
      <div class="log-header">
        <span class="log-track ${c.트랙 === '재편' ? 'v2' : 'legacy'}">${c.트랙 === '재편' ? '재편' : '원과제'}</span>
        <span class="log-no">${c.트랙 === '재편' ? '과제 ' + c.no : 'No.' + c.no}</span>
        <span class="log-time">${timeStr}</span>
      </div>
      ${fieldRows}${noFields}
      ${c.메모 ? `<div class="log-memo">💬 ${c.메모}</div>` : ''}`;
    wrap.appendChild(div);
  });
}

// ── 주차별 자동 이력 관리 ────────────────────────────
function getWeekLabel(d) {
  d = d || new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const firstDay = new Date(year, d.getMonth(), 1).getDay();
  const week = Math.ceil((d.getDate() + firstDay) / 7);
  return year + '년 ' + month + '월 ' + week + '주차';
}

function getWeekKey(d) {
  d = d || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth()+1).padStart(2,'0');
  const firstDay = new Date(year, d.getMonth(), 1).getDay();
  const week = Math.ceil((d.getDate() + firstDay) / 7);
  return year + '_' + month + '_W' + week;
}

// 임의 일자가 속한 주의 월요일(00:00)
function getMondayOf(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0=일, 1=월 ...
  const diff = (day === 0) ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}

// 임의 일자가 속한 주의 금요일 12:00
function getFridayNoonOf(d) {
  const mon = getMondayOf(d);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  fri.setHours(12,0,0,0);
  return fri;
}

// "2026.5.1 (금) 12:00" 같은 표시
function formatFridayNoon(fri) {
  return fri.getFullYear() + '.' + (fri.getMonth()+1) + '.' + fri.getDate() + ' (금) 12:00';
}

let weeklyHistory = {};

// 페이지 로드 시: Firebase에서 기존 이력 가져온 뒤
//   - 이번 주 금요일 12:00 이후 + 미기록 → 1회만 기록 (savedAt = 금 12:00 고정)
//   - 그 외에는 기록하지 않음 (다음 금요일 안내)
function autoRecordWeekly() {
  const now = new Date();
  const monday = getMondayOf(now);
  const fridayNoon = getFridayNoonOf(now);
  const key = getWeekKey(monday);
  const label = getWeekLabel(monday);
  const tag = document.getElementById('weeklyAutoTag');

  const setTag = (msg) => { if(tag) tag.textContent = msg; };

  const proceed = (remote) => {
    if (remote) weeklyHistory = {...remote};

    const alreadyRecorded = !!weeklyHistory[key];
    const passedFridayNoon = now.getTime() >= fridayNoon.getTime();
    // 당일(금요일) 재기록 허용: 최초 저장 시 Firebase 로드 전 RAW 데이터로 잘못 저장될 수 있으므로
    // 금요일 당일에는 Firebase 데이터가 반영된 후 재기록해 덮어씀
    const isSameDayAsFriday = now.getFullYear()===fridayNoon.getFullYear()
      && now.getMonth()===fridayNoon.getMonth()
      && now.getDate()===fridayNoon.getDate();
    const shouldOverwrite = alreadyRecorded && isSameDayAsFriday
      && weeklyHistory[key].anchorAt === fridayNoon.getTime();

    if (passedFridayNoon && (!alreadyRecorded || shouldOverwrite)) {
      // 금요일 12:00 지났고 아직 기록 없음 → 기록
      // 스냅샷 보기 중에는 전역 data가 과거 주차 사본이므로, 반드시 라이브 데이터로 기록
      // (과거 스냅샷이 이번 주 기록으로 잘못 저장되어 추이 차트·KPI를 오염시키는 것 방지)
      const src = (viewingWeek !== null && liveData) ? liveData : data;
      const active = src.filter(d=>d.착수상태);
      const started = src.filter(d=>d.착수상태==='착수');
      const notStarted = src.filter(d=>d.착수상태==='미착수');
      const done = src.filter(d=>d.진척률>=1.0 && d.착수상태==='착수');
      const avg = active.length ? Math.round(active.reduce((s,d)=>s+d.진척률,0)/active.length*100) : 0;
      const record = {
        label,
        착수: started.length,
        미착수: notStarted.length,
        평균진척률: avg,
        완료: done.length,
        완료율: active.length ? Math.round(done.length/active.length*100) : 0,
        savedAt: fridayNoon.toLocaleString('ko-KR'),
        anchorAt: fridayNoon.getTime(),
        tasks: JSON.parse(JSON.stringify(src))
      };
      weeklyHistory[key] = record;

      // Firebase 저장
      try {
        const updates = {};
        updates['okh_audit/weekly/' + key] = record;
        import("https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js")
          .then(({getDatabase, ref, update}) => {
            if (window._fbApp) {
              const db = getDatabase(window._fbApp);
              update(ref(db), updates)
                .then(() => setTag(label + ' 자동 기록됨 ✓ · ' + formatFridayNoon(fridayNoon)))
                .catch(()=>{});
            }
          }).catch(()=>{});
      } catch(e) {}
      setTag(label + ' 자동 기록됨 ✓ · ' + formatFridayNoon(fridayNoon));
    } else if (alreadyRecorded) {
      setTag(label + ' 기록 완료 · ' + (weeklyHistory[key].savedAt || formatFridayNoon(fridayNoon)));
    } else {
      // 아직 금요일 12:00 전 — 다음 자동 기록 시점 안내
      setTag('다음 자동 기록: ' + formatFridayNoon(fridayNoon));
    }
    renderWeeklyChart();
  };

  // Firebase에서 기존 이력 가져오기
  try {
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js")
      .then(({getDatabase, ref, onValue}) => {
        if (window._fbApp) {
          const db = getDatabase(window._fbApp);
          onValue(ref(db, 'okh_audit/weekly'), (snap) => {
            proceed(snap.val());
          }, {onlyOnce: true});
        } else {
          proceed(null);
        }
      }).catch(()=>proceed(null));
  } catch(e) { proceed(null); }
}

function loadWeeklyHistory() {
  autoRecordWeekly();
}

function renderWeeklyNav() {
  const nav = document.getElementById('weeklyNav');
  if (!nav) return;
  const keys = Object.keys(weeklyHistory).sort().reverse();
  // 라이브 항목은 유지하고, 그 아래에 주차 목록 갱신
  const liveHtml = `<div class="tab ${viewingWeek===null?'active':''}" onclick="exitSnapshotMode()" id="weeklyNavLive"><span class="ico">🟢</span><span>현재 (Live)</span></div>`;
  const items = keys.map(k => {
    const s = weeklyHistory[k];
    const hasSnapshot = Array.isArray(s.tasks);
    const icon = hasSnapshot ? '📌' : '📊';
    const isActive = viewingWeek === k;
    return `<div class="tab ${isActive?'active':''}" data-week="${k}" onclick="enterSnapshotMode('${k}')" title="${hasSnapshot?'클릭하여 스냅샷 보기':'집계만 기록됨 (스냅샷 없음)'}"><span class="ico">${icon}</span><span style="flex:1;">${s.label}</span><span style="font-size:11px;color:var(--text-2);">${s.평균진척률}%</span></div>`;
  }).join('');
  nav.innerHTML = liveHtml + items;
}

function renderWeeklyChart() {
  renderWeeklyNav();
  renderTrendChart();
  renderKpiDeltas();
  // 재편 트랙 추이는 이 주차 이력을 재집계해 그린다 (이력 도착 후 재렌더 필요)
  if (typeof window._v2RenderTrend === 'function') window._v2RenderTrend();
  const keys = Object.keys(weeklyHistory).sort().reverse(); // 최신 주차가 위로
  const el = document.getElementById('weeklyTable');
  if (!el) return;
  if (keys.length === 0) {
    el.innerHTML = '<div style="color:#667085;padding:16px;font-size:13px;">이번 주 데이터 기록 중...</div>';
    return;
  }
  const items = keys.map((k, i) => {
    const s = weeklyHistory[k];
    const isLatest = i === 0;
    return `<div style="display:flex;align-items:center;gap:0;padding:12px 14px;border-bottom:1px solid #EAECF0;background:${isLatest?'#EEF0FE':'#fff'};${isLatest?'border-left:3px solid #4F46E5;':'border-left:3px solid transparent;'}">
      <div style="width:130px;font-weight:${isLatest?'700':'500'};font-size:13px;color:#101828;">
        ${s.label}${isLatest?' <span style="font-size:11px;color:#4F46E5;">●</span>':''}
      </div>
      <div style="flex:1;display:flex;gap:24px;flex-wrap:wrap;">
        <span style="font-size:13px;color:#475467;">착수 <strong style="color:#4F46E5;">${s.착수}건</strong></span>
        <span style="font-size:13px;color:#475467;">미착수 <strong style="color:#667085;">${s.미착수}건</strong></span>
        <span style="font-size:13px;color:#475467;">평균진척률 <strong style="color:#4F46E5;">${s.평균진척률}%</strong></span>
        <span style="font-size:13px;color:#475467;">완료 <strong style="color:#4F46E5;">${s.완료}건 (${s.완료율}%)</strong></span>
      </div>
      <div style="font-size:11px;color:#667085;white-space:nowrap;">${s.savedAt||''}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<div style="border:1px solid #eee;border-radius:6px;overflow:hidden;">${items}</div>`;
}

// ── 주차별 추이 라인 차트 (평균진척률 %, 착수·완료 건수) ──────
function renderTrendChart() {
  const canvas = document.getElementById('chartTrend');
  const wrap = document.getElementById('chartTrendWrap');
  if (!canvas || !wrap) return;
  const keys = Object.keys(weeklyHistory).sort(); // 과거 → 최신
  if (keys.length === 0) { wrap.style.display = 'none'; destroyChart('chartTrend'); return; }
  wrap.style.display = '';
  const labels = keys.map(k => (weeklyHistory[k].label || k).replace(/^\d{4}년\s*/, ''));
  const avgs   = keys.map(k => weeklyHistory[k].평균진척률 || 0);
  const starts = keys.map(k => weeklyHistory[k].착수 || 0);
  const dones  = keys.map(k => weeklyHistory[k].완료 || 0);
  destroyChart('chartTrend');
  charts['chartTrend'] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [
      { label:'평균 진척률(%)', data:avgs, yAxisID:'y', borderColor:'#F59E0B', backgroundColor:'rgba(245,158,11,.10)', fill:true, tension:.3, pointRadius:4, pointBackgroundColor:'#F59E0B', borderWidth:2 },
      { label:'착수(건)', data:starts, yAxisID:'y2', borderColor:'#4F46E5', backgroundColor:'#4F46E5', fill:false, tension:.3, pointRadius:3, borderWidth:2 },
      { label:'완료(건)', data:dones, yAxisID:'y2', borderColor:'#EC4899', backgroundColor:'#EC4899', fill:false, tension:.3, pointRadius:3, borderWidth:2 }
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',font:{family:"'Pretendard',sans-serif",size:12},color:'#475467',padding:14}}},
      scales:{
        x:{grid:{display:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'}},
        y:{min:0,max:100,position:'left',title:{display:true,text:'진척률(%)',font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'},grid:{color:'#F3F4F6',drawBorder:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'}},
        y2:{position:'right',beginAtZero:true,suggestedMax:Math.max(5,...starts)+5,title:{display:true,text:'건수',font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3'},grid:{display:false},ticks:{font:{family:"'Pretendard',sans-serif",size:11},color:'#98A2B3',precision:0}}
      }
    }
  });
}

// ── 엑셀 다운로드 ────────────────────────────
function downloadExcel() {
  const person = document.getElementById('filterPerson').value;
  const status = document.getElementById('filterStatus').value;
  const aiuse = document.getElementById('filterAiUse').value;
  const target = normalizeTarget(document.getElementById('filterTarget').value);
  const search = document.getElementById('searchInput').value.toLowerCase();
  const recent = document.getElementById('filterRecent').value;
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const rows = data.filter(r=>{
    const recentOk = !recent || (r._수정ts !== null && (now - r._수정ts) <= weekMs);
    const isAiUse = isAiUseRow(r);
    const aiuseOk = !aiuse || (aiuse==='활용' ? isAiUse : !isAiUse);
    return (!person || (r.담당자&&r.담당자.includes(person)))
      && (!status || r.착수상태===status)
      && (!target || normalizeTarget(r.목표완료)===target)
      && aiuseOk
      && (!search || r.태스크.toLowerCase().includes(search)||(r.에이전트||'').toLowerCase().includes(search))
      && recentOk;
  });

  const wsData = [
    ['No', '업무영역', '프로세스', '에이전트명', '세부태스크', '현재 업무(As-Is)', 'AI 활용(To-Be)', '담당자', 'SHIFT', '과제유형', '우선순위', 'AI활용가능', '구현방법', '착수상태', '진척률(%)', '안분 전(%)', '연동 AI과제', '재편 처리', '목표완료', '공식완료일', '제약사유', '필요지원', '측정유형', '측정 As-Is', '측정 To-Be', '기대효과', '측정주기', '비고', '최근수정']
  ];
  rows.forEach(r => {
    const pp = parsePlan(r.활용계획);
    wsData.push([
      r.no, r.영역||'', r.프로세스||'', r.에이전트||'', r.태스크||'',
      pp.matched ? pp.asis : (pp.asis||''), pp.matched ? pp.tobe : 'AI 미활용',
      r.담당자||'', r.shift||'', r.과제유형||'', r.우선순위||'',
      r.AI활용가능||'', r.구현방법||'', r.착수상태||'', Math.round(r.진척률*100),
      Math.round((r._자체진척률||0)*100), r._연동과제 ? '과제 '+r._연동과제 : '-',
      (typeof V2_LEGACY_BY_NO!=='undefined' && V2_LEGACY_BY_NO[r.no] ? V2_LEGACY_BY_NO[r.no].action : '-'),
      r.목표완료||'',
      r.공식완료일||'', r.제약사유||'', r.필요지원||'', r.측정유형||'', r.AsIs||'', r.ToBe||'',
      r.기대효과||'', r.측정주기||'', r.비고||'', r._수정일||''
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [
    {wch:5},{wch:25},{wch:20},{wch:30},{wch:45},{wch:35},{wch:60},
    {wch:12},{wch:8},{wch:10},{wch:8},{wch:12},{wch:15},
    {wch:8},{wch:10},{wch:10},{wch:12},{wch:12},{wch:12},{wch:10},{wch:12},{wch:15},{wch:15},{wch:10},
    {wch:20},{wch:20},{wch:40},{wch:10},{wch:20},{wch:14}
  ];
  XLSX.utils.book_append_sheet(wb, ws, '과제목록');
  const d = new Date();
  const ds = d.getFullYear()+''+String(d.getMonth()+1).padStart(2,'0')+''+String(d.getDate()).padStart(2,'0');
  XLSX.writeFile(wb, 'OKH감사부_AI활용계획_'+ds+'.xlsx');
  showToast('엑셀 다운로드 완료 ('+rows.length+'건)');
}

// ── 목표완료 일정 → 과제목록 이동 ────────────────────────────
function goToTask(no) {
  switchTab('tasklist', document.querySelector('.tab[data-tab="tasklist"]'));
  setTimeout(() => {
    resetFilter();
    setTimeout(() => {
      const tbody = document.getElementById('tableBody');
      const rows = tbody.querySelectorAll('tr');
      rows.forEach(tr => {
        const noCell = tr.querySelector('.cell-no');
        if (noCell && parseInt(noCell.textContent) === no) {
          tr.style.background = '#EEF0FE';
          tr.style.outline = '2px solid #4F46E5';
          tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => { tr.style.background=''; tr.style.outline=''; }, 3000);
        }
      });
      showToast('No.'+no+' 항목으로 이동함');
    }, 50);
  }, 100);
}

// ── 내보내기 ────────────────────────────
function downloadJSON(obj,filename) {
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'})); a.download=filename; a.click();
}
function dateStr(){const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;}

function showToast(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000);
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();}});
window.addEventListener('resize', updateTaskStickyOffset);
window.addEventListener('resize', syncHeaderWidths);
window.addEventListener('scroll', updatePinnedTableHeader, { passive: true });

// ── 초기화 ───────────────────────────────
// Firebase 수신 데이터 → 로컬 data 반영
// SYNC_ALWAYS: 항상 원격 값을 신뢰하는 동적 필드 (기존 동작 유지)
const SYNC_ALWAYS = ['태스크','활용계획','착수상태','목표완료','공식완료일','지연사유','_수정일','_수정ts'];
// SYNC_AFTER_VERSION: DATA_VERSION_TS(data.js) 이후 수정분만 반영하는 정적 필드
// → 코드(RAW) 커밋으로 갱신된 값이 과거 Firebase 저장분에 덮이지 않도록 보호
const SYNC_AFTER_VERSION = ['영역','프로세스','에이전트','담당자','shift','과제유형','우선순위',
  'AI활용가능','구현방법','AsIs','ToBe','기대효과','제약사유','필요지원','측정유형','측정주기','비고'];
let _firebaseDataLoaded = false; // Firebase 최초 수신 여부 추적
window._applyRemoteData = function(remote) {
  // 스냅샷 모드 중이면 라이브 백업(liveData)을 갱신하고 화면은 덮어쓰지 않음
  const target = viewingWeek !== null && liveData ? liveData : data;
  Object.entries(remote).forEach(([key, val]) => {
    const idx = target.findIndex(d => d.no === Number(key));
    if (idx === -1) return;
    SYNC_ALWAYS.forEach(field => {
      if (val[field] === undefined) return;
      // 활용계획: 로컬이 새 양식([구현] 태그)이고 원격이 구 양식이면 로컬 유지
      // (2분기 재작성분이 과거 Firebase 저장값에 덮이지 않도록 — 새 양식으로 재저장되면 정상 병합)
      if (field === '활용계획' && /\[구현\]/.test(target[idx].활용계획 || '') && !/\[구현\]/.test(val[field] || '')) return;
      target[idx][field] = val[field];
    });
    // 정적 필드: 이 코드 버전(DATA_VERSION_TS) 이후에 저장된 행만 반영
    if ((parseFloat(val._수정ts) || 0) > DATA_VERSION_TS) {
      SYNC_AFTER_VERSION.forEach(field => {
        if (val[field] === undefined) return;
        target[idx][field] = val[field];
      });
    }
    // Firebase가 보관하는 값은 항상 '안분 전 자체 값'이다.
    // 원격이 값을 준 경우에만 자체 값을 갱신한다 — 안 그러면 두 번째 수신부터
    // 직전에 안분된 표시값을 자체 값으로 잘못 굳혀버린다.
    if (val['진척률'] !== undefined) target[idx]['_자체진척률'] = parseFloat(val['진척률']) || 0;
    if (val['착수상태'] !== undefined) target[idx]['_자체착수상태'] = val['착수상태'];
  });
  // 병합이 끝난 뒤 재편 25건의 진척률을 다시 안분해 덮는다
  if (typeof window._v2ApplyProration === 'function') window._v2ApplyProration(target);
  // 스냅샷 보기 중에는 필터 옵션·화면을 라이브 기준으로 덮지 않음
  // (스냅샷 필터는 enterSnapshotMode가 관리 — 라이브 수신으로 옵션이 어긋나는 문제 방지)
  if (viewingWeek === null) {
    populateTargetFilter(target);
    populatePersonFilter(target);
    applyFilter();
    // 병합된 데이터로 갱신하되, 지금 보고 있는 탭만 다시 그림
    // (매 원격 수신마다 전체 대시보드 차트를 파괴·재생성해 화면이 깜빡이는 것 방지)
    const dash = document.getElementById('tab-dashboard');
    if (dash && dash.classList.contains('active')) renderDashboard();
    const sched = document.getElementById('tab-schedule');
    if (sched && sched.classList.contains('active')) renderSchedule();
    const ag = document.getElementById('tab-agents');
    if (ag && ag.classList.contains('active')) renderAgents();
    // 재편 화면도 원격 수신분을 반영해 다시 그린다 (안분 집계가 RAW 기준으로 굳는 것 방지)
    const cur = document.querySelector('.tab-content.active');
    if (cur && cur.id.startsWith('tab-v2-') && typeof window._v2Render === 'function') {
      window._v2Render(cur.id.slice(4));
    }
  }
  // Firebase 데이터 최초 수신 후 주차 이력 기록 (타이밍 보장)
  if (!_firebaseDataLoaded) {
    _firebaseDataLoaded = true;
    loadWeeklyHistory();
  }
};
window._dashData = data;

function init() {
  // RAW 기준으로도 안분을 먼저 적용해 첫 페인트부터 재편 수치가 보이게 한다
  if (typeof window._v2ApplyProration === 'function') window._v2ApplyProration(data);
  populatePersonFilter(data);
  populateTargetFilter(data);
  const liveWeek = getWeekLabel();
  const fw = document.getElementById('footWeek'); if (fw) fw.textContent = liveWeek;
  const tw = document.getElementById('topWeek'); if (tw) tw.textContent = liveWeek;
  bindFloatingHeaderScroll();
  syncFloatingHeaderMode();
  renderTable(data);
  renderDashboard();
  // loadWeeklyHistory()는 _applyRemoteData(Firebase 최초 수신) 후 실행됨
  // → Firebase 데이터 반영 전에 RAW 데이터로 스냅샷이 저장되는 타이밍 버그 방지
}
document.addEventListener('DOMContentLoaded', init);
