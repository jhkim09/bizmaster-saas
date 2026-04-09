import { Router } from 'express';
import { searchCompany } from '../services/copartnerService.js';
import { diagnose } from '../services/bizMasterAgent.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * POST /api/diagnose
 * Body: { bzno?: string, companyName?: string, ceoName?: string }
 */
router.post('/diagnose', async (req, res) => {
  try {
    const { bzno, companyName, ceoName } = req.body ?? {};

    // 1. 입력 검증
    if (!bzno && !companyName) {
      return res.status(400).json({
        ok: false,
        error: '사업자번호(bzno) 또는 회사명(companyName) 중 하나는 필수입니다.',
      });
    }

    const queryTarget = bzno ?? companyName;

    // 2. Copartner 기업정보 조회 (실패해도 진단 계속)
    const companyInfo = await searchCompany(queryTarget, ceoName ?? '');

    if (!companyInfo) {
      logger.warn(`Copartner 조회 실패 — 입력값만으로 진단 진행: ${queryTarget}`);
    }

    // 3. Claude AI 진단
    const report = await diagnose(companyInfo, { bzno, companyName, ceoName });

    // 4. 응답
    res.json({ ok: true, data: report });
  } catch (err) {
    logger.error(`POST /api/diagnose 오류: ${err.message}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
