import OpenAI from 'openai';

export default async function handler(req) {
    console.log("Бэкенд запущен. Метод:", req.method); // Маячок 1

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Метод не разрешен' }), { status: 405 });
    }

    try {
        console.log("Создаю клиент OpenAI..."); // Маячок 2
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
        console.log("Клиент OpenAI создан."); // Маячок 3

        console.log("Получаю аудиофайл из запроса..."); // Маячок 4
        const formData = await req.formData();
        const audioFile = formData.get('audio');

        if (!audioFile || audioFile.size < 1000) {
            console.error("Бэкенд: Аудиофайл не получен или пуст.");
            return new Response(JSON.stringify({ error: 'Запись слишком короткая или пустая' }), { status: 400 });
        }
        console.log("Аудиофайл получен. Размер:", audioFile.size); // Маячок 5

        console.log("Отправляю аудио в Whisper..."); // Маячок 6
        const transcription = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file: audioFile,
        });
        const userText = transcription.text;
        console.log("Whisper вернул текст:", userText); // Маячок 7

        console.log("Отправляю текст в GPT-4o..."); // Маячок 8
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
        console.log("GPT-4o вернул ответ:", assistantText); // Маячок 9

        console.log("Отправляю ответ в TTS для озвучки..."); // Маячок 10
        const speech = await openai.audio.speech.create({
            model: 'tts-1-hd',
            voice: 'nova',
            input: assistantText,
        });
        console.log("TTS сгенерировал аудио. Отправляю ответ на сайт."); // Маячок 11

        return new Response(speech.body, {
            headers: { 'Content-Type': 'audio/mpeg' },
        });

    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА НА БЭКЕНДЕ:', error); // Маячок ошибки
        return new Response(JSON.stringify({ error: 'Произошла внутренняя ошибка сервера' }), { status: 500 });
    }
}