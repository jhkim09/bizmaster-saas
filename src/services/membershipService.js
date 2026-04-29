/**
 * membershipService.js
 * Supabase memberships 테이블 CRUD + 쿼터 관리
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

let _client = null;

function getClient() {
  if (!_client) {
    const { url, serviceRoleKey, anonKey } = config.supabase;
    // service_role 키 우선 (RLS 우회 — backend 전용 작업용), 없으면 anon으로 fallback
    const key = serviceRoleKey || anonKey;
    if (!url || !key) {
      logger.warn('Supabase 환경변수 미설정 — membershipService 비활성');
      return null;
    }
    if (!serviceRoleKey) {
      logger.warn('SUPABASE_SERVICE_ROLE_KEY 미설정 — anon 키 사용 중 (RLS 활성화 시 작동 불가)');
    }
    _client = createClient(url, key);
  }
  return _client;
}

/** 플랜별 기본 쿼터 */
const PLAN_QUOTA = {
  standard: { ai: 10, premium: 0 },
  premium:  { ai: 30, premium: 1 },
};

/**
 * 가입일(starts_at) 기준 현재 사이클 시작일 계산
 * 예: starts_at=4/25, 오늘=5/30 → cycleStart=5/25
 *     starts_at=4/25, 오늘=5/10 → cycleStart=4/25 (아직 다음 사이클 시작 안 됨)
 *
 * 가입일 day가 29~31일이면 모든 달에 존재하지 않으므로 매월 1일 리셋으로 정규화.
 * (예: 1/31 가입 + setMonth(+1) → 3/2 로 넘어가는 JS 동작 회피)
 */
function computeCurrentCycleStart(startsAt, now) {
  if (startsAt.getDate() > 28) {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const monthsDiff =
    (now.getFullYear() - startsAt.getFullYear()) * 12 +
    (now.getMonth() - startsAt.getMonth());
  const candidate = new Date(startsAt);
  candidate.setMonth(candidate.getMonth() + monthsDiff);
  // candidate가 미래면 한 달 빼기 (이번 달 사이클이 아직 안 시작됨)
  if (candidate > now) {
    candidate.setMonth(candidate.getMonth() - 1);
  }
  return candidate;
}

/**
 * 월별 쿼터 리셋 처리 (조회 시점에 필요하면 자동 리셋)
 * 가입일(starts_at) 기준 사이클로 동작.
 * 새 사이클이 시작되었는데 quota_reset_at이 그 이전이면 사용량 0으로 초기화.
 */
async function resetMonthlyQuotaIfNeeded(client, member) {
  const now = new Date();
  const startsAt = member.starts_at
    ? new Date(member.starts_at)
    : new Date(member.created_at || now);
  const cycleStart = computeCurrentCycleStart(startsAt, now);
  const lastReset = member.quota_reset_at
    ? new Date(member.quota_reset_at)
    : new Date(0);

  if (lastReset >= cycleStart) return member; // 이미 이번 사이클에서 리셋됨

  const cycleStartStr = cycleStart.toISOString().slice(0, 10);

  const { data, error } = await client
    .from('memberships')
    .update({
      used_ai_this_month:      0,
      used_premium_this_month: 0,
      quota_reset_at:          cycleStartStr,
    })
    .eq('id', member.id)
    .select()
    .single();

  if (error) {
    logger.error(`쿼터 리셋 실패 (id=${member.id}): ${error.message}`);
    return member; // 실패해도 원본 반환 (가용성 우선)
  }
  logger.info(`월별 쿼터 리셋 완료: ${member.email} (사이클 시작: ${cycleStartStr})`);
  return data;
}

/**
 * 이메일로 활성 멤버 조회
 * @param {string} email
 * @returns {Promise<object|null>}
 */
export async function getActiveMemberByEmail(email) {
  if (!email) return null;
  const client = getClient();
  if (!client) return null;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await client
      .from('memberships')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('is_active', true)
      .gte('expires_at', today)
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error(`멤버 조회 오류 (${email}): ${error.message}`);
      return null;
    }
    if (!data) return null;

    // 필요시 월별 쿼터 리셋
    return await resetMonthlyQuotaIfNeeded(client, data);
  } catch (err) {
    logger.error(`getActiveMemberByEmail 예외: ${err.message}`);
    return null;
  }
}

/**
 * AI 보고서 사용 가능 여부
 */
export function canUseAIReport(member) {
  if (!member) return false;
  return member.used_ai_this_month < member.monthly_quota_ai_report;
}

/**
 * 프리미엄 보고서 사용 가능 여부
 */
export function canUsePremiumReport(member) {
  if (!member) return false;
  return member.used_premium_this_month < member.monthly_quota_premium_report;
}

/**
 * 사용량 기록 (usage 테이블 insert + 카운터 증가)
 * @param {object} member
 * @param {'simple_analysis'|'ai_report'|'premium_report'} serviceType
 * @param {object} [metadata]
 */
