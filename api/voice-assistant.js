import OpenAI from 'openai';

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Метод не разрешен' }), { status: 405 });
    }

    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        // --- ИСПРАВЛЕНИЕ ---
        // Используем специальный инструмент от OpenAI, чтобы правильно прочитать аудиопоток
        const audioFile = await OpenAI.toFile(req, 'audio.webm');

        // Проверяем, что файл не пустой
        if (!audioFile || audioFile.size < 1000) {
            console.error("Бэкенд: Аудиофайл не получен или пуст.");
            return new Response(JSON.stringify({ error: 'Запись слишком короткая или пустая' }), { status: 400 });
        }

        // --- ЭТАП 1: Распознавание речи (Whisper) ---
        const transcription = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file: audioFile,
        });
        const userText = transcription.text;

        // --- ЭТАП 2: Получение ответа от модели (GPT-4o) ---
        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: "Ты — эксперт-консультант сервиса Save'n'Sale по ремонту техники Apple и других брендов. Отвечай кратко, дружелюбно и по делу. Всегда предлагай бесплатную диагностику в сервисе."
                },
                {
                    role: 'user',
                    content: userText || "Клиент молчал или была помеха. Скажи 'Алло?' или 'Я вас не расслышал'."
                }
            ],
            max_tokens: 150,
        });
        const assistantText = chatCompletion.choices[0].message.content;

        // --- ЭТАП 3: Синтез голоса (TTS) ---
        const speech = await openai.audio.speech.create({
            model: 'tts-1-hd',
            voice: 'nova',
            input: assistantText,
        });

        return new Response(speech.body, {
            headers: { 'Content-Type': 'audio/mpeg' },
        });

    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА НА БЭКЕНДЕ:', error.message);
        return new Response(JSON.stringify({ error: 'Произошла ошибка на сервере OpenAI' }), { status: 500 });
    }
}