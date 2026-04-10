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
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.cafe24.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};
