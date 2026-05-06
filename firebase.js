// ══════════════════════════════════════════════════
//  Firebase 설정 — 배포 전 아래 값을 실제 프로젝트 값으로 교체
// ══════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getDatabase, ref, onValue, update, push, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCfv2UDysdlLw9yhdWBLHeKRhm0tjxU260",
  authDomain:        "ai-audit-project-c66bb.firebaseapp.com",
  databaseURL:       "https://ai-audit-project-c66bb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "ai-audit-project-c66bb",
  storageBucket:     "ai-audit-project-c66bb.firebasestorage.app",
  messagingSenderId: "763599271245",
  appId:             "1:763599271245:web:73aeef5cdb6e07b5ca3304"
};

const DB_PATH  = "okh_audit/tasks";     // Realtime Database 경로
const LOG_PATH = "okh_audit/changelog"; // 변경 로그 경로

// ── 초기화
const app = initializeApp(FIREBASE_CONFIG);
window._fbApp = app;
const db  = getDatabase(app);

function setSaveStatus(state, msg) {
  const dot = document.getElementById('saveDot');
  const txt = document.getElementById('saveStatus');
  if (!dot || !txt) return;
  dot.className = 'save-dot ' + state;
  txt.textContent = msg;
}

// ── 전체 데이터 실시간 수신 (다른 사용자 수정 반영)
window._firebaseListen = function listenDB() {
  setSaveStatus('saving', '연결 중…');
  onValue(ref(db, DB_PATH), (snapshot) => {
    const remote = snapshot.val();
    if (!remote) { setSaveStatus('saved', '데이터 없음 — 최초 업로드 필요'); return; }
    // remote는 {1: {...}, 2: {...}, ...} 형태 (no를 key로)
    if (typeof window._applyRemoteData === 'function') {
      window._applyRemoteData(remote);
    }
    setSaveStatus('saved', '실시간 연결됨');
  }, (err) => {
    setSaveStatus('error', '연결 오류: ' + err.message);
  });
}

// ── 단일 항목 자동저장 (saveEdit 호출 시 트리거)
window._firebaseAutoSave = function autoSave(no, rowData) {
  setSaveStatus('saving', '저장 중…');
  const updates = {};
  updates[DB_PATH + '/' + no] = { ...rowData, _updatedAt: serverTimestamp() };
  update(ref(db), updates)
    .then(() => {
      setSaveStatus('saved', '저장됨 ' + new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
      document.getElementById('lastSave').textContent = new Date().toLocaleString('ko-KR');
    })
    .catch(err => setSaveStatus('error', '저장 실패: ' + err.message));
}

// ── 전체 초기 업로드 (최초 1회, 콘솔에서 window._uploadAll() 호출)
window._uploadAll = function() {
  if (!window._dashData) { console.warn('데이터 없음'); return; }
  const batch = {};
  window._dashData.forEach(r => { batch[DB_PATH + '/' + r.no] = r; });
  update(ref(db), batch).then(() => console.log('전체 업로드 완료')).catch(console.error);
};

// ── 변경 로그 1건 저장 (push로 누적)
window._firebaseSaveLog = function saveLog(entry) {
  push(ref(db, LOG_PATH), { ...entry, _savedAt: serverTimestamp() })
    .catch(err => console.error('로그 저장 실패:', err));
};

// ── 변경 로그 실시간 수신 → app.js의 _applyRemoteLog 호출
window._firebaseListenLog = function listenLog() {
  onValue(ref(db, LOG_PATH), (snapshot) => {
    const raw = snapshot.val();
    const logs = raw
      ? Object.values(raw).sort((a, b) => (b._ts || 0) - (a._ts || 0))
      : [];
    if (typeof window._applyRemoteLog === 'function') {
      window._applyRemoteLog(logs);
    }
  }, (err) => console.error('로그 수신 오류:', err));
};

// DOM 준비 후 리스닝 시작
window.addEventListener('load', () => {
  setTimeout(window._firebaseListen, 800);
  setTimeout(window._firebaseListenLog, 900);
});
