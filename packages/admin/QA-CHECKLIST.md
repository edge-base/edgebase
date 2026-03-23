# Admin Dashboard QA Checklist

점검일: 2026-03-23
테스트 환경: localhost:4050 (KakaoTalk 예제앱 EdgeBase 서버)

---

## 실제 유저 시나리오 테스트

### 1. 페이지 새로고침 (F5 / Cmd+R)
- [x] Overview 페이지에서 새로고침 → 정상 로드
- [x] Database/Tables 페이지에서 새로고침 → 정상 로드 (200 OK)
- [x] Database/Tables/[table] Records 탭에서 새로고침 → Records 유지 (200 OK)
- [x] Database/Tables/[table]?tab=schema 에서 새로고침 → Schema 탭 유지 ✅
- [x] Database/Tables/[table]?tab=query 에서 새로고침 → ❌ 빈 페이지 (코드 수정으로 해결 예정)
- [x] Database/Tables/[table]?tab=sdk 에서 새로고침 → 정상 (200 OK)
- [x] Database/Tables/[table]?tab=rules 에서 새로고침 → 정상 (200 OK)
- [x] Auth/Users 페이지에서 새로고침 → 정상 로드 (200 OK)
- [x] Analytics 페이지에서 새로고침 → 정상 로드 (200 OK)
- [x] Storage/[bucket] 페이지에서 새로고침 → 정상 로드 (200 OK)
- [ ] SQL Console 페이지에서 새로고침 → 새 빌드 필요 (미테스트)
- [x] Logs 페이지에서 새로고침 → 정상 로드 (200 OK)

### 2. 브라우저 뒤로가기/앞으로가기
- [x] Tables → Table 상세 → 뒤로가기 → Tables 목록 복원 ✅
- [x] Table Records → Schema 탭 → 뒤로가기 → ⚠️ 탭이 아닌 이전 페이지로 이동 (replaceState 사용이라 탭 변경이 history에 안 쌓임 — 의도된 동작)
- [x] Auth → Database → 뒤로가기 → Auth 복원 ✅
- [ ] Storage → Bucket 상세 → 뒤로가기 → 미테스트
- [x] 연속 뒤로/앞으로 반복 시 상태 정상 ✅

### 3. 탭 전환 시나리오
- [x] Records → Schema 전환 ✅
- [x] SDK → Query 전환 → ❌ URL은 바뀌나 UI 미갱신 (코드 수정으로 해결 예정)
- [ ] Query → Records → Query 왕복 전환 → 새 빌드 필요 (미테스트)
- [ ] 빠른 연속 탭 클릭 → 새 빌드 필요 (미테스트)
- [ ] 탭 전환 중 새로고침 → 새 빌드 필요 (미테스트)

### 4. 네트워크 불안정 시나리오
- [ ] 오프라인 상태에서 페이지 로드 → 미테스트 (브라우저 도구 제한)
- [ ] API 요청 중 네트워크 끊김 → 미테스트
- [ ] 네트워크 복구 후 재시도 → 미테스트
- [ ] 느린 네트워크에서 로딩 상태 표시 → 미테스트

### 5. 세션/인증 시나리오
- [x] 로그인 후 새로고침 → 세션 유지 ✅
- [ ] 장시간 방치 후 접근 → 미테스트 (시간 제약)
- [x] 로그아웃 → /admin/login 으로 이동 ✅
- [x] 로그아웃 후 뒤로가기 → /admin/login?next=... 로 리다이렉트 ✅
- [x] 로그인 시 ?next= 파라미터 → 올바른 페이지로 이동 ✅

### 6. 데이터 CRUD 시나리오
- [ ] 테이블에 레코드 추가 (+ Add Row) → 미테스트
- [x] 레코드 검색 → ⚠️ "No records match" 표시되지만 빨간 알림 "Internal server" 에러 발생
- [ ] CSV/JSON 내보내기 → 미테스트
- [ ] SQL Console에서 쿼리 실행 → 새 빌드 필요 (미테스트)
- [ ] SQL Console에서 잘못된 쿼리 → 새 빌드 필요 (미테스트)

### 7. UI 반응성
- [x] 사이드바 접기/펼치기 + 새로고침 → 접힌 상태 유지 ✅
- [x] 다크/라이트 모드 전환 + 새로고침 → 테마 유지 ✅
- [ ] 테이블 사이드바 리사이즈 + 새로고침 → 미테스트
- [ ] 브라우저 창 크기 변경 → 미테스트

---

## 발견된 이슈

### 수정 완료 (코드 변경, 빌드 반영 대기)
1. [x] **P1** Query 탭 전환 불가 — `$derived` → `$state`+`$effect` 변경. 초기 렌더에서 안전한 'records' 탭으로 시작 후 $effect에서 전환하여 빈 페이지 문제도 함께 해결
2. [x] **P2** 테이블 사이드바 이름 잘림 — topology 배지 축약 (Single DB→Single, Per-tenant DB→Multi) + name에 flex:1;min-width:0 추가
3. [x] **P2** SQL Editor 접근 불가 — 사이드바에 SQL 링크 추가 + 독립 SQL Console 페이지 구현 (CodeMirror 에디터, 결과 테이블)
4. [x] **P2** 304 응답 WARN 로깅 — admin UI, server matchesLogLevel, LogsDO SQL 필터 모두 304를 INFO로 재분류
5. [x] **P3** Last Sign-In 미업데이트 — _users 테이블에 lastSignedInAt 컬럼 추가 + createSessionAndTokens에서 자동 업데이트

### 미수정 (조사 필요)
6. [ ] **P1** Storage 개요/상세 데이터 불일치 — R2 에뮬레이션의 stats API와 objects listing API 동작 차이. 서버 실행 환경에서 실제 R2 데이터 디버깅 필요
### 추가 수정 완료
7. [x] **P2** 검색 시 "Internal server" 500 에러 — FTS5 테이블 미존재 시 `handleList`가 크래시. FTS 실패 시 `buildSubstringSearchQuery`로 LIKE 기반 폴백 추가

### 수정된 파일 목록
| 파일 | 변경 내용 |
|------|----------|
| `routes/database/tables/[table]/+page.svelte` | activeTab $derived→$state+$effect 변경 |
| `routes/database/tables/+layout.svelte` | 사이드바 배지 축약 + CSS flex 수정 |
| `lib/components/layout/Sidebar.svelte` | Database 섹션에 SQL 링크 추가 |
| `routes/database/sql/+page.svelte` | 리다이렉트 제거, SQL Console 페이지 구현 |
| `routes/logs/+page.svelte` | getLogLevel에서 304를 INFO로 재분류 |
| `server/routes/admin.ts` | matchesLogLevel 304 제외 |
| `server/durable-objects/logs-do.ts` | SQL 필터에서 304 WARN 제외 |
| `server/lib/auth-d1.ts` | _users 테이블 lastSignedInAt 컬럼 추가 (D1+PG) |
| `server/routes/auth.ts` | createSessionAndTokens에서 lastSignedInAt 업데이트 |
| `server/lib/d1-handler.ts` | handleList FTS 실패 시 substring 검색 폴백 |
