/**
 * IP 기반 일일 rate limit
 * 하루 5회 초과 시 429 반환
 */
const LIMIT = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Map<ip, { count, resetAt }>
const store = new Map();

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

export function dailyRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + MS_PER_DAY };
    store.set(ip, entry);
  }

  entry.count += 1;

  if (entry.count > LIMIT) {
    return res.status(429).json({
      ok: false,
      error: '일일 진단 한도(5회)를 초과했습니다. 내일 다시 시도해 주세요.',
      code: 'RATE_LIMIT',
    });
  }

  next();
}
