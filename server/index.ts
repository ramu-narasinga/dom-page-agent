import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT) || 8787;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.get('/health', (_req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(ANTHROPIC_API_KEY) });
});

app.post('/agent-step', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: { code: 'MISSING_API_KEY', message: 'Set ANTHROPIC_API_KEY in server/.env' } });
  }
  const { model, max_tokens, system, messages, tools, tool_choice } = req.body ?? {};
  if (!model || !messages) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'model and messages are required' } });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: max_tokens ?? 1024, system, messages, tools, tool_choice }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: { code: 'UPSTREAM_ERROR', message: JSON.stringify(data) } });
    }
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: { code: 'NETWORK_ERROR', message: String(err) } });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT} (key loaded: ${Boolean(ANTHROPIC_API_KEY)})`);
});
