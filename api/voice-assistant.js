import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import express from 'express';
import cors from 'cors';

// --- НАСТРОЙКИ ---
const port = process.env.PORT || 10000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- СЕРВЕР ---
const app = express();
app.use(cors());
app.get("/", (req, res) => { res.send("Бэкенд для OpenAI Realtime API жив!"); });

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws) => {
    console.log('Клиент подключился по WebSocket');

    try {
        const realtime = openai.realtime.speech.create({
            model: "gpt-realtime",
            language: "ru-RU",
        });

        realtime.on('audio', (audioChunk) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(audioChunk);
            }
        });

        realtime.on('error', (error) => {
            console.error('Ошибка от OpenAI Realtime API:', error);
            if (ws.readyState === ws.OPEN) {
                ws.close(1011, 'Ошибка OpenAI');
            }
        });

        realtime.on('close', () => {
            console.log('Сессия с OpenAI закрыта.');
            if (ws.readyState === ws.OPEN) {
                ws.close();
            }
        });

        ws.on('message', (message) => {
            realtime.stream(message);
        });

        ws.on('close', () => {
            console.log('Клиент отключился.');
            realtime.close();
        });

    } catch (error) {
        console.error('Не удалось создать сессию OpenAI Realtime:', error);
        ws.close(1011, 'Не удалось инициализировать сессию');
    }
});

server.listen(port, () => {
    console.log(`Сервер Realtime v1.0 запущен на порту ${port}`);
});