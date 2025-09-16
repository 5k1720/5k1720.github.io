export default async function handler(req) {
    console.log("ЗАПУЩЕН ДИАГНОСТИЧЕСКИЙ ТЕСТ");

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ message: 'Метод не разрешен' }), { status: 405 });
    }

    try {
        const formData = await req.formData();
        const audioFile = formData.get('audio');

        if (!audioFile || audioFile.size < 100) {
            console.error("Тест: Аудиофайл не получен или пуст.");
            return new Response(JSON.stringify({ message: 'Тест провален: аудиофайл не дошёл' }), { status: 400 });
        }

        console.log("Тест: Аудиофайл успешно получен! Размер:", audioFile.size);
        // Отправляем успешный ответ, а не аудио
        return new Response(JSON.stringify({ message: 'Тест пройден! Сервер получил аудио.' }), { status: 200 });

    } catch (error) {
        console.error('КРИТИЧЕСКАЯ ОШИБКА В ТЕСТЕ:', error);
        return new Response(JSON.stringify({ message: 'Тест провален: критическая ошибка на сервере.' }), { status: 500 });
    }
}
