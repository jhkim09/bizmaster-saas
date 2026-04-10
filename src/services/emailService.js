import axios from 'axios';
import logger from '../utils/logger.js';

const WEBHOOK_URL = 'https://hook.eu2.make.com/sguuph5qnft35t52omoq44sqovy3lsjz';

async function sendViaWebhook({ to, cor, descrip }) {
  await axios.post(WEBHOOK_URL, { to, cor, descrip });
}

/**
 * 관리자 알림 — 새 진단 요청 접수
 */
export async function sendAdminAlert({ reqName, email, phone, company, bzno, report }) {
  try {
    const urgency = report?.retainedEarnings?.urgency ?? '-';
    const taxPossible = report?.taxRefund?.possible ? '가능' : '검토필요';

    const descrip = `새 AI 간편검토 요청이 접수되었습니다.

요청자: ${reqName}
이메일: ${email}
연락처: ${phone || '미입력'}
회사명: ${company}
사업자번호: ${bzno || '미입력'}
세액공제: ${taxPossible}
잉여금 긴급도: ${urgency}

AI 진단 요약:
${report?.summary ?? '-'}`;

    await sendViaWebhook({
      to: 'admin@mmtum.co.kr',
      cor: `[BizMaster] 새 진단 요청 — ${company}`,
      descrip,
    });
    logger.info(`관리자 알림 발송 완료: ${company}`);
  } catch (err) {
    logger.error(`관리자 알림 발송 실패: ${err.message}`);
  }
}

/**
 * 요청자 확인 메일 — 진단 결과 요약
 */
export async function sendUserConfirm({ reqName, email, company, report }) {
  try {
    const actions = (report?.actions ?? []).map((a, i) => `${i + 1}. ${a}`).join('\n');
    const funds = (report?.policyFunds ?? []).map(f => `- ${f.name} ${f.amount} — ${f.match}`).join('\n');

    const descrip = `${reqName}님, ${company} AI 간편검토가 완료되었습니다.

[진단 요약]
${report?.summary ?? '-'}

${report?.taxRefund ? `[세액공제 / 경정청구]
가능성: ${report.taxRefund.possible ? '있음' : '검토 필요'} · ${report.taxRefund.estimatedAmount ?? ''}
${report.taxRefund.reason ?? ''}
` : ''}${funds ? `[정책자금 매칭]\n${funds}\n` : ''}${actions ? `[즉시 실행 액션]\n${actions}\n` : ''}
상세 컨설팅이 필요하시면 연락주세요.
admin@mmtum.co.kr | mmtum.co.kr

※ 본 결과는 AI 분석에 의한 참고용이며 법적 효력이 없습니다.`;

    await sendViaWebhook({
      to: email,
      cor: `[BizMaster AI] ${company} 진단 결과가 도착했습니다`,
      descrip,
    });
    logger.info(`요청자 확인메일 발송 완료: ${email}`);
  } catch (err) {
    logger.error(`요청자 확인메일 발송 실패: ${err.message}`);
  }
}
