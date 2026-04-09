import { Router } from 'express';
import logger from '../utils/logger.js';

const router = Router();

// POST /api/contact — 상담 신청 접수
router.post('/contact', async (req, res) => {
  const { name, phone, email, companyName, summary } = req.body;

  if (!phone && !email) {
    return res.status(400).json({ ok: false, error: '연락처 또는 이메일을 입력해주세요.' });
  }

  const payload = {
    event: 'consultation_request',
    timestamp: new Date().toISOString(),
    source: 'bizmaster-saas',
    contact: { name: name || '미입력', phone: phone || '', email: email || '' },
    company: companyName || '미입력',
    aiSummary: summary || '',
  };

  logger.info('상담 신청 접수:', JSON.stringify(payload));

  const webhookUrl = process.env.CONTACT_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      logger.error('Webhook 전송 실패:', err.message);
    }
  }

  res.json({ ok: true });
});

export default router;
