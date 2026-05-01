import 'dotenv/config';

export const config = {
  server: { port: parseInt(process.env.PORT) || 3200 },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  },
  copartner: {
    baseUrl: 'https://copartner-fastapi-scraper.onrender.com',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,  // RLS 우회용 (backend 전용)
  },
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-northeast-2',
  },
  email: {
    // 관리자 알림 수신 주소 — 쉼표 구분으로 다중 지원. 미설정 시 admin@mmtum.co.kr 단독.
    adminNotify: (process.env.ADMIN_NOTIFY_EMAIL || 'admin@mmtum.co.kr')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  },
  solapi: {
    apiKey: process.env.SOLAPI_API_KEY,
    apiSecret: process.env.SOLAPI_API_SECRET,
  },
};
