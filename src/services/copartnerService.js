import axios from 'axios';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Copartner API에서 기업정보를 조회하고 핵심 필드만 추출해 반환.
 * 실패 시 null 반환 (조용히 무시).
 *
 * @param {string} bznoOrName - 사업자번호 또는 회사명
 * @param {string} [ceo] - 대표자명 (선택)
 * @returns {Promise<object|null>}
 */
export async function searchCompany(bznoOrName, ceo = '') {
  try {
    logger.info(`Copartner 조회: bznoOrName="${bznoOrName}", ceo="${ceo}"`);

    const response = await axios.post(
      `${config.copartner.baseUrl}/search`,
      { bznoOrName, ceo },
      { timeout: 60000 }
    );

    const raw = response.data;

    // 응답 구조: raw.result or raw 자체가 결과인 경우 모두 처리
    const result = raw?.result ?? raw;

    if (!result) {
      logger.warn('Copartner 응답이 비어있습니다.');
      return null;
    }

    // 기본 정보
    const basic = result?.basic_result?.val ?? {};
    // 상세 정보
    const summary = result?.detail_result?.val?.summary ?? {};

    // 대표자 정보
    const repInfo = basic?.REP_INFO ?? [];
    const ceoName = repInfo[0]?.NAME ?? ceo ?? '';

    // 주소
    const addrA = basic?.LOC_RDNM_ADDRA ?? '';
    const addrB = basic?.LOC_RDNM_ADDRB ?? '';
    const address = [addrA, addrB].filter(Boolean).join(' ');

    // 임직원수 (KED5002 summary)
    const ked5002 = summary?.KED5002 ?? {};
    const employees = ked5002?.LABORER_SUM ?? null;

    const companyInfo = {
      company: {
        name: basic?.ENP_NM ?? bznoOrName,
        bzno: basic?.BZNO ?? '',
        businessType: basic?.BZC_CD_NM ?? '',
        establishedAt: basic?.ESTB_DT ?? '',
        status: basic?.ENP_SCD ?? '',
      },
      ceo: ceoName,
      address,
      employees,
      raw: result, // 전체 원본 — 진단 시 추가 컨텍스트로 활용
    };

    logger.info(`Copartner 조회 성공: ${companyInfo.company.name}`);
    return companyInfo;
  } catch (err) {
    logger.error(`Copartner 조회 실패: ${err.message}`);
    return null;
  }
}
