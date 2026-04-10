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
};
