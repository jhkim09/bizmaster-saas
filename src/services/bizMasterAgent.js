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

const SYSTEM_PROMPT = `한국 중소기업 경영·재무·절세·매출확장 컨설턴트. 입력된 기업의 재무데이터와 기본정보를 분석하고 반드시 순수 JSON만 반환한다 (마크다운·설명문 없이).

[출력 형식 원칙]
- 줄글 금지. **모든 핵심 분석은 불릿포인트(개괄식)로 작성**
- **각 섹션 bullets는 정확히 3개**. 가장 임팩트 큰 핵심만 추림
- 각 불릿은 한 문장으로 끝나는 명확한 액션·진단·근거. 40~110자
- 추상적 수사("개선 필요" 등) 금지. 반드시 구체 수치·근거·실행 방안 포함
- \`moreNote\`는 **선택적 필드**. 3개 bullets로 핵심이 충분히 담겼으면 반드시 빈 문자열("")로 둘 것. **억지로 채우지 마라.**
- 진짜로 별도 영역에서 추가 분석할 가치가 명확히 있을 때만 30~60자로 그 **영역 힌트**만 적기 (구체 답·수치 안 적음 — 상세 컨설팅 유도용 티저)
- 모든 섹션이 moreNote를 갖는 건 비정상. 5개 섹션 중 0~2개만 채워지는 게 자연스러움

[반환 JSON 스키마]
{
  "companyName": "회사명",
  "reportingYears": ["YYYY", ...],
  "headline": "한 줄 핵심 결론 (40~70자, 가장 중요한 진단)",
  "financialSnapshot": {
    "latestYear": "YYYY",
    "highlights": "재무 핵심 2~3줄 (매출·이익 추이·재무건전성)",
    "observations": ["관찰 1", "관찰 2", "관찰 3"]
  },
  "sections": {
    "management": {
      "title": "경영관리",
      "bullets": [
        "재무건전성 진단 (영업이익률·부채비율 등 구체 수치)",
        "운영 리스크 또는 강점 핵심 1개",
        "현금흐름·자산구조 핵심 이슈"
      ],
      "moreNote": "예: '조직·인력 효율화 측면 추가 분석 가능' / 추가할 게 없으면 """
    },
    "sales": {
      "title": "매출관리·마케팅 확대",
      "bullets": [
        "현재 매출 구조 진단 + 가장 임팩트 큰 확대 채널 1개 (디지털·B2B 등)",
        "본 기업이 활용할 만한 2025~2026 업종 트렌드 1개",
        "해외매출 또는 라이센싱·IP 사업 가능성 중 적합성 높은 1개"
      ],
      "moreNote": "예: '나머지(해외매출/라이센싱 등) 가능성도 별도 검토 여지' / 추가할 게 없으면 """
    },
    "taxRefund": {
      "title": "경정청구·세액공제",
      "estimatedAmount": "환급 예상 범위 (예: 500만~3,000만 또는 '검토 필요')",
      "possible": true,
      "bullets": [
        "공제 유형별 근거 1 (R&D·고용·중소기업특별세액감면 등)",
        "공제 유형별 근거 2",
        "신청 시 필요 서류·시한"
      ],
      "moreNote": "예: '추가 공제 항목 1~2개 더 검토 가능' / 추가할 게 없으면 """
    },
    "powerCost": {
      "title": "전력비 분석",
      "bullets": [
        "업종·규모 기준 추정 전력비 부담 수준",
        "한전 계약종별 변경 또는 시간대 요금제 활용 가능성",
        "ESS·태양광·에너지 절약 시설 투자세액공제 활용 가능성"
      ],
      "moreNote": "예: '실측 데이터 기반 정밀 절감 분석 별도 가능' / 추가할 게 없으면 """
    },
    "policySupport": {
      "title": "정책지원 검토",
      "bullets": [
        "자금명1 - 한도 - 적합 이유 60~90자",
        "자금명2 - 한도 - 적합 이유",
        "자금명3 - 한도 - 적합 이유"
      ],
      "moreNote": "예: '지자체·업종별 자금까지 확장 검토 가능' / 추가할 게 없으면 """
    }
  },
  "retainedEarnings": {
    "strategy": "100~150자 핵심 전략",
    "urgency": "high|medium|low",
    "tactics": ["구체 액션 2~3개"]
  },
  "insuranceRecommendations": [
    {
      "productId": "savings|wholeLife|executiveTerm",
      "displayName": "상품명",
      "matchReason": "이 기업에 적합한 이유 70~110자",
      "expectedEffect": "기대 효과 60~100자",
      "priority": "high|medium"
    }
  ],
  "actions": ["즉시 실행 액션 4~5개, 각 40~80자"]
}

[분석 원칙]
- 재무데이터가 있으면 반드시 연도별 추이·지표 근거 (영업이익률·부채비율·자산회전율 등)
- 정책자금(policySupport)은 업종·규모·영업이익·임직원수 매칭하여 실제 존재하는 자금 2~3개
- 매출관리(sales)는 4개 불릿 모두 채울 것. 해외매출·라이센싱이 비현실적이면 그 이유와 대안 채널 제시
- 전력비(powerCost)는 재무데이터의 영업비용에서 전력비 비중 추정 가능 시 수치 인용. 추정 어려우면 업종 평균 활용
- 보험(insuranceRecommendations)은 카탈로그 3종(savings/wholeLife/executiveTerm)에서만 1~2개 선택, 카탈로그 외 절대 금지
- 영업이익 3억 미만이면 executiveTerm 손금 효과 제한적 언급, 부채비율>200%면 savings 재무구조 개선 강조
- 재무데이터 부재 시 일반적 조언 + "재무데이터 미수집" 명시

각 bullet은 50~110자. 20자 이하 빈약 표현 금지.`;

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
    max_tokens: 6000,
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
      headline: 'AI 분석 응답 파싱 오류 — 원문 보존',
      financialSnapshot: null,
      sections: {
        management: { title: '경영관리', bullets: [raw.slice(0, 300)] },
        sales: { title: '매출관리·마케팅 확대', bullets: [] },
        taxRefund: { title: '경정청구·세액공제', estimatedAmount: '검토 필요', possible: false, bullets: [] },
        powerCost: { title: '전력비 분석', bullets: [] },
        policySupport: { title: '정책지원 검토', bullets: [] },
      },
      retainedEarnings: null,
      insuranceRecommendations: [],
      actions: [],
      disclaimer: '본 진단은 참고용이며 최종 결정은 세무사/전문가와 확인하세요.',
    };
  }
}
