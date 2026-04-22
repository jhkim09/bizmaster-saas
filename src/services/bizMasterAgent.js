import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { fmtKrw } from './copartnerService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _catalog = null;
async function getInsuranceCatalog() {
  if (!_catalog) {
    const p = path.join(__dirname, '..', 'data', 'insurance-catalog.json');
    _catalog = JSON.parse(await readFile(p, 'utf-8'));
  }
  return _catalog;
}

const SYSTEM_PROMPT = `한국 중소기업 경영·재무·절세 컨설턴트. 입력된 기업의 재무데이터와 기본정보를 분석하고 반드시 순수 JSON만 반환한다 (마크다운·설명문 없이).

[반환 JSON 스키마]
{
  "companyName": "회사명",
  "reportingYears": ["YYYY", ...],          // 분석에 사용된 결산연도 (최신순)
  "financialSnapshot": {
    "latestYear": "YYYY",
    "highlights": "재무 핵심 3~4줄 설명 (매출·이익 추이, 자산구조, 재무건전성 판단)",
    "observations": ["관찰 1", "관찰 2", "관찰 3"]
  },
  "summary": "경영·재무 종합 진단 5~8줄 (상황·리스크·기회)",
  "taxRefund": {
    "possible": true,
    "estimatedAmount": "환급 예상 범위 (예: 500만~3,000만)",
    "reasons": ["공제 유형별 근거 2~4개"]
  },
  "policyFunds": [
    { "name": "자금명", "amount": "한도", "match": "적합 이유 60~100자", "deadline": "있으면 기재, 없으면 생략" }
  ],
  "retainedEarnings": {
    "strategy": "100~200자 상세 전략",
    "urgency": "high|medium|low",
    "tactics": ["구체 액션 2~4개"]
  },
  "insuranceRecommendations": [
    {
      "productId": "savings|wholeLife|executiveTerm",
      "displayName": "상품명",
      "matchReason": "이 기업에 적합한 이유 80~120자",
      "expectedEffect": "기대 효과 60~100자",
      "priority": "high|medium"
    }
  ],
  "actions": ["즉시 실행 액션 4~5개, 각 40~80자"]
}

[분석 원칙]
- 재무데이터가 있으면 반드시 연도별 추이·지표를 근거로 판단 (추정 표현 최소화)
- 영업이익률·부채비율·자산회전율 등 구체 지표 언급
- 정책자금은 업종·규모·영업이익·임직원수에 맞춘 2~4개 실제 존재하는 자금 제안
- 보험상품은 제공된 카탈로그 3종(savings/wholeLife/executiveTerm)에서만 선택, 1~2개 추천
- 카탈로그에 없는 상품명 절대 생성 금지
- 영업이익이 3억(KRW 3억 = 300,000,000) 미만이면 executiveTerm 손금 효과 제한적이라 언급
- 부채비율이 높으면(>200%) savings의 재무구조 개선 효과 강조
- 재무데이터가 없으면 입력값만으로 일반적 조언 (단 "재무데이터 미수집" 명시)

간결하지만 내용은 구체적으로. reason·match 같은 필드는 최소 50자 이상 작성해야 정보 가치가 있다.`;

