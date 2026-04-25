import { Router } from 'express';
import { searchCompany } from '../services/copartnerService.js';
import { diagnose } from '../services/bizMasterAgent.js';
import { isDuplicate, saveLog } from '../services/supabaseService.js';
import { sendAdminAlert, sendUserConfirm } from '../services/emailService.js';
import { sendUserLms } from '../services/smsService.js';
import { dailyRateLimit } from '../middleware/rateLimit.js';
import { getActiveMemberByEmail, recordUsage } from '../services/membershipService.js';
import logger from '../utils/logger.js';

const router = Router();

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * POST /api/diagnose
 * Body: { bzno?, companyName?, ceoName?, reqName, email, phone? }
 */
router.post('/diagnose', async (req, res) => {
  try {
    const { bzno, companyName, ceoName, reqName, email, phone } = req.body ?? {};

    // 멤버십 확인 — 활성 멤버이면 rate limit 우회
    let activeMember = null;
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      activeMember = await getActiveMemberByEmail(email).catch(() => null);
    }

    // 비멤버에게만 rate limit 적용
    if (!activeMember) {
      await new Promise((resolve, reject) => {
        dailyRateLimit(req, res, (err) => (err ? reject(err) : resolve()));
      });
      // dailyRateLimit이 이미 응답을 보냈으면 여기서 종료
      if (res.headersSent) return;
    }

    // 1. 입력 검증
    if (!reqName) {
      return res.status(400).json({ ok: false, error: '이름을 입력해주세요.' });
    }
    if (!phone) {
      return res.status(400).json({ ok: false, error: '연락처를 입력해주세요.' });
    }
    if (!email) {
      return res.status(400).json({ ok: false, error: '이메일을 입력해주세요.' });
    }
    if (!companyName) {
      return res.status(400).json({ ok: false, error: '회사명을 입력해주세요.' });
    }
    if (!ceoName && !bzno) {
      return res.status(400).json({
        ok: false,
        error: '대표자명 또는 사업자번호 중 하나는 필수입니다.',
      });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: '올바른 이메일 형식을 입력해주세요.' });
    }
    if (bzno) {
      const cleanBzno = bzno.replace(/[-\s]/g, '');
      if (!/^\d{10}$/.test(cleanBzno)) {
        return res.status(400).json({ ok: false, error: '사업자번호는 10자리 숫자로 입력해주세요.' });
      }
    }

    // 2. 사업자번호 중복 체크
    if (bzno) {
      const already = await isDuplicate(bzno);
      if (already) {
        return res.status(409).json({
          ok: false,
          error: '이미 진단된 사업자번호입니다. 상세 분석이 필요하시면 상담을 신청해주세요.',
          code: 'DUPLICATE_BZNO',
        });
      }
    }

    const queryTarget = bzno ?? companyName;
    const ip = getClientIp(req);

    // 3. Copartner 기업정보 조회
    const companyInfo = await searchCompany(queryTarget, ceoName ?? '');
    if (!companyInfo) {
      logger.warn(`Copartner 조회 실패 — 입력값만으로 진단 진행: ${queryTarget}`);
    }

    // 4. Claude AI 진단
    const report = await diagnose(companyInfo, { bzno, companyName, ceoName });

    const company = companyInfo?.company?.name ?? companyName;

    // 5. Supabase 로그 저장 + 이메일 발송 (비동기, 실패해도 응답 영향 없음)
    saveLog({ bzno, company, ceoName, reqName, email, phone, ip, result: report }).catch(e => logger.error(`Supabase 저장 실패: ${e.message}`));
    sendAdminAlert({ reqName, email, phone, company, ceoName, bzno, report }).catch(e => logger.error(`관리자 알림 실패: ${e.message}`));
    if (email) sendUserConfirm({ reqName, email, company, report }).catch(e => logger.error(`확인메일 실패: ${e.message}`));
    if (phone) sendUserLms({ reqName, phone, company, report }).catch(e => logger.error(`LMS 실패: ${e.message}`));

    // 멤버십 사용량 기록
    if (activeMember) {
      recordUsage(activeMember, 'simple_analysis', { company, bzno }).catch(e =>
        logger.error(`멤버십 사용량 기록 실패: ${e.message}`)
      );
    }

    // 6. 응답 (멤버이면 멤버십 정보 포함)
    const memberInfo = activeMember
      ? {
          plan:              activeMember.plan,
          remaining_ai:      Math.max(0, activeMember.monthly_quota_ai_report - activeMember.used_ai_this_month),
          remaining_premium: Math.max(0, activeMember.monthly_quota_premium_report - activeMember.used_premium_this_month),
        }
      : null;

    res.json({ ok: true, data: report, member: memberInfo });
  } catch (err) {
    logger.error(`POST /api/diagnose 오류: ${err.message}`, err);
    res.status(500).json({ ok: false, error: '진단 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/test-lms
 * Body: { phone }
 * LMS 발송 단독 테스트 (에러 응답 반환)
 */
router.post('/test-lms', async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ ok: false, error: 'phone 필수' });

  // 솔라피 API 직접 호출 — 에러 시 응답에 포함
  const crypto = await import('crypto');
  const axios = await import('axios');
  const { config } = await import('../config/index.js');

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(8).toString('hex');
  const signature = crypto.createHmac('sha256', config.solapi.apiSecret).update(date + salt).digest('hex');
  const auth = `HMAC-SHA256 apiKey=${config.solapi.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  try {
    const result = await axios.default.post('https://api.solapi.com/messages/v4/send', {
      message: { to: cleanPhone, from: '07080643304', text: '[BizMaster AI] 발신번호 변경 테스트\n070-8064-3304 정상 발송 확인용', type: 'LMS', subject: '[BizMaster] 테스트' },
    }, { headers: { Authorization: auth, 'Content-Type': 'application/json' } });
    res.json({ ok: true, solapi: result.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data ?? err.message });
  }
});

/** GET /api/sender-ids — 솔라피 등록 발신번호 조회 */
router.get('/sender-ids', async (req, res) => {
  const crypto = await import('crypto');
  const axios = await import('axios');
  const { config } = await import('../config/index.js');
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(8).toString('hex');
  const signature = crypto.createHmac('sha256', config.solapi.apiSecret).update(date + salt).digest('hex');
  const auth = `HMAC-SHA256 apiKey=${config.solapi.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  try {
    const result = await axios.default.get('https://api.solapi.com/senderid/v1/numbers', { headers: { Authorization: auth } });
    res.json({ ok: true, senderIds: result.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data ?? err.message });
  }
});

export default router;
