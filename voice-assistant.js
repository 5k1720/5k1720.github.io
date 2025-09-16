document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const statusEl = document.getElementById('status');
    const transcriptEl = document.getElementById('transcript');
    const assistantContainer = document.getElementById('assistantContainer');

    const YOUR_BACKEND_URL = '/api/voice-assistant'; 

    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;

    const startRecording = async () => {
        if (isRecording) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isRecording = true;
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = event => { audioChunks.push(event.data); };
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                if (audioBlob.size > 1000) { processAudio(audioBlob); }
                else { statusEl.textContent = 'Готов к работе'; }
                stream.getTracks().forEach(track => track.stop());
                isRecording = false;
            };
            mediaRecorder.start();
            statusEl.textContent = 'Слушаю...';
            connectButton.classList.add('active');
            assistantContainer.classList.add('is-recording');
            connectButton.querySelector('.button-text').textContent = 'Отпустите, чтобы отправить';
            transcriptEl.textContent = '';
        } catch (error) {
            console.error("Ошибка доступа к микрофону:", error);
            statusEl.textContent = 'Ошибка микрофона.';
            isRecording = false;
        }
    };
    const stopRecording = () => {
        if (!isRecording || !mediaRecorder || mediaRecorder.state === 'inactive') return;
        mediaRecorder.stop();
        statusEl.textContent = 'Обработка...';
        connectButton.classList.remove('active');
        assistantContainer.classList.remove('is-recording');
        connectButton.querySelector('.button-text').textContent = 'Начать консультацию';
    };
    connectButton.addEventListener('mousedown', startRecording);
    connectButton.addEventListener('touchstart', startRecording, { passive: true });
    connectButton.addEventListener('mouseup', stopRecording);
    connectButton.addEventListener('touchend', stopRecording);
    connectButton.addEventListener('mouseleave', stopRecording);

    async function processAudio(audioBlob) {
        statusEl.textContent = 'Отправляю на сервер...';
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        try {
            const response = await fetch(YOUR_BACKEND_URL, { method: 'POST', body: formData });
            if (!response.ok) {
                try {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Неизвестная ошибка сервера.');
                } catch (jsonError) {
                    const errorText = await response.text();
                    throw new Error(errorText || `Ошибка HTTP: ${response.status}`);
                }
            }
            statusEl.textContent = 'Воспроизвожу ответ...';
            const audioResponseBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioResponseBlob);
            const audio = new Audio(audioUrl);
            audio.play();
            audio.onended = () => { statusEl.textContent = 'Готов к работе'; };
        } catch (error) {
            console.error('Ошибка при обращении к бэкенду:', error);
            statusEl.textContent = `Ошибка: ${error.message}`;
            connectButton.querySelector('.button-text').textContent = 'Попробовать снова';
        }
    }
});