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

/** 결산연도 표시 — 최신순 정렬 + "24년부터 5년치" 형식 */
function formatReportingYears(years) {
  const arr = (years ?? [])
    .map(y => parseInt(String(y).match(/\d{4}/)?.[0], 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a);
  if (!arr.length) return '';
  const yy = String(arr[0]).slice(-2);
  return `<span style="font-size:11px;color:#64748b;"> · ${yy}년부터 ${arr.length}년치 분석</span>`;
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

/** 5개 메인 섹션 (개괄식) HTML 블록 생성 */
function sectionsBlock(report) {
  const s = report?.sections;
  if (!s) return '';
  const order = ['management', 'sales', 'taxRefund', 'powerCost', 'policySupport'];
  const colors = {
    management:    { bg: '#eff6ff', bd: '#3b82f6', tx: '#1e40af' },
    sales:         { bg: '#f0fdf4', bd: '#22c55e', tx: '#166534' },
    taxRefund:     { bg: '#fef3c7', bd: '#f59e0b', tx: '#92400e' },
    powerCost:     { bg: '#fef2f2', bd: '#ef4444', tx: '#991b1b' },
    policySupport: { bg: '#f5f3ff', bd: '#8b5cf6', tx: '#5b21b6' },
  };
  return order.map(k => {
    const sec = s[k];
    if (!sec) return '';
    const c = colors[k];
    const bulletArr = (sec.bullets ?? []).filter(Boolean).slice(0, 3);
    const bullets = bulletArr.map(b => `<li style="margin:6px 0;line-height:1.55;">${esc(b)}</li>`).join('');
    if (!bullets && !sec.estimatedAmount) return '';
    const amount = (k === 'taxRefund' && sec.estimatedAmount)
      ? `<p style="margin:6px 0 8px;color:${c.tx};font-weight:bold;">예상 환급: ${esc(sec.estimatedAmount)}</p>`
      : '';
    const moreNote = sec.moreNote && String(sec.moreNote).trim();
    const moreLine = moreNote
      ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid ${c.bd}33;color:${c.tx};font-size:12px;line-height:1.5;"><b>💬 더 이야기해드릴 내용이 있어요</b> — ${esc(moreNote)}</div>`
      : '';
    return `
      <div style="background:${c.bg};border-left:4px solid ${c.bd};padding:14px 16px;margin:14px 0;border-radius:6px;">
        <h3 style="color:${c.tx};margin:0 0 8px;font-size:15px;">${esc(sec.title || k)}</h3>
        ${amount}
        <ul style="margin:0;padding-left:20px;color:#1e293b;font-size:13px;">${bullets}</ul>
        ${moreLine}
      </div>`;
  }).join('');
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
    const adminTo = config.email?.adminNotify?.length
      ? config.email.adminNotify
      : ['admin@mmtum.co.kr'];

    const actions = (report?.actions ?? []).map((a) => `<li style="margin:6px 0;">${esc(a)}</li>`).join('');
    const years = formatReportingYears(report?.reportingYears);
    const headline = report?.headline ? `<p style="margin:0;color:#1e293b;font-weight:bold;font-size:15px;">${esc(report.headline)}</p>` : '';

    await send({
      to: adminTo,
      subject: `[BizMaster 관리자] 신규 진단 — ${company} / ${reqName} (${email})`,
      html: `
        <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
          <div style="background:#1e293b;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
            <p style="margin:0;font-size:11px;color:#94a3b8;letter-spacing:1px;">ADMIN NOTIFICATION</p>
            <h2 style="margin:4px 0 0;font-size:18px;">신규 AI 진단 요청 접수</h2>
          </div>
          <div style="padding:20px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;width:90px;">요청자</td><td style="padding:8px 12px;">${esc(reqName)}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;">이메일</td><td style="padding:8px 12px;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
              <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">연락처</td><td style="padding:8px 12px;">${esc(phone) || '미입력'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;">회사명</td><td style="padding:8px 12px;">${esc(company)}</td></tr>
              <tr style="background:#f1f5f9;"><td style="padding:8px 12px;font-weight:bold;">대표자명</td><td style="padding:8px 12px;">${esc(ceoName) || '미입력'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:bold;">사업자번호</td><td style="padding:8px 12px;">${esc(bzno) || '미입력'}</td></tr>
            </table>

            <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;">
            <p style="color:#64748b;font-size:12px;margin:0 0 12px;">— 아래는 고객에게 발송된 진단 결과와 동일 —</p>

            <h2 style="color:#2563eb;font-size:18px;margin:0 0 4px;">AI 경영진단 결과${years}</h2>
            ${headline}

            ${financialBlock(report)}

            ${sectionsBlock(report)}

            ${report?.retainedEarnings ? `
            <h3 style="color:#1e293b;">미처분이익잉여금 전략</h3>
            <p style="color:#334155;">${esc(report.retainedEarnings.strategy ?? '')} (긴급도: <b>${esc(report.retainedEarnings.urgency ?? '-')}</b>)</p>
            ${Array.isArray(report.retainedEarnings.tactics) && report.retainedEarnings.tactics.length ? `<ul style="color:#64748b;">${report.retainedEarnings.tactics.map(t => `<li style="margin:4px 0;">${esc(t)}</li>`).join('')}</ul>` : ''}
            ` : ''}

            ${insuranceBlock(report)}

            ${actions ? `<h3 style="color:#1e293b;">즉시 실행 액션</h3><ol style="color:#334155;">${actions}</ol>` : ''}

            <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;">
            <p style="color:#94a3b8;font-size:11px;">BizMaster AI · mmtum.co.kr · 수신: ${adminTo.map(esc).join(', ')}</p>
          </div>
        </div>
      `,
    });
    logger.info(`관리자 알림 발송 완료: ${company} → ${adminTo.join(', ')}`);
  } catch (err) {
    logger.error(`관리자 알림 발송 실패: ${err.message}`);
  }
}

/**
 * 멤버십 가입 환영 이메일
 */
export async function sendWelcomeMember({ email, name, plan, expiresAt, quotaAi, quotaPremium }) {
  try {
    const planLabel = plan === 'premium' ? '프리미엄' : '스탠다드';
    const displayName = name ? esc(name) : '고객';
    const expiryText = expiresAt
      ? new Date(expiresAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
      : '-';

    const benefitHtml = plan === 'premium'
      ? `
        <li style="margin:8px 0;padding:10px 14px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:4px;">
          <b style="color:#166534;">AI 심화 분석 보고서</b> — 월 ${quotaAi}회 무료 이용
        </li>
        <li style="margin:8px 0;padding:10px 14px;background:#eff6ff;border-left:3px solid #2563eb;border-radius:4px;">
          <b style="color:#1e40af;">20만원 AI 보고서</b> — 월 ${quotaPremium}회 무료 제공
        </li>`
      : `
        <li style="margin:8px 0;padding:10px 14px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:4px;">
          <b style="color:#166534;">AI 심화 분석 보고서</b> — 월 ${quotaAi}회 무료 이용
        </li>
        <li style="margin:8px 0;padding:10px 14px;background:#eff6ff;border-left:3px solid #2563eb;border-radius:4px;">
          <b style="color:#1e40af;">20만원 AI 보고서</b> — 50% 할인 (카카오 상담 시 안내)
        </li>`;

    await send({
      to: email,
      subject: `[Momentum Biz] 멤버십 활성화 완료 — ${planLabel}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#1e3a5f,#0f172a);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;">Momentum Biz</h1>
            <p style="color:#93c5fd;margin:6px 0 0;font-size:13px;">BizMaster AI 멤버십</p>
          </div>

          <div style="background:#fff;padding:32px 24px;border:1px solid #e2e8f0;border-top:none;">
            <h2 style="color:#1e293b;font-size:18px;margin-top:0;">
              ${displayName}님, 멤버십이 활성화되었습니다!
            </h2>
            <p style="color:#475569;line-height:1.7;">
              <b style="color:#2563eb;">${planLabel} 멤버십</b>이 성공적으로 등록되었습니다.<br>
              아래 혜택을 즉시 이용하실 수 있습니다.
            </p>

            <div style="background:#f8fafc;border-radius:8px;padding:20px;margin:20px 0;">
              <h3 style="color:#1e293b;margin-top:0;font-size:15px;">플랜 혜택</h3>
              <ul style="list-style:none;padding:0;margin:0;">
                ${benefitHtml}
              </ul>
            </div>

            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr style="background:#f1f5f9;">
                <td style="padding:10px 14px;font-weight:bold;color:#475569;font-size:13px;">플랜</td>
                <td style="padding:10px 14px;color:#1e293b;font-size:13px;">${planLabel}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-weight:bold;color:#475569;font-size:13px;">만료일</td>
                <td style="padding:10px 14px;color:#1e293b;font-size:13px;">${expiryText}</td>
              </tr>
              <tr style="background:#f1f5f9;">
                <td style="padding:10px 14px;font-weight:bold;color:#475569;font-size:13px;">이용 방법</td>
                <td style="padding:10px 14px;color:#1e293b;font-size:13px;">
                  <a href="https://bizmaster.mmtum.co.kr" style="color:#2563eb;">bizmaster.mmtum.co.kr</a> 또는<br>
                  <a href="https://mmtum.co.kr/consulting.html" style="color:#2563eb;">mmtum.co.kr/consulting.html</a><br>
                  <span style="color:#64748b;font-size:12px;">→ 본 이메일(${esc(email)}) 입력 시 자동으로 멤버십 혜택 적용</span>
                </td>
              </tr>
            </table>

            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:20px 0;">
              <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
                <b>갱신 안내</b><br>
                만료 임박 시 카카오 채널(<a href="https://mmtum.co.kr" style="color:#d97706;">mmtum.co.kr</a>)로 상담 요청해 주시면<br>
                운영자가 갱신 처리해 드립니다.
              </p>
            </div>

            <div style="text-align:center;margin-top:28px;">
              <a href="https://bizmaster.mmtum.co.kr"
                 style="display:inline-block;background:#2563eb;color:#fff;font-weight:bold;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;">
                지금 바로 이용하기
              </a>
            </div>
          </div>

          <div style="background:#f8fafc;padding:16px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
              문의: <a href="mailto:admin@mmtum.co.kr" style="color:#64748b;">admin@mmtum.co.kr</a><br>
              Momentum Biz · 에이룬컴퍼니 · <a href="https://mmtum.co.kr" style="color:#64748b;">mmtum.co.kr</a>
            </p>
          </div>
        </div>
      `,
    });
    logger.info(`환영 이메일 발송 완료: ${email} (${plan})`);
  } catch (err) {
    logger.error(`환영 이메일 발송 실패: ${err.message}`);
    throw err;
  }
}

/**
 * 요청자 확인 메일 — 진단 결과 요약
 */
export async function sendUserConfirm({ reqName, email, company, report }) {
  try {
    const actions = (report?.actions ?? []).map((a) => `<li style="margin:6px 0;">${esc(a)}</li>`).join('');
    const years = formatReportingYears(report?.reportingYears);
    const headline = report?.headline ? `<p style="margin:0;color:#1e293b;font-weight:bold;font-size:15px;">${esc(report.headline)}</p>` : '';

    await send({
      to: email,
      subject: `[BizMaster AI] ${company} 진단 결과가 도착했습니다`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#2563eb;">AI 경영진단 결과${years}</h2>
          <p style="color:#334155;">${esc(reqName)}님, <b>${esc(company)}</b> 진단이 완료되었습니다.</p>

          ${headline ? `<div style="background:#f8fafc;border-left:4px solid #2563eb;padding:14px 16px;margin:18px 0;border-radius:4px;">${headline}</div>` : ''}

          ${financialBlock(report)}

          ${sectionsBlock(report)}

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
