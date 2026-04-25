/**
 * admin.js — 관리자 API 라우터
 * 마운트: app.use('/api/admin', adminRouter)  (server.js)
 */
import { Router } from 'express';
import { requireAdmin, createLoginHandlers } from '../middleware/adminAuth.js';
import {
  listMembers,
  createMember,
  updateMember,
  deactivateMember,
  getActiveMemberByEmail,
  getMemberUsage,
} from '../services/membershipService.js';
import { sendWelcomeMember } from '../services/emailService.js';
import logger from '../utils/logger.js';

const router = Router();
const { login, logout, me } = createLoginHandlers();

// ── 인증 ──────────────────────────────────────────────────────────
router.post('/login',  login);
router.post('/logout', logout);
router.get('/me',      me);

// ── 공개 — 이메일로 멤버십 확인 (프론트 배지용) ───────────────────
router.get('/members/:email/check', async (req, res) => {
  try {
    const { email } = req.params;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ ok: true, member: null });
    }
    const member = await getActiveMemberByEmail(email);
    if (!member) return res.json({ ok: true, member: null });

    res.json({
      ok: true,
      member: {
        plan:              member.plan,
        expires_at:        member.expires_at,
        remaining_ai:      Math.max(0, member.monthly_quota_ai_report - member.used_ai_this_month),
        remaining_premium: Math.max(0, member.monthly_quota_premium_report - member.used_premium_this_month),
      },
    });
  } catch (err) {
    logger.error(`GET /members/:email/check 오류: ${err.message}`);
    res.json({ ok: true, member: null }); // 오류여도 배지 미표시로 안전 처리
  }
});

// ── 이하 requireAdmin 보호 ────────────────────────────────────────

/** GET /api/admin/members */
router.get('/members', requireAdmin, async (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;
    const members = await listMembers({ search, status });
    res.json({ ok: true, data: members });
  } catch (err) {
    logger.error(`GET /admin/members 오류: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/admin/members */
router.post('/members', requireAdmin, async (req, res) => {
  try {
    const { email, name, plan, startsAt, expiresAt, note } = req.body ?? {};

    if (!email) return res.status(400).json({ ok: false, error: 'email 필수' });
    if (!plan)  return res.status(400).json({ ok: false, error: 'plan 필수 (standard|premium)' });
    if (!expiresAt) return res.status(400).json({ ok: false, error: 'expiresAt 필수 (YYYY-MM-DD)' });

    const member = await createMember({ email, name, plan, startsAt, expiresAt, note });

    // 환영 이메일 (실패해도 등록 성공 유지)
    sendWelcomeMember({
      email:          member.email,
      name:           member.name,
      plan:           member.plan,
      expiresAt:      member.expires_at,
      quotaAi:        member.monthly_quota_ai_report,
      quotaPremium:   member.monthly_quota_premium_report,
    }).catch(e => logger.error(`환영 이메일 발송 실패: ${e.message}`));

    res.status(201).json({ ok: true, data: member });
  } catch (err) {
    logger.error(`POST /admin/members 오류: ${err.message}`);
    // unique constraint violation
    if (err.message.includes('unique') || err.message.includes('duplicate')) {
      return res.status(409).json({ ok: false, error: '이미 등록된 이메일입니다.' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PUT /api/admin/members/:id */
router.put('/members/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: '유효하지 않은 id' });

    const allowedFields = [
      'name', 'plan', 'expires_at', 'starts_at',
      'monthly_quota_ai_report', 'monthly_quota_premium_report',
      'used_ai_this_month', 'used_premium_this_month',
      'is_active', 'note',
    ];
    const body = req.body ?? {};
    const patch = {};
    for (const key of allowedFields) {
      if (key in body) patch[key] = body[key];
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ ok: false, error: '변경할 필드가 없습니다.' });
    }

    const updated = await updateMember(id, patch);
    res.json({ ok: true, data: updated });
  } catch (err) {
    logger.error(`PUT /admin/members/:id 오류: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** DELETE /api/admin/members/:id — soft delete */
router.delete('/members/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: '유효하지 않은 id' });

    const updated = await deactivateMember(id);
    res.json({ ok: true, data: updated });
  } catch (err) {
    logger.error(`DELETE /admin/members/:id 오류: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/admin/members/:email/usage — 사용 이력 */
router.get('/members/:email/usage', requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const usage = await getMemberUsage(email);
    res.json({ ok: true, data: usage });
  } catch (err) {
    logger.error(`GET /admin/members/:email/usage 오류: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
