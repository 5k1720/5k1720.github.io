document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const statusEl = document.getElementById('status');
    const transcriptEl = document.getElementById('transcript');
    
    // АДРЕС ТВОЕГО БЕЗОПАСНОГО СЕРВЕРА НА VERCEL
    const YOUR_BACKEND_URL = '/api/voice-assistant'; 

    let isListening = false;
    let mediaRecorder;
    let audioChunks = [];

    const startRecording = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            statusEl.textContent = 'Микрофон не поддерживается.';
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = [];
                processAudio(audioBlob);
            };
            mediaRecorder.start();
            isListening = true;
            statusEl.textContent = 'Слушаю...';
            connectButton.classList.add('active');
            connectButton.querySelector('.button-text').textContent = 'Отправить';
        } catch (error) {
            console.error('Ошибка доступа к микрофону:', error);
            statusEl.textContent = 'Ошибка микрофона.';
        }
    };

    const stopRecording = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        isListening = false;
        statusEl.textContent = 'Обработка...';
        connectButton.classList.remove('active');
        connectButton.querySelector('.button-text').textContent = 'Начать консультацию';
    };

    connectButton.addEventListener('click', () => {
        if (isListening) {
            stopRecording();
        } else {
            transcriptEl.textContent = '';
            startRecording();
        }
    });

    async function processAudio(audioBlob) {
        statusEl.textContent = 'Отправляю на сервер...';
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        try {
            const response = await fetch(YOUR_BACKEND_URL, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка на сервере.');
            }
            
            statusEl.textContent = 'Воспроизвожу ответ...';
            const audioResponseBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioResponseBlob);
            const audio = new Audio(audioUrl);
            audio.play();

            audio.onended = () => {
                statusEl.textContent = 'Готов к работе';
                connectButton.querySelector('.button-text').textContent = 'Начать консультацию';
            };

        } catch (error) {
            console.error('Ошибка при обращении к бэкенду:', error);
            statusEl.textContent = `Ошибка: ${error.message}`;
            connectButton.querySelector('.button-text').textContent = 'Попробовать снова';
        }
    }
});