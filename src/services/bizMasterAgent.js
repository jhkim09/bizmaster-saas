import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `당신은 한국 중소기업 전문 경영·재무 컨설턴트입니다.
제공된 기업정보를 바탕으로 다음 항목을 분석하세요:

1. 경정청구 가능성: 고용증대 세액공제, R&D 세액공제 누락 여부 추정
2. 정책자금 적합성: 기업규모·업종·설립연도 기준 주요 정책자금 3가지 매칭
3. 미처분이익잉여금: 업력·업종 기준 배당/퇴직금/자사주 전략 방향
4. 즉시 실행 가능한 액션 3가지

응답 형식 (JSON만 반환, 마크다운 코드블록 없이):
{
  "companyName": "회사명",
  "summary": "3줄 핵심 진단",
  "taxRefund": { "possible": true, "estimatedAmount": "추정 환급액 범위", "reason": "근거" },
  "policyFunds": [{ "name": "자금명", "amount": "한도", "match": "적합 이유" }],
  "retainedEarnings": { "strategy": "전략 방향", "urgency": "high" },
  "actions": ["액션1", "액션2", "액션3"],
  "disclaimer": "본 진단은 참고용이며 최종 결정은 세무사/전문가와 확인하세요."
}`;

let _client = null;

function getClient() {
  if (!_client) {
    if (!config.claude.apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
    _client = new Anthropic({ apiKey: config.claude.apiKey });
  }
  return _client;
}

export async function diagnose(companyInfo, input) {
  const client = getClient();

  let contextBlock = '';
  if (companyInfo) {
    contextBlock = `
[기업 기본 정보]
- 회사명: ${companyInfo.company.name}
- 사업자번호: ${companyInfo.company.bzno}
- 업종: ${companyInfo.company.businessType}
- 설립일: ${companyInfo.company.establishedAt}
- 기업상태: ${companyInfo.company.status}
- 대표자: ${companyInfo.ceo}
- 주소: ${companyInfo.address}
- 임직원수: ${companyInfo.employees ?? '불명'}명`.trim();
  } else {
    contextBlock = `
[기업 기본 정보 - 조회 실패, 입력값 기준]
- 회사명: ${input.companyName ?? '미입력'}
- 사업자번호: ${input.bzno ?? '미입력'}
- 대표자: ${input.ceoName ?? '미입력'}`.trim();
  }

  const userMessage = `다음 기업에 대한 경영 진단을 수행해주세요.\n\n${contextBlock}\n\nJSON 형식으로만 응답하세요.`;
  const companyLabel = companyInfo?.company?.name ?? input.companyName;
  logger.info(`Claude 진단 요청: ${companyLabel}`);

  const message = await client.messages.create({
    model: config.claude.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = message.content[0]?.text ?? '';
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    logger.info(`Claude 진단 완료: ${parsed.companyName}`);
    return parsed;
  } catch {
    logger.warn('Claude 응답 JSON 파싱 실패 — 텍스트 폴백');
    return {
      companyName: companyLabel ?? '알 수 없음',
      summary: raw,
      taxRefund: null,
      policyFunds: [],
      retainedEarnings: null,
      actions: [],
      disclaimer: '본 진단은 참고용이며 최종 결정은 세무사/전문가와 확인하세요.',
    };
  }
}
