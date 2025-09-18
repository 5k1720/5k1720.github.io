// api/voice-assistant.js
// Realtime proxy BUILD=v3
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.OPENAI_API_KEY;

// Модель по умолчанию. Если дока у тебя показывает другое имя — замени здесь или в env.
// (Название для твоего аккаунта я не могу подтвердить на 100% — НЕДОСТОВЕРНО.)
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime';

if (!API_KEY || API_KEY.length < 20) {
  console.error('OPENAI_API_KEY не задан или слишком короткий');
  process.exit(1);
}

const app = express();
app.use(cors());

// health-check для Render
app.get('/', (_req, res) => res.status(200).send('OK'));

const server = createServer(app);
const wss = new WebSocketServer({ server });

// keep-alive для клиентов
function heartbeat() { this.isAlive = true; }

wss.on('connection', (client, req) => {
  client.isAlive = true;
  client.on('pong', heartbeat);
  console.log('WS: клиент подключился', req.socket.remoteAddress);

  // Подключение к OpenAI Realtime WebSocket
  const upstreamUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;

  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    }
  });

  upstream.on('open', () => {
    console.log('WS: подключились к OpenAI Realtime');
  });

  // Любые данные от OpenAI → клиенту (сохраняем бинарность)
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  upstream.on('error', (err) => {
    console.error('WS upstream error:', err);
    if (client.readyState === WebSocket.OPEN) {
      client.close(1011, 'Upstream error');
    }
  });

  upstream.on('close', (code, reason) => {
    console.log('WS upstream closed:', code, reason?.toString());
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  // Любые данные от клиента → в OpenAI
  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });

  client.on('error', (err) => {
    console.error('WS client error:', err);
    if (upstream.readyState === WebSocket.OPEN) upstream.close(1011, 'Client error');
  });

  client.on('close', () => {
    console.log('WS: клиент отключился');
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
});

// Пингуем клиентов,
