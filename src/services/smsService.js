import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const SENDER = '07080643304';
const API_URL = 'https://api.solapi.com/messages/v4/send';

function makeAuth() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(8).toString('hex');
  const signature = crypto
    .createHmac('sha256', config.solapi.apiSecret)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${config.solapi.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function formatLms({ reqName, company, report }) {
  const s = report?.sections ?? {};
  const SECTIONS = [
    ['management',    '경영관리'],
    ['sales',         '매출관리·마케팅'],
    ['taxRefund',     '경정청구·세액공제'],
    ['powerCost',     '전력비'],
    ['policySupport', '정책지원'],
  ];

  const sectionBlocks = SECTIONS.map(([key, label]) => {
    const sec = s[key];
    if (!sec) return '';
    const bullets = (sec.bullets ?? []).filter(Boolean).slice(0, 3);
    if (!bullets.length && !sec.estimatedAmount) return '';
    const head = `■ ${label}`;
    const amount = (key === 'taxRefund' && sec.estimatedAmount) ? `예상 환급: ${sec.estimatedAmount}` : '';
    const items = bullets.map(b => `· ${b}`).join('\n');
    const moreNote = sec.moreNote && String(sec.moreNote).trim();
    const more = moreNote ? `💬 더 검토 가능: ${moreNote}` : '';
    return [head, amount, items, more].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');

  const actions = (report?.actions ?? []).map((a, i) => `${i + 1}. ${a}`).join('\n');

  const lines = [
    `[BizMaster AI] ${company} 진단 결과`,
    ``,
    report?.headline ?? '',
    ``,
    sectionBlocks || '-',
    ``,
    `■ 즉시 실행 액션`,
    actions || '-',
    ``,
    `─────────────────`,
    `상세 컨설팅: admin@mmtum.co.kr`,
    `mmtum.co.kr`,
  ];

  let text = lines.filter(l => l !== null && l !== undefined).join('\n');
  if (text.length > 1500) {
    text = text.slice(0, 1497) + '...';
  }
  return text;
}

export async function sendUserLms({ reqName, phone, company, report }) {
  try {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const text = formatLms({ reqName, company, report });

    await axios.post(API_URL, {
      message: {
        to: cleanPhone,
        from: SENDER,
        text,
        type: 'LMS',
        subject: `[BizMaster AI] ${company} 진단 결과`,
      },
    }, {
      headers: {
        Authorization: makeAuth(),
        'Content-Type': 'application/json',
      },
    });
    logger.info(`LMS 발송 완료: ${cleanPhone}`);
  } catch (err) {
    logger.error(`LMS 발송 실패: ${err.response?.data?.message ?? err.message}`);
  }
}
