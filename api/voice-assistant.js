// Realtime proxy BUILD=v4
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime';

if (!API_KEY || API_KEY.length < 20) {
  console.error('OPENAI_API_KEY не задан или слишком короткий');
  process.exit(1);
}

const app = express();
app.use(cors());
app.get('/', (_req, res) => res.status(200).send('OK'));

const server = createServer(app);
const wss = new WebSocketServer({ server });

function heartbeat() { this.isAlive = true; }

wss.on('connection', (client, req) => {
  client.isAlive = true;
  client.on('pong', heartbeat);
  console.log('WS: клиент подключился', req.socket.remoteAddress);

  const upstream = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`,
    { headers: { Authorization: `Bearer ${API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } }
  );

  upstream.on('open', () => console.log('WS: подключились к OpenAI Realtime'));

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  upstream.on('error', (e) => {
    console.error('WS upstream error:', e);
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'Upstream error');
  });

  upstream.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
  });

  client.on('error', () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close(1011, 'Client error');
  });

  client.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
});

// keep-alive клиентов
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => console.log(`Realtime proxy listening on ${PORT}`));
