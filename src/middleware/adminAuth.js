/**
 * adminAuth.js
 * 관리자 세션 인증 미들웨어
 * express-session 기반, ADMIN_PASS 환경변수로 비번 검증
 */
import { Router } from 'express';

/**
 * requireAdmin — 세션에 isAdmin=true가 없으면 401 반환
 */
export function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }
  return res.status(401).json({ ok: false, error: '인증이 필요합니다.' });
}

/**
 * adminAuthRouter — /api/admin/login, /api/admin/logout, /api/admin/me
 * 이 라우터를 server.js에서 /api/admin 에 마운트할 필요 없이
 * admin.js 라우터 안에서 직접 사용함
 */
export function createLoginHandlers() {
  return {
    /**
     * POST /api/admin/login
     * body: { password }
     */
    login: (req, res) => {
      const { password } = req.body ?? {};
      const adminPass = process.env.ADMIN_PASS;

      if (!adminPass) {
        return res.status(500).json({ ok: false, error: 'ADMIN_PASS 환경변수가 설정되지 않았습니다.' });
      }
      if (!password || password !== adminPass) {
        return res.status(401).json({ ok: false, error: '비밀번호가 올바르지 않습니다.' });
      }

      req.session.isAdmin = true;
      res.json({ ok: true, message: '로그인 성공' });
    },

    /**
     * POST /api/admin/logout
     */
    logout: (req, res) => {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ ok: true, message: '로그아웃 완료' });
      });
    },

    /**
     * GET /api/admin/me
     */
    me: (req, res) => {
      if (req.session && req.session.isAdmin) {
        return res.json({ ok: true, authenticated: true });
      }
      return res.status(401).json({ ok: false, authenticated: false });
    },
  };
}
