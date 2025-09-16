// Импортируем OpenAI SDK для удобной работы
import OpenAI from 'openai';

// Главная функция, которая будет обрабатывать все входящие запросы
export default async function handler(req) {
    // Проверяем, что запрос пришел методом POST (т.е. с отправкой данных)
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Метод не разрешен' }), { status: 405 });
    }

    try {
        // Создаем "клиента" для общения с OpenAI, безопасно получая ключ из переменных окружения Vercel
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        // Получаем аудиофайл, который прислал фронтенд
        const formData = await req.formData();
        const audioFile = formData.get('audio');

        if (!audioFile) {
            return new Response(JSON.stringify({ error: 'Аудиофайл не найден' }), { status: 400 });
        }

        // --- ЭТАП 1: Распознавание речи (Whisper) ---
        const transcription = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file: audioFile,
            language: 'ru',
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
                    content: userText
                }
            ],
            max_tokens: 150,
        });
        const assistantText = chatCompletion.choices[0].message.content;

        // --- ЭТАП 3: Синтез голоса (TTS) ---
        const speech = await openai.audio.speech.create({
            model: 'tts-1-hd',
            voice: 'nova', // Голос, который мы выбрали
            input: assistantText,
        });

        // Отправляем готовый аудиофайл с ответом обратно на сайт
        return new Response(speech.body, {
            headers: { 'Content-Type': 'audio/mpeg' },
        });

    } catch (error) {
        // Если на любом из этапов произошла ошибка, отправляем её на сайт
        console.error('Ошибка на бэкенде:', error);
        return new Response(JSON.stringify({ error: 'Произошла внутренняя ошибка сервера' }), { status: 500 });
    }
}