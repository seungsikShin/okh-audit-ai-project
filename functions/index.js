const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase }  = require("firebase-admin/database");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

const DB_PATH     = "okh_audit/tasks";
const WEEKLY_PATH = "okh_audit/weekly";

// ── 브라우저 app.js 와 동일한 주차 계산 로직 ──────────────
function getMondayOf(d) {
  const x   = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getWeekKey(d) {
  const year      = d.getFullYear();
  const month     = String(d.getMonth() + 1).padStart(2, "0");
  const firstDay  = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  const week      = Math.ceil((d.getDate() + firstDay) / 7);
  return `${year}_${month}_W${week}`;
}

function getWeekLabel(d) {
  const year     = d.getFullYear();
  const month    = d.getMonth() + 1;
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  const week     = Math.ceil((d.getDate() + firstDay) / 7);
  return `${year}년 ${month}월 ${week}주차`;
}

// ── 매주 금요일 12:00 KST 자동 실행 ──────────────────────
exports.weeklySnapshot = onSchedule(
  {
    schedule: "0 12 * * 5",   // 금요일 12:00
    timeZone: "Asia/Seoul",
    region: "asia-northeast3", // 서울 리전
  },
  async () => {
    const db  = getDatabase();
    const now = new Date();

    // 이번 주 월요일 기준으로 key / label 계산
    const monday    = getMondayOf(now);
    const key       = getWeekKey(monday);
    const label     = getWeekLabel(monday);
    const anchorAt  = now.getTime();
    const savedAt   = now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

    // 이미 기록된 주차면 덮어쓰지 않음
    const existSnap = await db.ref(`${WEEKLY_PATH}/${key}`).get();
    if (existSnap.exists()) {
      console.log(`[weeklySnapshot] ${label} 이미 기록됨 — 건너뜀`);
      return;
    }

    // 과제 데이터 읽기
    const taskSnap = await db.ref(DB_PATH).get();
    if (!taskSnap.exists()) {
      console.warn("[weeklySnapshot] 과제 데이터 없음");
      return;
    }

    // Firebase에서 가져온 객체를 배열로 변환 {1:{...}, 2:{...}} → [{...}, ...]
    const raw  = taskSnap.val();
    const rows = Object.values(raw);

    // 통계 계산 (app.js 와 동일)
    const active     = rows.filter(r => r.착수상태);
    const started    = rows.filter(r => r.착수상태 === "착수");
    const notStarted = rows.filter(r => r.착수상태 === "미착수");
    const done       = rows.filter(r => r.진척률 >= 1.0 && r.착수상태 === "착수");
    const avg        = active.length
      ? Math.round(active.reduce((s, r) => s + (parseFloat(r.진척률) || 0), 0) / active.length * 100)
      : 0;

    const record = {
      label,
      착수:     started.length,
      미착수:   notStarted.length,
      평균진척률: avg,
      완료:     done.length,
      완료율:   active.length ? Math.round(done.length / active.length * 100) : 0,
      savedAt,
      anchorAt,
      tasks: rows,
    };

    await db.ref(`${WEEKLY_PATH}/${key}`).set(record);
    console.log(`[weeklySnapshot] ${label} 저장 완료 — 평균진척률 ${avg}%`);
  }
);