let _client = null;
function getClient() {
  if (!_client) {
    if (!config.claude.apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
    _client = new Anthropic({ apiKey: config.claude.apiKey });
  }
  return _client;
}

function buildFinancialBlock(companyInfo) {
  const fins = companyInfo?.financials ?? [];
  if (!fins.length) return '[재무데이터 미수집]';

  const rows = fins.slice(0, 5).map(f => {
    return `  ${f.year}: 매출 ${fmtKrw(f.sales)} / 영업이익 ${fmtKrw(f.operatingProfit)} / 순이익 ${fmtKrw(f.netProfit)} / 자산 ${fmtKrw(f.totalAsset)} / 자본 ${fmtKrw(f.totalEquity)}`;
  }).join('\n');

  const d = companyInfo.derivedMetrics ?? {};
  const derived = [];
  if (d.operatingMargin != null) derived.push(`영업이익률 ${d.operatingMargin.toFixed(1)}%`);
  if (d.netMargin != null) derived.push(`순이익률 ${d.netMargin.toFixed(1)}%`);
  if (d.debtRatio != null) derived.push(`부채비율 ${d.debtRatio.toFixed(1)}%`);
  if (d.salesYoy != null) derived.push(`매출 YoY ${d.salesYoy.toFixed(1)}%`);
  if (d.netProfitYoy != null) derived.push(`순이익 YoY ${d.netProfitYoy.toFixed(1)}%`);

  return `[연도별 재무 (최근순, 원 단위는 억/만으로 환산 표기)]
${rows}

[파생 지표 (최근 결산 ${d.latestYear ?? '-'} 기준)]
${derived.join(' / ') || '산출 불가'}`;
}

function buildCompanyBlock(companyInfo, input) {
  if (!companyInfo) {
    return `[기업 기본 정보 - 조회 실패, 입력값 기준]
- 회사명: ${input.companyName ?? '미입력'}
- 사업자번호: ${input.bzno ?? '미입력'}
- 대표자: ${input.ceoName ?? '미입력'}`;
  }
  const c = companyInfo.company;
  return `[기업 기본 정보]
- 회사명: ${c.name}
- 사업자번호: ${c.bzno}
- 업종: ${c.businessType}
- 설립일: ${c.establishedAt}
- 기업상태: ${c.status}
- 기업규모: ${c.companySize}
- 대표자: ${companyInfo.ceo}
- 주소: ${companyInfo.address}
- 임직원수: ${companyInfo.employees ?? '불명'}명
- 결산기말: ${c.accountingEndDate}`;
}

export async function diagnose(companyInfo, input) {
  const client = getClient();
  const catalog = await getInsuranceCatalog();

  const companyBlock = buildCompanyBlock(companyInfo, input);
  const financialBlock = buildFinancialBlock(companyInfo);

  // 보험 카탈로그 블록 (간결형)
  const insuranceBlock = catalog.products.map(p =>
    `● [${p.id}] ${p.displayName}
  핵심: ${p.keyBenefit}
  가치: ${p.valueProposition}
  적합 대상: ${p.targetCompany}
  활용: ${p.typicalUseCase.join(' / ')}
  유의: ${p.considerations}`).join('\n\n');

  const userMessage = `다음 기업에 대한 종합 경영 진단을 수행해주세요.

${companyBlock}

${financialBlock}

[보험상품 카탈로그 — 이 3가지만 사용]
${insuranceBlock}

지침:
- 재무 데이터가 존재하면 실제 수치 근거로 판단
- insuranceRecommendations는 위 3개 productId(savings/wholeLife/executiveTerm) 중 1~2개 선택
- JSON 외 어떤 텍스트도 포함하지 말 것`;

  const companyLabel = companyInfo?.company?.name ?? input.companyName;
  logger.info(`Claude 진단 요청: ${companyLabel} (재무 ${companyInfo?.financials?.length ?? 0}년치)`);

  const message = await client.messages.create({
    model: config.claude.model,
    max_tokens: 5000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = message.content[0]?.text ?? '';
  // 코드펜스 제거 후 첫 { 부터 마지막 } 까지 추출 (서문·결어 방어)
  const stripped = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  const cleaned = (first !== -1 && last > first) ? stripped.slice(first, last + 1) : stripped;

  try {
    const parsed = JSON.parse(cleaned);

    // 보험 추천에 카탈로그 원본 메타 병합 (프론트 렌더링 편의)
    if (Array.isArray(parsed.insuranceRecommendations)) {
      parsed.insuranceRecommendations = parsed.insuranceRecommendations
        .map(rec => {
          const catalogItem = catalog.products.find(p => p.id === rec.productId);
          if (!catalogItem) return null; // 카탈로그 밖 상품 필터
          return {
            ...rec,
            displayName: rec.displayName || catalogItem.displayName,
            type: catalogItem.type,
            keyBenefit: catalogItem.keyBenefit,
          };
        })
        .filter(Boolean);
    }

    logger.info(`Claude 진단 완료: ${parsed.companyName}`);
    return parsed;
  } catch (err) {
    logger.warn(`Claude 응답 JSON 파싱 실패: ${err.message}`);
    return {
      companyName: companyLabel ?? '알 수 없음',
      reportingYears: companyInfo?.reportingYears ?? [],
      summary: raw.slice(0, 500),
      financialSnapshot: null,
      taxRefund: null,
      policyFunds: [],
      retainedEarnings: null,
      insuranceRecommendations: [],
      actions: [],
      disclaimer: '본 진단은 참고용이며 최종 결정은 세무사/전문가와 확인하세요.',
    };
  }
}
