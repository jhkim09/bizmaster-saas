import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

let _client = null;

function getClient() {
  if (!_client) {
    const { url, anonKey } = config.supabase;
    if (!url || !anonKey) {
      logger.warn('Supabase 환경변수 미설정 — 로깅 비활성화');
      return null;
    }
    _client = createClient(url, anonKey);
  }
  return _client;
}

/**
 * 동일 사업자번호로 이미 진단한 기록이 있는지 확인
 * @param {string} bzno
 * @returns {Promise<boolean>}
 */
export async function isDuplicate(bzno) {
  if (!bzno) return false;
  const client = getClient();
  if (!client) return false;

  try {
    const clean = bzno.replace(/[-\s]/g, '');
    const { data, error } = await client
      .from('diagnose_logs')
      .select('id')
      .eq('bzno', clean)
      .limit(1);

    if (error) {
      logger.error('Supabase 중복 조회 오류:', error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (err) {
    logger.error('Supabase 중복 조회 예외:', err.message);
    return false;
  }
}

/**
 * 진단 결과 로그 저장
 */
export async function saveLog({ bzno, company, ceoName, reqName, email, phone, ip, result }) {
  const client = getClient();
  if (!client) return;

  try {
    const clean = bzno ? bzno.replace(/[-\s]/g, '') : null;
    const { error } = await client.from('diagnose_logs').insert({
      bzno: clean,
      company,
      ceo_name: ceoName,
      req_name: reqName,
      email,
      phone,
      ip,
      result,
    });

    if (error) {
      logger.error('Supabase 로그 저장 오류:', error.message);
    } else {
      logger.info(`진단 로그 저장 완료: ${company} (${clean})`);
    }
  } catch (err) {
    logger.error('Supabase 로그 저장 예외:', err.message);
  }
}
