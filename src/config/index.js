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
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-northeast-2',
  },
  solapi: {
    apiKey: process.env.SOLAPI_API_KEY,
    apiSecret: process.env.SOLAPI_API_SECRET,
  },
};
