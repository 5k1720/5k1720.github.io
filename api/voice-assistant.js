import OpenAI from 'openai';
import { formidable } from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Метод не разрешен' });
        return;
    }
    try {
        //const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, });
        const form = formidable({});
        const [fields, files] = await form.parse(req);
        const uploadedFile = files.audio?.[0];

        if (!uploadedFile) {
            res.status(400).json({ error: 'Аудиофайл не найден' });
            return;
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
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: "Ты — эксперт-консультант сервиса Save'n'Sale по ремонту техники Apple и других брендов. Отвечай кратко, дружелюбно и по делу. Всегда предлагай бесплатную диагностику в сервисе." },
                { role: 'user', content: userText || "Клиент молчал или была помеха. Скажи 'Алло?' или 'Я вас не расслышал'." }
            ],
            max_tokens: 150,
        });
        const assistantText = chatCompletion.choices[0].message.content;
        const speech = await openai.audio.speech.create({
            model: 'tts-1-hd',
            voice: 'nova',
            input: assistantText,
        });
        res.setHeader('Content-Type', 'audio/mpeg');
        speech.body.pipe(res);
    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА НА БЭКЕНДЕ:', error.message);
        res.status(500).json({ error: 'Произошла ошибка на сервере OpenAI' });
    }
}