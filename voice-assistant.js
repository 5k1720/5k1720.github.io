// voice-assistant.js — audio-only, поддержка response.audio_delta | response.audio.delta | response.output_audio.delta
// BUILD=a2
document.addEventListener('DOMContentLoaded', () => {
  const connectButton = document.getElementById('connectButton');
  const statusEl = document.getElementById('status');
  const buttonText = connectButton.querySelector('.button-text');
  const WS_URL = 'wss://voice-assistant-backend-bym9.onrender.com';

  let socket;
  let audioCtx;
  let micStream, sourceNode, procNode;
  let isRecording = false;

  let playQueue = [];
  let playing = false;

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

  // helpers
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
  function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') {
      try { await audioCtx.resume(); } catch {}
    }
    return audioCtx;
  }

  async function playLoop() {
    if (playing) return;
    playing = true;
    await ensureAudioCtx();
    while (playQueue.length > 0) {
      const chunk = playQueue.shift(); // ожидаем WAV/декодируемый формат
      try {
        // decodeAudioData ожидает копию ArrayBuffer
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
    await ensureAudioCtx();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    // ScriptProcessorNode — да, устарел, но прост и везде работает
    const bufSize = 4096;
    procNode = audioCtx.createScriptProcessor(bufSize, 1, 1);
    sourceNode.connect(procNode);
    procNode.connect(audioCtx.destination);

    procNode.onaudioprocess = (e) => {
      if (!isRecording) return;
      const ch0 = e.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(ch0);
      const b64 = ab2b64(pcm);
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

      // Сессия: только аудио, голос + системка «консультант по ремонту»
      // Точные названия полей в твоём аккаунте я подтвердить не могу на 100% — НЕДОСТОВЕРНО.
      send({
        type: 'session.update',
        session: {
          voice: 'verse',
          output_audio_format: 'wav',
          instructions:
            'Ты — консультант сервисного центра по ремонту техники. ' +
            'Фокус: iPhone, MacBook, iMac, Apple Watch, Mac mini. ' +
            'Отвечай по-русски, кратко и по делу: первичная диагностика, вероятные причины, ' +
            'что клиент может проверить сам, и что лучше доверить мастеру. ' +
            'Не обещай цены/сроки без диагностики. Предупреждай о рисках.',
          temperature: 0.4
        }
      });

      await startMic();
    };

    socket.onmessage = async (ev) => {
      if (typeof ev.data === 'string') {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        // === АУДИО-ДЕЛЬТЫ ===
        // встречаются варианты имён события:
        // - response.audio_delta
        // - response.audio.delta
        // - response.output_audio.delta
        if (
          (msg.type === 'response.audio_delta' || msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') &&
          msg.delta
        ) {
          const buf = b64ToArrayBuffer(msg.delta);
          playQueue.push(buf);
          return playLoop();
        }

        // Остальные события просто логируем (на будущее)
        if (msg.type) console.log('WS event', msg.type);
        return;
      }

      // На всякий — если пришёл чистый бинарь
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
      // фиксим вход и просим СФОРМИРОВАТЬ ТОЛЬКО АУДИО-ОТВЕТ
      send({ type: 'input_audio_buffer.commit' });
      send({
        type: 'response.create',
        response: {
          modalities: ['audio'],
          instructions:
            'Ты — консультант сервисного центра по ремонту (Apple приоритет). ' +
            'Отвечай кратко, дружелюбно, безопасно.'
        }
      });
      setTimeout(() => socket && socket.close(), 1200);
    } else {
      socket.close();
    }
  }

  // Разрешаем аудио по юзер-жесту сразу
  connectButton.addEventListener('click', async () => {
    await ensureAudioCtx();
    if (isRecording) disconnect();
    else connect();
  });
});
