# OKH 감사부 AI 활용계획 통합 대시보드

감사부 AI 전환 과제(80건)의 진척 현황을 팀원이 함께 보고 편집하는 정적 웹 대시보드.
Firebase Realtime Database로 실시간 공유되며, 별도 로그인 없이 사용한다.

- 운영 URL: https://okh-audit-ai-project.vercel.app (Vercel — `main` 브랜치에 push하면 자동 배포)

## 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 골격 (탭 5개: 대시보드 / 분기별 추진 일정 / 과제 목록 / AI 에이전트 / 변경 로그) |
| `data.js` | **과제 원본 데이터 `RAW`** + `DATA_VERSION_TS` (아래 "데이터 운영 규칙" 참고) |
| `app.js` | 렌더링·필터·편집 모달·주간 스냅샷 등 모든 로직 |
| `style.css` | 스타일 |
| `firebase.js` | Firebase 초기화 + 실시간 수신/저장 브리지 (`window._firebase*` 함수들) |
| `functions/` | 주간 스냅샷 Cloud Function 코드 — **현재 미배포** (아래 "주간 스냅샷" 참고) |

로드 순서: `firebase.js`(module) → `data.js` → `app.js`. `app.js`는 `data.js`의 `RAW`/`DATA_VERSION_TS`에 의존하므로 순서를 바꾸면 안 된다.

## Firebase 경로 구조 (Realtime Database)

프로젝트: `ai-audit-project-c66bb` (asia-southeast1)

| 경로 | 내용 | 쓰는 곳 |
|---|---|---|
| `okh_audit/tasks/{no}` | 과제별 최신 값 (편집 저장 시 행 전체 업로드) | 편집 모달 저장 |
| `okh_audit/changelog` | 변경 로그 (push 누적) | 편집 모달 저장 |
| `okh_audit/agentMeta/{code}` | 에이전트별 사용 AI·운영 플랫폼(★) 선택 | AI 에이전트 탭 ★ 클릭 |
| `okh_audit/weekly/{YYYY_MM_Wn}` | 주간 스냅샷 (집계 + 과제 전체 사본 `tasks`) | 브라우저 `autoRecordWeekly` |

## 데이터 운영 규칙 — 어느 값이 이기는가

과제 필드는 두 부류로 나뉜다 (`app.js`의 `SYNC_ALWAYS` / `SYNC_AFTER_VERSION` 참고).

- **동적 필드** (`SYNC_ALWAYS`): 태스크·활용계획·착수상태·목표완료·공식완료일·진척률.
  항상 Firebase 값이 우선. 화면 편집으로 관리한다.
- **정적 필드** (`SYNC_AFTER_VERSION`): 담당자·우선순위·영역·에이전트·기대효과 등 나머지.
  기본은 `data.js`의 `RAW` 값이 우선이고, **`DATA_VERSION_TS` 이후에 화면에서 수정된 행만** Firebase 값이 반영된다.

따라서:

- 정적 필드를 일괄 변경할 때 → `data.js`의 `RAW`를 고쳐 커밋하고, **`DATA_VERSION_TS`를 현재 시각(epoch ms)으로 반드시 갱신**한다. 갱신하지 않으면 과거 Firebase 저장분이 새 코드 값을 도로 덮는다.
- 개별 과제의 일상적 수정 → 화면 편집 모달로 하면 된다 (동적/정적 모두 저장·공유됨).

## 주간 스냅샷 (진척 이력)

- **기록 주체는 브라우저다.** 금요일 12:00(KST) 이후 누군가 대시보드를 열면 `autoRecordWeekly()`가 그 주차 기록을 `okh_audit/weekly`에 저장한다 (금요일 당일 재접속 시 최신 데이터로 덮어씀, `anchorAt`은 금 12:00 고정).
- `functions/index.js`의 Cloud Function(`weeklySnapshot`, 금 12:00 스케줄)은 코드만 있고 **배포된 적이 없다** (2026-07 확인: 기존 기록의 `anchorAt`이 전부 브라우저 시그니처). 배포하려면 `cd functions && npm install && firebase deploy --only functions` — 배포 후에는 브라우저 기록 로직을 읽기 전용으로 바꾸는 걸 검토할 것 (이중 기록 방지 가드는 이미 있음).
- 금요일에 아무도 접속하지 않은 주는 기록이 빈다 (예: 2026_06_W1). Cloud Function을 배포하면 해결된다.
- 사이드바 "진척 이력"에서 주차를 클릭하면 그 주 스냅샷(읽기 전용)을 볼 수 있다.

## 로컬 개발

정적 사이트라 빌드 없음. 로컬에서 열어도 **운영 Firebase에 그대로 연결**되므로 주의.

```bash
python -m http.server 8000   # 후 http://localhost:8000
```

테스트 시 주의:
- 편집 모달 "저장", 에이전트 카드 ★ 클릭은 **운영 데이터를 실제로 변경**한다.
- 금요일 12:00 이후 페이지를 열면 주간 스냅샷이 기록될 수 있다.

## 알려진 이슈 / 검토 과제

- RTDB 보안 규칙이 열려 있음 (로그인 없음) — 규칙 파일(`database.rules.json`) 도입 검토.
- 저장소가 public — 내부 URL/IP가 포함되어 있으므로 private 전환 검토.
- 테이블·로그 렌더링이 `innerHTML` 기반 — 입력값 escape 미적용.
