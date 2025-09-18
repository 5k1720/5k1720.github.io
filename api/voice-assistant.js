import OpenAI from 'openai';
import { formidable } from 'formidable';
import fs from 'fs';
import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());

app.post('/api/voice-assistant', async (req, res) => {
    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const form = formidable({});
        const [fields, files] = await form.parse(req);
        
        const uploadedFile = files.audio?.[0];

        if (!uploadedFile) {
            return res.status(400).json({ error: 'Аудиофайл не найден' });
        }

        const audioFile = await OpenAI.toFile(
            fs.createReadStream(uploadedFile.filepath),
            uploadedFile.originalFilename
        );

        const transcription = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file: audioFile,
        });
        const userText = transcription.text;

        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo', // Экономная модель
            messages: [
                { role: 'system', content: "Ты — эксперт-консультант сервиса Save'n'Sale по ремонту техники Apple. Отвечай кратко и дружелюбно. Всегда предлагай бесплатную диагностику." },
                { role: 'user', content: userText || "Клиент молчал. Скажи 'Алло?'." }
            ],
            max_tokens: 150,
        });
        const assistantText = chatCompletion.choices[0].message.content;

        const speech = await openai.audio.speech.create({
            model: 'tts-1', // Экономная модель
            voice: 'nova',
            input: assistantText,
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        speech.body.pipe(res);

    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА НА БЭКЕНДЕ:', error.message);
        res.status(500).json({ error: 'Произошла ошибка на сервере OpenAI' });
    }
});

app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});