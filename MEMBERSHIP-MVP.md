# BizMaster SaaS — 멤버십 시스템 Phase 1 MVP

## 구현 범위

| 항목 | 내용 |
|------|------|
| 플랜 | 스탠다드 (AI 월 10회 / 보고서 50% 할인), 프리미엄 (AI 월 30회 / 보고서 월 1회 무료) |
| 인증 | 이메일 자동 인식 (OTP 없음 — Phase 2 추가 예정) |
| 관리자 | `/admin.html` — 비번 로그인 + 멤버 CRUD |
| Rate Limit | 활성 멤버는 일일 5회 제한 우회 |

---

## 배포 체크리스트

### 1. Supabase SQL 실행

Supabase Dashboard → Database → SQL Editor → New query → 아래 파일 내용 붙여넣기 → Run

```
migrations/001_memberships.sql
```

### 2. Render 환경변수 추가

Render 대시보드 → `bizmaster-saas` 서비스 → Environment → Add Environment Variable

| 키 | 값 |
|----|-----|
| `ADMIN_PASS` | 관리자 비밀번호 (임의 설정, 예: `biz2026!`) |
| `SESSION_SECRET` | 랜덤 32바이트 hex — 아래 명령으로 생성 |

SESSION_SECRET 생성:
```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
```

### 3. CORS 확인

`src/server.js`에 `https://mmtum.co.kr`, `https://www.mmtum.co.kr` 이미 포함되어 있음.
`consulting.html`에서 멤버십 배지 API 호출 시 `credentials: 'include'` 필요.

### 4. 멤버 등록 테스트

1. `https://bizmaster-saas.onrender.com/admin.html` 접속
2. ADMIN_PASS로 로그인
3. "멤버 추가" 탭에서 테스트 이메일 등록 → 환영 이메일 수신 확인
4. `https://bizmaster-saas.onrender.com` 에서 해당 이메일 입력 → 배지 표시 확인

---

## 운영 가이드

### 신규 멤버 등록 흐름

1. 카카오 상담 → 결제 확인
2. `/admin.html` → 멤버 추가 탭 → 이메일/이름/플랜/기간 입력 → 등록
3. 환영 이메일 자동 발송 (AWS SES)
4. 고객이 `bizmaster.mmtum.co.kr` 또는 `mmtum.co.kr/consulting.html` 에서 동일 이메일 입력 → 자동 인식

### 갱신 흐름

1. 고객 카카오 상담 요청
2. `/admin.html` → 멤버 목록 → 해당 멤버 클릭 → `+1개월` / `+3개월` 등 버튼 클릭

### 만료일 색상

- 초록: 정상 활성
- 노랑: 만료 7일 이내 임박
- 빨강: 만료됨

---

## API 목록

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/api/admin/login` | 관리자 로그인 | - |
| POST | `/api/admin/logout` | 로그아웃 | - |
| GET | `/api/admin/me` | 인증 확인 | - |
| GET | `/api/admin/members` | 멤버 목록 (`?search=&status=`) | requireAdmin |
| POST | `/api/admin/members` | 멤버 등록 | requireAdmin |
| PUT | `/api/admin/members/:id` | 멤버 수정 | requireAdmin |
| DELETE | `/api/admin/members/:id` | 멤버 비활성화 (soft) | requireAdmin |
| GET | `/api/admin/members/:email/check` | 이메일 멤버십 확인 | 공개 |
| GET | `/api/admin/members/:email/usage` | 사용 이력 | requireAdmin |

---

## 트러블슈팅

### 환영 이메일 미수신

- AWS SES 발신 도메인 검증 여부 확인 (`admin@mmtum.co.kr`)
- Render 로그에서 `환영 이메일 발송 완료` 또는 실패 메시지 확인

### 멤버십 배지 미표시

- 이메일 정확히 일치하는지 확인 (대소문자 무관, 공백 제거 처리됨)
- 만료일이 오늘 이후인지 확인
- `is_active = true` 인지 Supabase에서 직접 확인

### 중복 이메일 등록 시도

- API에서 409 Conflict 반환
- 기존 멤버 수정은 PUT `/api/admin/members/:id` 사용

### 월별 쿼터 리셋 안 됨

- `quota_reset_at` 컬럼이 현재 월과 다를 때 조회 시점에 자동 리셋됨
- 수동 리셋 필요 시: Supabase SQL에서 `UPDATE memberships SET used_ai_this_month=0, used_premium_this_month=0`

---

## Phase 2 로드맵

- [ ] 만료 3일 전 자동 안내 이메일 (node-cron 또는 Render Cron Job)
- [ ] OTP 이메일 인증 (Phase 1은 이메일 자동 인식만)
- [ ] 마이페이지 (회원 본인용 — 사용 이력, 잔여 횟수 확인)
- [ ] 결제 연동 (Toss Payments 등)
- [ ] RLS (Row Level Security) 적용

---

## Cron Job 설정 예시 (Phase 2 — 만료 임박 알림)

Render Cron Job 또는 서버 내 node-cron:
```
매일 오전 9시 KST (UTC 0:00) 실행
SELECT * FROM memberships WHERE expires_at BETWEEN current_date AND current_date + 3 AND is_active = true
→ sendExpiryAlert() 호출
```
