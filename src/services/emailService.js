import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const ses = new SESClient({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

const SENDER = 'BizMaster AI <admin@mmtum.co.kr>';

/** HTML 특수문자 이스케이프 — XSS 방지 */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

async function send({ to, subject, html }) {
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>${html}</body></html>`;
  const command = new SendEmailCommand({
    Source: SENDER,
    Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: fullHtml, Charset: 'UTF-8' } },
    },
  });
  await ses.send(command);
}

/** 재무 스냅샷 HTML 블록 생성 */
function financialBlock(report) {
  const snap = report?.financialSnapshot;
  if (!snap || !snap.highlights) return '';
  const obs = (snap.observations ?? []).map(o => `<li style="margin:4px 0;">${esc(o)}</li>`).join('');
  return `
    <h3 style="color:#1e293b;">📊 재무 스냅샷 ${snap.latestYear ? `<span style="font-size:12px;color:#64748b;">(${esc(snap.latestYear)}년 기준)</span>` : ''}</h3>
    <p style="color:#334155;">${esc(snap.highlights)}</p>
    ${obs ? `<ul style="color:#64748b;font-size:13px;">${obs}</ul>` : ''}`;
}

/** 보험 추천 HTML 블록 생성 */
function insuranceBlock(report) {
  const recs = report?.insuranceRecommendations ?? [];
  if (!recs.length) return '';
  const items = recs.map(r => `
    <li style="margin:10px 0;padding:10px 12px;background:#fefce8;border-left:3px solid #eab308;border-radius:4px;">
      <div style="font-weight:bold;color:#1e293b;">${esc(r.displayName)} ${r.priority === 'high' ? '<span style="font-size:11px;background:#f59e0b;color:#fff;padding:1px 6px;border-radius:3px;margin-left:6px;">우선</span>' : ''}</div>
      <div style="color:#334155;font-size:13px;margin-top:4px;line-height:1.5;">${esc(r.matchReason)}</div>
      <div style="color:#64748b;font-size:12px;margin-top:4px;"><b>기대효과:</b> ${esc(r.expectedEffect)}</div>
    </li>`).join('');
  return `<h3 style="color:#1e293b;">🛡️ 법인보험 활용 제안</h3><ul style="list-style:none;padding:0;">${items}</ul>
    <p style="color:#94a3b8;font-size:11px;">※ 법인 계약 기준. 실제 가입 전 세무사/전문가 상담 필수.</p>`;
}

/**
 * 관리자 알림 — 새 진단 요청 접수
 */
export async function sendAdminAlert({ reqName, email, phone, company, ceoName, bzno, report }) {
  try {
    const actions = (report?.actions ?? []).map((a) => `<li style="margin:6px 0;">${esc(a)}</li>`).join('');
    const funds = (report?.policyFunds ?? []).map(f => `<li style="margin:6px 0;"><b>${esc(f.name)}</b> ${esc(f.amount)} — ${esc(f.match)}${f.deadline ? ` <span style="color:#f59e0b;">⏰ ${esc(f.deadline)}</span>` : ''}</li>`).join('');
    const years = (report?.reportingYears ?? []).length ? `<span style="font-size:11px;color:#64748b;"> · 결산 ${report.reportingYears.join(', ')}</span>` : '';

    await send({
      to: 'admin@mmtum.co.kr',
      subject: `[BizMaster] 새 진단 — ${company} (${esc(reqName)})`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#2563eb;">새 AI 진단 요청 접수</h2>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">요청자</td><td style="padding:8px 12px;">${esc(reqName)}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;">이메일</td><td style="padding:8px 12px;">${esc(email)}</td></tr>
            <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">연락처</td><td style="padding:8px 12px;">${esc(phone) || '미입력'}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;">회사명</td><td style="padding:8px 12px;">${esc(company)}</td></tr>
            <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">대표자명</td><td style="padding:8px 12px;">${esc(ceoName) || '미입력'}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;">사업자번호</td><td style="padding:8px 12px;">${esc(bzno) || '미입력'}</td></tr>
          </table>

          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">
          <h3 style="color:#64748b;font-size:13px;">아래는 고객에게 발송된 진단 결과와 동일한 내용입니다</h3>

          <h2 style="color:#2563eb;">AI 경영진단 결과${years}</h2>
          <p style="color:#334155;">${esc(reqName)}님, <b>${esc(company)}</b> 진단이 완료되었습니다.</p>

          <div style="background:#f8fafc;border-left:4px solid #2563eb;padding:16px;margin:20px 0;border-radius:4px;">
            <p style="margin:0;color:#1e293b;white-space:pre-line;">${esc(report?.summary ?? '')}</p>
          </div>

          ${financialBlock(report)}

          ${report?.taxRefund ? `
          <h3 style="color:#1e293b;">세액공제 / 경정청구</h3>
          <p style="color:#334155;">가능성: <b>${report.taxRefund.possible ? '있음' : '검토 필요'}</b> · ${esc(report.taxRefund.estimatedAmount ?? '')}</p>
          <p style="color:#64748b;">${esc(Array.isArray(report.taxRefund.reasons) ? report.taxRefund.reasons.join(' · ') : (report.taxRefund.reason ?? ''))}</p>
          ` : ''}

          ${funds ? `<h3 style="color:#1e293b;">정책자금 매칭</h3><ul style="color:#334155;">${funds}</ul>` : ''}

          ${report?.retainedEarnings ? `
          <h3 style="color:#1e293b;">미처분이익잉여금 전략</h3>
          <p style="color:#334155;">${esc(report.retainedEarnings.strategy ?? '')} (긴급도: <b>${esc(report.retainedEarnings.urgency ?? '-')}</b>)</p>
          ${Array.isArray(report.retainedEarnings.tactics) && report.retainedEarnings.tactics.length ? `<ul style="color:#64748b;">${report.retainedEarnings.tactics.map(t => `<li style="margin:4px 0;">${esc(t)}</li>`).join('')}</ul>` : ''}
          ` : ''}

          ${insuranceBlock(report)}

          ${actions ? `<h3 style="color:#1e293b;">즉시 실행 액션</h3><ol style="color:#334155;">${actions}</ol>` : ''}

          <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:12px;">BizMaster AI · mmtum.co.kr</p>
        </div>
      `,
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
    const actions = (report?.actions ?? []).map((a) => `<li style="margin:6px 0;">${esc(a)}</li>`).join('');
    const funds = (report?.policyFunds ?? []).map(f => `<li style="margin:6px 0;"><b>${esc(f.name)}</b> ${esc(f.amount)} — ${esc(f.match)}</li>`).join('');

    const years = (report?.reportingYears ?? []).length ? `<span style="font-size:11px;color:#64748b;"> · 결산 ${report.reportingYears.join(', ')}</span>` : '';

    await send({
      to: email,
      subject: `[BizMaster AI] ${company} 진단 결과가 도착했습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#2563eb;">AI 경영진단 결과${years}</h2>
          <p style="color:#334155;">${esc(reqName)}님, <b>${esc(company)}</b> 진단이 완료되었습니다.</p>

          <div style="background:#f8fafc;border-left:4px solid #2563eb;padding:16px;margin:20px 0;border-radius:4px;">
            <p style="margin:0;color:#1e293b;white-space:pre-line;">${esc(report?.summary ?? '')}</p>
          </div>

          ${financialBlock(report)}

          ${report?.taxRefund ? `
          <h3 style="color:#1e293b;">세액공제 / 경정청구</h3>
          <p style="color:#334155;">가능성: <b>${report.taxRefund.possible ? '있음' : '검토 필요'}</b> · ${esc(report.taxRefund.estimatedAmount ?? '')}</p>
          <p style="color:#64748b;">${esc(Array.isArray(report.taxRefund.reasons) ? report.taxRefund.reasons.join(' · ') : (report.taxRefund.reason ?? ''))}</p>
          ` : ''}

          ${funds ? `<h3 style="color:#1e293b;">정책자금 매칭</h3><ul style="color:#334155;">${funds}</ul>` : ''}

          ${report?.retainedEarnings ? `
          <h3 style="color:#1e293b;">미처분이익잉여금 전략</h3>
          <p style="color:#334155;">${esc(report.retainedEarnings.strategy ?? '')}</p>
          ${Array.isArray(report.retainedEarnings.tactics) && report.retainedEarnings.tactics.length ? `<ul style="color:#64748b;">${report.retainedEarnings.tactics.map(t => `<li style="margin:4px 0;">${esc(t)}</li>`).join('')}</ul>` : ''}
          ` : ''}

          ${insuranceBlock(report)}

          ${actions ? `<h3 style="color:#1e293b;">즉시 실행 액션</h3><ol style="color:#334155;">${actions}</ol>` : ''}

          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:24px 0;">
            <p style="margin:0;color:#1e40af;font-weight:bold;">상세 컨설팅이 필요하시면 연락주세요</p>
            <p style="margin:8px 0 0;color:#1e293b;">📧 admin@mmtum.co.kr</p>
          </div>

          <p style="color:#94a3b8;font-size:11px;">본 결과는 AI 분석에 의한 참고용이며 법적 효력이 없습니다. 실제 적용 전 전문가 검토를 받으시기 바랍니다.</p>
          <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:12px;">BizMaster AI · <a href="https://mmtum.co.kr" style="color:#2563eb;">mmtum.co.kr</a></p>
        </div>
      `,
    });
    logger.info(`요청자 확인메일 발송 완료: ${email}`);
  } catch (err) {
    logger.error(`요청자 확인메일 발송 실패: ${err.message}`);
  }
}
