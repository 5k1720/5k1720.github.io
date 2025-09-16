document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const statusEl = document.getElementById('status');
    // ... (весь код до функции processAudio остаётся таким же, как в прошлый раз)
    
    // Копируем весь код из предыдущего ответа, меняем ТОЛЬКО функцию processAudio
    
    // Старый код... (startRecording, stopRecording, event listeners)
    const transcriptEl = document.getElementById('transcript');
    const YOUR_BACKEND_URL = '/api/voice-assistant'; 
    let isListening = false;
    let mediaRecorder;
    let audioChunks = [];
    const startRecording = async () => { /* ...код из прошлого ответа... */ };
    const stopRecording = () => { /* ...код из прошлого ответа... */ };
    connectButton.addEventListener('click', () => { if (isListening) { stopRecording(); } else { startRecording(); } });

    async function processAudio(audioBlob) {
        statusEl.textContent = 'Отправляю на сервер (ТЕСТ)...';
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        try {
            const response = await fetch(YOUR_BACKEND_URL, {
                method: 'POST',
                body: formData
            });

            // В ТЕСТЕ МЫ ЖДЁМ НЕ АУДИО, А ТЕКСТ (JSON)
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Неизвестная ошибка');
            }
            
            // Показываем успешное сообщение от сервера
            statusEl.textContent = `ОТВЕТ СЕРВЕРА: ${result.message}`;

        } catch (error) {
            console.error('Ошибка в тесте:', error);
            statusEl.textContent = `ОШИБКА ТЕСТА: ${error.message}`;
        } finally {
            connectButton.querySelector('.button-text').textContent = 'Попробовать снова';
        }
    }
});
