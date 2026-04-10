import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

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

/** 이메일 헤더 인젝션 방지 — subject용 */
function safeSubject(str) {
  return String(str ?? '').replace(/[\r\n\0]/g, ' ').slice(0, 100);
}

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: 465,
      secure: true,
      tls: { rejectUnauthorized: false },
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return _transporter;
}

/**
 * 관리자 알림 — 새 진단 요청 접수
 */
export async function sendAdminAlert({ reqName, email, phone, company, bzno, report }) {
  try {
    const urgency = report?.retainedEarnings?.urgency ?? '-';
    const taxPossible = report?.taxRefund?.possible ? '가능' : '검토필요';

    await getTransporter().sendMail({
      from: '"BizMaster AI" <admin@mmtum.co.kr>',
      to: 'admin@mmtum.co.kr',
      subject: `[BizMaster] 새 진단 요청 — ${safeSubject(company)}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#2563eb;">새 AI 진단 요청이 접수되었습니다</h2>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">요청자</td><td style="padding:8px 12px;">${esc(reqName)}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;">이메일</td><td style="padding:8px 12px;">${esc(email)}</td></tr>
            <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">연락처</td><td style="padding:8px 12px;">${esc(phone) || '미입력'}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;">회사명</td><td style="padding:8px 12px;">${esc(company)}</td></tr>
            <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">사업자번호</td><td style="padding:8px 12px;">${esc(bzno) || '미입력'}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:bold;">세액공제</td><td style="padding:8px 12px;">${esc(taxPossible)}</td></tr>
            <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">잉여금 긴급도</td><td style="padding:8px 12px;">${esc(urgency)}</td></tr>
          </table>
          <p style="margin-top:20px;color:#64748b;font-size:13px;">AI 진단 요약: ${esc(report?.summary ?? '-')}</p>
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

    await getTransporter().sendMail({
      from: '"BizMaster AI" <admin@mmtum.co.kr>',
      to: email,
      subject: `[BizMaster AI] ${safeSubject(company)} 진단 결과가 도착했습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#2563eb;">AI 경영진단 결과</h2>
          <p style="color:#334155;">${esc(reqName)}님, <b>${esc(company)}</b> 진단이 완료되었습니다.</p>

          <div style="background:#f8fafc;border-left:4px solid #2563eb;padding:16px;margin:20px 0;border-radius:4px;">
            <p style="margin:0;color:#1e293b;">${esc(report?.summary ?? '')}</p>
          </div>

          ${report?.taxRefund ? `
          <h3 style="color:#1e293b;">세액공제 / 경정청구</h3>
          <p style="color:#334155;">가능성: <b>${report.taxRefund.possible ? '있음' : '검토 필요'}</b> · ${esc(report.taxRefund.estimatedAmount ?? '')}</p>
          <p style="color:#64748b;">${esc(report.taxRefund.reason ?? '')}</p>
          ` : ''}

          ${funds ? `<h3 style="color:#1e293b;">정책자금 매칭</h3><ul style="color:#334155;">${funds}</ul>` : ''}

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
