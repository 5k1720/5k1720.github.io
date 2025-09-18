// voice-assistant.js — Realtime WS client (PCM/base64)
// BUILD=v1
document.addEventListener('DOMContentLoaded', () => {
  const connectButton = document.getElementById('connectButton');
  const statusEl = document.getElementById('status');
  const buttonText = connectButton.querySelector('.button-text');
  const transcriptEl = document.getElementById('transcript');

  const YOUR_BACKEND_URL = 'wss://voice-assistant-backend-bym9.onrender.com';

  let socket;
  let audioCtx;
  let micStream;
  let sourceNode;
  let procNode; // ScriptProcessorNode
  let isRecording = false;

  // очередь аудио-буферов модели
  let playQueue = [];
  let playing = false;

  function setStatus(t) { statusEl.textContent = t; }

  function floatTo16BitPCM(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out.buffer;
  }

  function ab2b64(ab) {
    const bytes = new Uint8Array(ab);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function playLoop() {
    if (playing) return;
    playing = true;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    while (playQueue.length > 0) {
      const chunk = playQueue.shift(); // ArrayBuffer (pcm or wav chunk from model)
      try {
        // Модель обычно шлёт линейный PCM в контейнере wav или raw — декодер справится.
        const audioBuffer = await audioCtx.decodeAudioData(chunk.slice(0));
        const src = audioCtx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(audioCtx.destination);
        await new Promise((res) => { src.onended = res; src.start(); });
      } catch (e) {
        console.warn('Decode/play error, skip chunk', e);
      }
    }
    playing = false;
  }

  function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(obj));
    }
  }

  async function startCapture() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    // Используем ScriptProcessorNode для простоты (да, устаревший, но работает везде)
    const bufSize = 4096;
    procNode = audioCtx.createScriptProcessor(bufSize, 1, 1);
    sourceNode.connect(procNode);
    procNode.connect(audioCtx.destination);

    procNode.onaudioprocess = (e) => {
      if (!isRecording) return;
      const ch0 = e.inputBuffer.getChannelData(0); // Float32
      const pcm = floatTo16BitPCM(ch0);
      const b64 = ab2b64(pcm);
      send({ type: 'input_audio_buffer.append', audio: b64 });
    };
  }

  function stopCaptureCommit() {
    // завершили набор входного аудио и попросили ответ
    send({ type: 'input_audio_buffer.commit' });
    send({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
  }

  function cleanupAudio() {
    try { procNode && procNode.disconnect(); } catch {}
    try { sourceNode && sourceNode.disconnect(); } catch {}
    try { micStream && micStream.getTracks().forEach(t => t.stop()); } catch {}
    procNode = sourceNode = micStream = null;
  }

  function connect() {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    socket = new WebSocket(YOUR_BACKEND_URL);
    // нам будут приходить ТЕКСТОВЫЕ JSON-события и, возможно, бинарь (wav-чанки)
    socket.onopen = async () => {
      console.log('WS opened');
      isRecording = true;
      setStatus('Говорите…');
      buttonText.textContent = 'Завершить разговор';

      // (необязательно) сообщаем формат желаемого аудио — может игнорироваться движком (НЕДОСТОВЕРНО)
      send({ type: 'session.update', session: { input_audio_format: 'pcm16', output_audio_format: 'wav' } });

      await startCapture();
    };

    socket.onmessage = async (ev) => {
      // Может прийти строка (JSON-ивент) или бинарь (wav/pcm)
      if (typeof ev.data === 'string') {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        // Быстрые ветки протокола
        // 1) аудио-дельта базой (base64 pcm/wav)
        if (msg.type === 'response.audio.delta' && msg.delta) {
          const bytes = Uint8Array.from(atob(msg.delta), c => c.charCodeAt(0));
          playQueue.push(bytes.buffer);
          playLoop();
          return;
        }
        // 2) текстовые куски (опционально отобразим)
        if ((msg.type === 'response.delta' || msg.type === 'response.output_text.delta') && msg.delta) {
          transcriptEl && (transcriptEl.textContent += msg.delta);
          return;
        }
        // 3) завершение ответа
        if (msg.type === 'response.completed') {
          // готово — ждём новые входные чанки пользователя
          return;
        }
        // Остальное — просто лог
        console.log('WS event', msg.type || msg);
      } else {
        // Бинарные чанки — просто добавим в очередь на проигрывание
        const buf = await ev.data.arrayBuffer();
        playQueue.push(buf);
        playLoop();
      }
    };

    socket.onerror = (e) => {
      console.error('WS error', e);
      setStatus('Ошибка соединения');
    };

    socket.onclose = () => {
      console.log('WS closed');
      if (isRecording) {
        // если закрыли, пока «говорили», просто завершим локально
        isRecording = false;
      }
      cleanupAudio();
      buttonText.textContent = 'Начать консультацию';
      setStatus('Готов к работе');
    };
  }

  function disconnect() {
    if (!socket) return;
    if (isRecording) {
      isRecording = false;
      stopCaptureCommit();
      // дадим секунду допаковать/отправить — потом закрываем
      setTimeout(() => { socket && socket.close(); }, 1000);
    } else {
      socket.close();
    }
  }

  connectButton.addEventListener('click', () => {
    if (isRecording) disconnect();
    else connect();
  });
});