export async function recordUsage(member, serviceType, metadata = {}) {
  const client = getClient();
  if (!client || !member) return;

  try {
    // usage 테이블 insert
    await client.from('membership_usage').insert({
      membership_id: member.id,
      email:         member.email,
      service_type:  serviceType,
      metadata:      metadata ?? {},
    });

    // 카운터 증가
    const patch = {};
    if (serviceType === 'ai_report') {
      patch.used_ai_this_month = (member.used_ai_this_month ?? 0) + 1;
    } else if (serviceType === 'premium_report') {
      patch.used_premium_this_month = (member.used_premium_this_month ?? 0) + 1;
    }
    // simple_analysis는 카운터 없음 (횟수 제한 없는 기본 진단)

    if (Object.keys(patch).length) {
      await client.from('memberships').update(patch).eq('id', member.id);
    }
  } catch (err) {
    logger.error(`recordUsage 예외: ${err.message}`);
  }
}

/**
 * 멤버 목록 조회 (관리자용)
 * @param {{ search?: string, status?: 'active'|'expired'|'inactive'|'all' }} opts
 */
export async function listMembers({ search = '', status = 'all' } = {}) {
  const client = getClient();
  if (!client) return [];

  try {
    const today = new Date().toISOString().slice(0, 10);
    let q = client
      .from('memberships')
      .select('*')
      .order('expires_at', { ascending: true });

    if (search) {
      q = q.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }

    if (status === 'active') {
      q = q.eq('is_active', true).gte('expires_at', today);
    } else if (status === 'expired') {
      q = q.eq('is_active', true).lt('expires_at', today);
    } else if (status === 'inactive') {
      q = q.eq('is_active', false);
    }

    const { data, error } = await q;
    if (error) {
      logger.error(`listMembers 오류: ${error.message}`);
      return [];
    }
    return data ?? [];
  } catch (err) {
    logger.error(`listMembers 예외: ${err.message}`);
    return [];
  }
}

/**
 * 신규 멤버 등록
 * @param {{ email, name, plan, startsAt, expiresAt, note }} fields
 */
export async function createMember({ email, name, plan, startsAt, expiresAt, note }) {
  const client = getClient();
  if (!client) throw new Error('Supabase 미설정');

  const quota = PLAN_QUOTA[plan];
  if (!quota) throw new Error(`유효하지 않은 플랜: ${plan}`);

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString().slice(0, 10);

  const { data, error } = await client
    .from('memberships')
    .insert({
      email:                       email.toLowerCase().trim(),
      name:                        name ?? null,
      plan,
      starts_at:                   startsAt ?? today,
      expires_at:                  expiresAt,
      monthly_quota_ai_report:     quota.ai,
      monthly_quota_premium_report: quota.premium,
      used_ai_this_month:          0,
      used_premium_this_month:     0,
      quota_reset_at:              firstOfMonth,
      is_active:                   true,
      note:                        note ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * 멤버 정보 수정
 * @param {number} id
 * @param {object} fields — 변경할 필드만 전달
 */
export async function updateMember(id, fields) {
  const client = getClient();
  if (!client) throw new Error('Supabase 미설정');

  // 플랜이 바뀌면 쿼터도 자동 조정
  if (fields.plan && PLAN_QUOTA[fields.plan]) {
    const quota = PLAN_QUOTA[fields.plan];
    fields.monthly_quota_ai_report     = quota.ai;
    fields.monthly_quota_premium_report = quota.premium;
  }

  const { data, error } = await client
    .from('memberships')
    .update(fields)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * 멤버 비활성화 (soft delete)
 */
export async function deactivateMember(id) {
  return updateMember(id, { is_active: false });
}

/**
 * 사용량 가감 (관리자 수동 조정)
 * @param {number} id
 * @param {{ aiDelta?: number, premiumDelta?: number }} deltas
 */
export async function adjustUsage(id, { aiDelta = 0, premiumDelta = 0 } = {}) {
  const client = getClient();
  if (!client) throw new Error('Supabase 미설정');

  const { data: m, error: e1 } = await client
    .from('memberships')
    .select('*')
    .eq('id', id)
    .single();
  if (e1) throw new Error(e1.message);

  const newAi  = Math.max(0, (m.used_ai_this_month ?? 0)      + aiDelta);
  const newPre = Math.max(0, (m.used_premium_this_month ?? 0) + premiumDelta);

  const { data, error } = await client
    .from('memberships')
    .update({
      used_ai_this_month:      newAi,
      used_premium_this_month: newPre,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // 사용 이력 로그 기록 (관리자 수동 조정으로 표시)
  if (aiDelta !== 0 || premiumDelta !== 0) {
    const entries = [];
    if (aiDelta !== 0) {
      entries.push({
        membership_id: id,
        email:         m.email,
        service_type:  'ai_report',
        metadata:      { source: 'admin_manual', delta: aiDelta },
      });
    }
    if (premiumDelta !== 0) {
      entries.push({
        membership_id: id,
        email:         m.email,
        service_type:  'premium_report',
        metadata:      { source: 'admin_manual', delta: premiumDelta },
      });
    }
    if (entries.length) {
      await client.from('membership_usage').insert(entries);
    }
  }

  return data;
}

/**
 * 사용 이력 조회 (멤버 상세용)
 */
export async function getMemberUsage(email, limit = 50) {
  const client = getClient();
  if (!client) return [];

  const { data, error } = await client
    .from('membership_usage')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .order('used_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error(`getMemberUsage 오류: ${error.message}`);
    return [];
  }
  return data ?? [];
}
