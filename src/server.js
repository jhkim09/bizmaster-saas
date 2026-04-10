import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import healthRouter from './routes/health.js';
import diagnoseRouter from './routes/diagnose.js';
import contactRouter from './routes/contact.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Render 프록시 신뢰 (rate limit IP 위조 방지)
app.set('trust proxy', 1);

// --- 미들웨어 ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP 비활성: 정적 HTML이 CDN 참조
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// CORS (개발/SaaS 공개 환경)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 정적 파일 (public/index.html)
app.use(express.static(join(__dirname, '..', 'public')));

// --- 라우터 ---
app.use('/', healthRouter);
app.use('/api', diagnoseRouter);
app.use('/api', contactRouter);

// --- 전역 에러 핸들러 ---
app.use((err, _req, res, _next) => {
  logger.error(`Unhandled error: ${err.message}`, err);
  // 내부 에러 메시지를 클라이언트에 그대로 노출하지 않음 (정보 유출 방지)
  res.status(500).json({ ok: false, error: '서버 내부 오류가 발생했습니다.' });
});

// --- 서버 기동 ---
const { port } = config.server;
app.listen(port, () => {
  logger.info(`BizMaster SaaS 서버 기동 — http://localhost:${port}`);
});

export default app;
