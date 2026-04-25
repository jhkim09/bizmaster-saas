import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import healthRouter from './routes/health.js';
import diagnoseRouter from './routes/diagnose.js';
import contactRouter from './routes/contact.js';
import adminRouter from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Render 프록시 신뢰 (rate limit IP 위조 방지)
app.set('trust proxy', 1);

// --- 미들웨어 ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP 비활성: 정적 HTML이 CDN 참조
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 세션 (관리자 인증용)
app.use(session({
  secret:            process.env.SESSION_SECRET || 'bizmaster-dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production', // HTTPS에서만 secure
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000, // 8시간
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

// CORS — mmtum.co.kr (멤버십 배지) + 기존 공개 API 유지
const ALLOWED_ORIGINS_CREDENTIALS = [
  'https://mmtum.co.kr',
  'https://www.mmtum.co.kr',
  'https://bizmaster.mmtum.co.kr',
];

app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  if (origin && ALLOWED_ORIGINS_CREDENTIALS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    // 자격증명 없는 일반 요청 (공개 API, 직접 접근 등)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 정적 파일 (public/)
app.use(express.static(join(__dirname, '..', 'public')));

// --- 라우터 ---
app.use('/',         healthRouter);
app.use('/api',      diagnoseRouter);
app.use('/api',      contactRouter);
app.use('/api/admin', adminRouter);

// --- 전역 에러 핸들러 ---
app.use((err, _req, res, _next) => {
  logger.error(`Unhandled error: ${err.message}`, err);
  res.status(500).json({ ok: false, error: '서버 내부 오류가 발생했습니다.' });
});

// --- 서버 기동 ---
const { port } = config.server;
app.listen(port, () => {
  logger.info(`BizMaster SaaS 서버 기동 — http://localhost:${port}`);
});

export default app;
