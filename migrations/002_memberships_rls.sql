-- BizMaster SaaS — Membership Phase 1 MVP
-- 002. RLS 비활성화 (서버에서만 anon 키로 접근하므로 RLS 불필요)
-- Supabase SQL Editor에서 실행

alter table memberships      disable row level security;
alter table membership_usage disable row level security;
