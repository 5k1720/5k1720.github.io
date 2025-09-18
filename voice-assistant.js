// Front: Realtime WS audio-only, PCM16 deltas
// BUILD=final
document.addEventListener('DOMContentLoaded', () => {
  const connectButton = document.getElementById('connectButton');
  const statusEl = document.getElementById('status');
  const buttonText = connectButton.querySelector('.button-text');
  const WS_URL = 'wss://voice-assistant-backend-bym9.onrender.com';

  const OUTPUT_SAMPLE_RATE = 24000; // НЕДОСТОВЕРНО: при искажении голоса попробуй 16000/48000

  let socket, audioCtx, micStream, sourceNode, procNode;
  let isRecording = false;

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

  async function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') { try { await audioCtx.resume(); } catch {} }
  }

  // utils
  function b64FromAB(ab) {
    const u8 = new Uint8Array(ab); let bin = '';
    for (let i=0;i<u8.length;i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }
  function abFromB64(b64) {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function floatToPCM16(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i=0;i<float32Array.length;i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out.buffer;
  }
  function pcm16ToFloat32(u8) {
    const len = u8.length >> 1; const out = new Float32Array(len);
    for (let i=0, o=0;i<len;i++,o+=2) {
      let val = (u8[o+1] << 8) | u8[o]; if (val & 0x8000) val |= 0xFFFF0000;
      out[i] = Math.max(-1, Math.min(1, val / 0x8000));
    }
    return out;
  }

  // playback queue
  let pcmQueue = []; let playing = false;
  async function playLoop() {
    if (playing) return; playing = true; await ensureAudioCtx();
    while (pcmQueue.length) {
      const f32 = pcmQueue.shift();
      try {
        const buf = audioCtx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
        buf.copyToChannel(f32, 0, 0);
        const src = audioCtx.createBufferSource();
        src.buffer = buf; src.connect(audioCtx.destination);
        await new Promise(res => { src.onended = res; src.start(); });
      } catch (e) { console.warn('PCM play error', e); }
    }
    playing = false;
  }

  function send(obj) { socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(obj)); }

  async function startMic() {
    await ensureAudioCtx();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    const bufSize = 4096;
    procNode = audioCtx.createScriptProcessor(bufSize, 1, 1);
    sourceNode.connect(procNode); procNode.connect(audioCtx.destination);

    procNode.onaudioprocess = (e) => {
      if (!isRecording) return;
      const ch0 = e.inputBuffer.getChannelData(0);
      const b64 = b64FromAB(floatToPCM16(ch0));
      send({ type: 'input_audio_buffer.append', audio: b64 }); // вход PCM base64
    };
  }
  function stopMic() {
    try { procNode?.disconnect(); sourceNode?.disconnect(); micStream?.getTracks().forEach(t => t.stop()); } catch {}
    procNode = sourceNode = micStream = null;
  }

  function connect() {
    if (socket?.readyState === WebSocket.OPEN) return;
    socket = new WebSocket(WS_URL); socket.binaryType = 'arraybuffer';

    socket.onopen = async () => {
      isRecording = true; setStatus('Говорите…'); buttonText.textContent = 'Завершить разговор';
      // сессия: только аудио, PCM16, голос, системные правила (ремонт Apple)
      send({
        type: 'session.update',
        session: {
          voice: 'verse',
          output_audio_format: 'pcm16', // совпадает с тем, что пришлёт модель на delta (см. доку) :contentReference[oaicite:5]{index=5}
          instructions:
            'Ты — консультант сервисного центра по ремонту техники. ' +
            'Фокус: iPhone, MacBook, iMac, Apple Watch, Mac mini. ' +
            'Отвечай по-русски, кратко и по делу: диагностика, причины, что проверить самому, ' +
            'когда идти в сервис; не обещай цены/сроки без диагностики. Предупреждай о рисках.',
          temperature: 0.4
        }
      });
      await startMic();
    };

    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }

      // AUDIO DELTAS (PCM16 base64) — по доке имя события: response.audio.delta
      if ((msg.type === 'response.audio.delta' || msg.type === 'response.audio_delta' || msg.type === 'response.output_audio.delta') && msg.delta) {
        pcmQueue.push(pcm16ToFloat32(abFromB64(msg.delta)));
        return playLoop();
      }

      if (msg.type) console.log('WS event', msg.type);
    };

    socket.onerror = (e) => { console.error('WS error', e); setStatus('Ошибка соединения'); };
    socket.onclose = () => { if (isRecording) isRecording = false; stopMic(); buttonText.textContent = 'Начать консультацию'; setStatus('Готов к работе'); };
  }

  function disconnect() {
    if (!socket) return;
    if (isRecording) {
      isRecording = false;
      send({ type: 'input_audio_buffer.commit' });         // фиксируем входной звук
      send({ type: 'response.create', response: { modalities: ['audio'] } }); // просим аудио-ответ
      // не закрываем сразу: ждём дельты. Закроется при следующем клике.
    } else {
      socket.close();
    }
  }

  connectButton.addEventListener('click', async () => { await ensureAudioCtx(); isRecording ? disconnect() : connect(); });
});
