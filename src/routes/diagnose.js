import { Router } from 'express';
import { searchCompany } from '../services/copartnerService.js';
import { diagnose } from '../services/bizMasterAgent.js';
import { isDuplicate, saveLog } from '../services/supabaseService.js';
import { sendAdminAlert, sendUserConfirm } from '../services/emailService.js';
import { sendUserLms } from '../services/smsService.js';
import { dailyRateLimit } from '../middleware/rateLimit.js';
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
router.post('/diagnose', dailyRateLimit, async (req, res) => {
  try {
    const { bzno, companyName, ceoName, reqName, email, phone } = req.body ?? {};

    // 1. 입력 검증
    if (!bzno && !companyName) {
      return res.status(400).json({
        ok: false,
        error: '사업자번호(bzno) 또는 회사명(companyName) 중 하나는 필수입니다.',
      });
    }
    if (!reqName) {
      return res.status(400).json({ ok: false, error: '이름을 입력해주세요.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
    saveLog({ bzno, company, ceoName, reqName, email, phone, ip, result: report }).catch(() => {});
    sendAdminAlert({ reqName, email, phone, company, bzno, report }).catch(() => {});
    if (email) sendUserConfirm({ reqName, email, company, report }).catch(() => {});
    if (phone) sendUserLms({ reqName, phone, company, report }).catch(() => {});

    // 6. 응답
    res.json({ ok: true, data: report });
  } catch (err) {
    logger.error(`POST /api/diagnose 오류: ${err.message}`, err);
    res.status(500).json({ ok: false, error: '진단 처리 중 오류가 발생했습니다.' });
  }
});

export default router;
