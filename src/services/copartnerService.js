import axios from 'axios';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

/** KED5003 ACCT_DT (YYYYMMDD) → 연도 */
function extractYear(acctDt) {
  if (!acctDt) return null;
  const s = String(acctDt);
  return s.length >= 4 ? s.slice(0, 4) : null;
}

/** 천원 단위 문자열 → 원 단위 숫자 */
function toKrw(thousandsStr) {
  if (thousandsStr == null || thousandsStr === '') return null;
  const n = Number(thousandsStr);
  return Number.isFinite(n) ? n * 1000 : null;
}

/** 원 단위 → 억/천만원 가독형 (예: 10608310000 → "106.1억") */
export function fmtKrw(n) {
  if (n == null) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return n.toLocaleString();
}

/** KED5003 배열을 최근 연도순 정렬 + 정규화 */
function normalizeFinancials(ked5003) {
  if (!Array.isArray(ked5003)) return [];
  return ked5003
    .map(row => ({
      year: extractYear(row?.ACCT_DT),
      acctDate: String(row?.ACCT_DT ?? ''),
      sales: toKrw(row?.SALES),
      operatingProfit: toKrw(row?.PROFIT),
      netProfit: toKrw(row?.TERMNETPROFIT),
      totalAsset: toKrw(row?.SUMASSET),
      totalEquity: toKrw(row?.FUNDTOTAL),
      paymentFund: toKrw(row?.PAYMENTFUND),
    }))
    .filter(r => r.year)
    .sort((a, b) => b.year.localeCompare(a.year));
}

/**
 * Copartner API에서 기업정보를 조회하고 재무 데이터까지 구조화해 반환.
 * 실패 시 null 반환.
 *
 * @param {string} bznoOrName
 * @param {string} [ceo]
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
    const result = raw?.result ?? raw;

    if (!result) {
      logger.warn('Copartner 응답이 비어있습니다.');
      return null;
    }

    const basic = result?.basic_result?.val ?? {};
    const summary = result?.detail_result?.val?.summary ?? {};

    // 기본 회사 정보
    const ked5002 = summary?.KED5002 ?? {};
    const companyBasic = {
      name: basic?.ENP_NM ?? ked5002?.ENP_NM ?? bznoOrName,
      bzno: basic?.BZNO ?? ked5002?.BZNO ?? '',
      businessType: basic?.BZC_CD_NM ?? ked5002?.PD_NM ?? '',
      establishedAt: basic?.ESTB_DT ?? ked5002?.ESTB_DT ?? '',
      status: basic?.ENP_SCD ?? ked5002?.ENP_SCD ?? '',
      employees: ked5002?.LABORER_SUM ?? null,
      companySize: ked5002?.ENP_SZE ?? '',
      accountingEndDate: ked5002?.ACCT_EDDT ?? '',
    };

    // 대표자
    const repInfo = basic?.REP_INFO ?? summary?.REP_INFO ?? [];
    const ceoName = repInfo[0]?.NAME ?? ceo ?? '';

    // 주소
    const addrA = basic?.LOC_RDNM_ADDRA ?? ked5002?.LOC_RDNM_ADDRA ?? '';
    const addrB = basic?.LOC_RDNM_ADDRB ?? ked5002?.LOC_RDNM_ADDRB ?? '';
    const address = [addrA, addrB].filter(Boolean).join(' ');

    // 재무 데이터 (최대 7년)
    const financials = normalizeFinancials(summary?.KED5003);
    const latest = financials[0] ?? null;
    const prev = financials[1] ?? null;

    // 파생 지표
    let derivedMetrics = null;
    if (latest) {
      const liabilities = latest.totalAsset != null && latest.totalEquity != null
        ? latest.totalAsset - latest.totalEquity : null;
      derivedMetrics = {
        latestYear: latest.year,
        liabilities,
        debtRatio: liabilities != null && latest.totalEquity ? (liabilities / latest.totalEquity * 100) : null,
        operatingMargin: latest.sales && latest.operatingProfit ? (latest.operatingProfit / latest.sales * 100) : null,
        netMargin: latest.sales && latest.netProfit ? (latest.netProfit / latest.sales * 100) : null,
        salesYoy: (prev?.sales && latest.sales) ? ((latest.sales - prev.sales) / prev.sales * 100) : null,
        netProfitYoy: (prev?.netProfit && latest.netProfit) ? ((latest.netProfit - prev.netProfit) / prev.netProfit * 100) : null,
      };
    }

    const reportingYears = financials.map(f => f.year);

    const companyInfo = {
      company: companyBasic,
      ceo: ceoName,
      address,
      employees: companyBasic.employees,
      reportingYears,
      latestReportingYear: reportingYears[0] ?? null,
      financials,          // 연도별 재무 배열 (최근순)
      latestFinancial: latest,
      prevFinancial: prev,
      derivedMetrics,      // 부채비율/영업이익률/YoY 등
      raw: result,
    };

    logger.info(`Copartner 조회 성공: ${companyInfo.company.name} (결산년도 ${reportingYears.join(',')})`);
    return companyInfo;
  } catch (err) {
    logger.error(`Copartner 조회 실패: ${err.message}`);
    return null;
  }
}
