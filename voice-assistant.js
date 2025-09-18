// voice-assistant.js — Realtime WS клиент (audio-only)
// BUILD=a1
document.addEventListener('DOMContentLoaded', () => {
  const connectButton = document.getElementById('connectButton');
  const statusEl = document.getElementById('status');
  const buttonText = connectButton.querySelector('.button-text');

  const WS_URL = 'wss://voice-assistant-backend-bym9.onrender.com';

  let socket;
  let audioCtx;
  let micStream;
  let sourceNode;
  let procNode;
  let isRecording = false;

  let playQueue = [];
  let playing = false;

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

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
      const chunk = playQueue.shift(); // ожидаем WAV-дельты
      try {
        const buf = await audioCtx.decodeAudioData(chunk.slice(0));
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        await new Promise(res => { src.onended = res; src.start(); });
      } catch (e) {
        console.warn('Decode/play error, skip', e);
      }
    }
    playing = false;
  }

  function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(obj));
    }
  }

  async function startMic() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioCtx.createMediaStreamSource(micStream);

    const bufSize = 4096;
    procNode = audioCtx.createScriptProcessor(bufSize, 1, 1);
    sourceNode.connect(procNode);
    procNode.connect(audioCtx.destination);

    procNode.onaudioprocess = (e) => {
      if (!isRecording) return;
      const ch0 = e.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(ch0);
      const b64 = ab2b64(pcm);
      // Отправляем входные PCM-чанки
      send({ type: 'input_audio_buffer.append', audio: b64 });
    };
  }

  function stopMic() {
    try { procNode && procNode.disconnect(); } catch {}
    try { sourceNode && sourceNode.disconnect(); } catch {}
    try { micStream && micStream.getTracks().forEach(t => t.stop()); } catch {}
    procNode = sourceNode = micStream = null;
  }

  function connect() {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    socket = new WebSocket(WS_URL);
    socket.binaryType = 'arraybuffer';

    socket.onopen = async () => {
      isRecording = true;
      setStatus('Говорите…');
      buttonText.textContent = 'Завершить разговор';

      // Настройка сессии: голос + только аудио-вывод + системная роль (консультант по ремонту)
      // Поля voice/output_audio_format/instructions подтверждать не могу на 100% (НЕДОСТОВЕРНО, зависит от текущего релиза модели).
      send({
        type: 'session.update',
        session: {
          voice: 'verse',
          output_audio_format: 'wav',
          instructions:
            'Ты — консультант сервисного центра по ремонту техники. ' +
            'Фокус: iPhone, MacBook, iMac, Apple Watch, Mac mini. ' +
            'Отвечай по-русски, коротко и предметно: первичная диагностика, вероятные причины, ' +
            'что пользователь может проверить сам, и что лучше доверить мастеру. ' +
            'Не обещай цены/сроки без диагностики. Предупреждай о рисках самостоятельного ремонта.',
          temperature: 0.4
        }
      });

      await startMic();
    };

    socket.onmessage = async (ev) => {
      if (typeof ev.data === 'string') {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        // Нужное событие с аудио-дельтами в base64 (ожидаем WAV)
        if (msg.type === 'response.output_audio.delta' && msg.delta) {
          const bytes = Uint8Array.from(atob(msg.delta), c => c.charCodeAt(0));
          playQueue.push(bytes.buffer);
          return playLoop();
        }

        // Остальные события просто логируем (для отладки протокола)
        if (msg.type) console.log('WS event', msg.type);
        return;
      }

      // Если вдруг придёт бинарь — тоже пробуем проигрывать
      const buf = await ev.data.arrayBuffer?.() ?? ev.data;
      playQueue.push(buf);
      playLoop();
    };

    socket.onerror = (e) => {
      console.error('WS error', e);
      setStatus('Ошибка соединения');
    };

    socket.onclose = () => {
      if (isRecording) isRecording = false;
      stopMic();
      buttonText.textContent = 'Начать консультацию';
      setStatus('Готов к работе');
    };
  }

  function disconnect() {
    if (!socket) return;
    if (isRecording) {
      isRecording = false;
      // Закрываем ввод и просим СОЗДАТЬ ОТВЕТ ТОЛЬКО В АУДИО
      send({ type: 'input_audio_buffer.commit' });
      send({
        type: 'response.create',
        response: {
          modalities: ['audio'], // только голос
          instructions:
            'Ты — консультант сервисного центра по ремонту техники (приоритет — устройства Apple). ' +
            'Отвечай кратко, чётко, дружелюбно и безопасно.',
        }
      });
      setTimeout(() => socket && socket.close(), 1200);
    } else {
      socket.close();
    }
  }

  connectButton.addEventListener('click', () => {
    if (isRecording) disconnect();
    else connect();
  });
});
