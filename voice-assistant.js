document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const statusEl = document.getElementById('status');
    const buttonText = connectButton.querySelector('.button-text');

    // --- Убедись, что этот URL правильный! ---
    const YOUR_BACKEND_URL = 'wss://voice-assistant-backend-bym9.onrender.com';

    let mediaRecorder;
    let socket;
    let audioContext;
    let audioQueue = [];
    let isPlaying = false;
    let isRecording = false;

    // Функция для воспроизведения аудиопотока
    const playAudioQueue = () => {
        if (isPlaying || audioQueue.length === 0) return;
        isPlaying = true;

        const audioChunk = audioQueue.shift();
        const source = audioContext.createBufferSource();
        source.buffer = audioChunk;
        source.connect(audioContext.destination);
        source.onended = () => {
            isPlaying = false;
            playAudioQueue(); // Проверяем, не появилось ли что-то новое в очереди
        };
        source.start();
    };

    const connect = async () => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        socket = new WebSocket(YOUR_BACKEND_URL);
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
            console.log('WebSocket-соединение установлено.');
            statusEl.textContent = 'Говорите...';
            buttonText.textContent = 'Завершить разговор';
            isRecording = true;

            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                    mediaRecorder.addEventListener('dataavailable', event => {
                        // VVV ВОТ ИЗМЕНЕНИЕ ЗДЕСЬ VVV
                        if (event.data.size > 0 && socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(event.data);
                        }
                    });
                    mediaRecorder.start(300); // Стримим аудио каждые 300 мс
                });
        };

        // Когда получаем аудио-ответ от сервера
        socket.onmessage = async (event) => {
            const audioBuffer = await audioContext.decodeAudioData(event.data);
            audioQueue.push(audioBuffer);
            playAudioQueue();
        };

        socket.onclose = () => {
            console.log('WebSocket-соединение закрыто.');
            cleanup();
        };
        
        socket.onerror = (error) => {
            console.error('WebSocket-ошибка:', error);
            statusEl.textContent = 'Ошибка соединения';
            cleanup();
        };
    };

    const disconnect = () => {
        if (socket) socket.close();
    };

    const cleanup = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        mediaRecorder = null;
        socket = null;
        isRecording = false;
        audioQueue = [];
        isPlaying = false;
        statusEl.textContent = 'Готов к работе';
        buttonText.textContent = 'Начать консультацию';
    };

    connectButton.addEventListener('click', () => {
        if (isRecording) {
            disconnect();
        } else {
            connect();
        }
    });
});