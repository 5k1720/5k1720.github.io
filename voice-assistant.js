// voice-assistant.js — экономичный режим: RU-only, коротко+CTA, VAD, 16kHz, таймауты
// BUILD=econ+timeout
document.addEventListener('DOMContentLoaded', () => {
  const connectButton = document.getElementById('connectButton');
  const statusEl = document.getElementById('status');
  const buttonText = connectButton.querySelector('.button-text');
  const WS_URL = 'wss://voice-assistant-backend-bym9.onrender.com';

  // Аудио
  const OUTPUT_SAMPLE_RATE = 16000;          // воспроизведение
  const INPUT_TARGET_RATE = 16000;           // отправляем в модель 16kHz

  // VAD (автостоп записи по тишине)
  const VAD_INTERVAL_MS = 50;
  const SILENCE_MS_TO_STOP = 600;
  const RMS_THRESHOLD = 0.015;

  // Таймауты экономии
  const IDLE_TIMEOUT_MS = 20000;             // 20s — нет активности → закрываем сокет
  const SESSION_HARD_CAP_MS = 60000;         // 60s — максимум жизни сессии

  let socket, audioCtx, micStream, sourceNode, procNode;
  let isRecording = false;
  let awaitingReply = false;
  let playing = false;
  let stopPlaybackFlag = false;
  let currentSource = null;

  let idleTimer = null;
  let sessionCapTimer = null;

  // ==== UI ====
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
  function setIdleUi() { buttonText.textContent = 'Начать консультацию'; setStatus('Готов к работе'); }

  async function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') { try { await audioCtx.resume(); } catch {} }
  }

  // ==== PCM/utils ====
  function b64FromAB(ab) { const u=new Uint8Array(ab); let s=''; for (let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); }
  function abFromB64(b64) { const s=atob(b64); const u=new Uint8Array(s.length); for (let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u; }
  function floatToPCM16(f32) { const o=new Int16Array(f32.length); for (let i=0;i<f32.length;i++){const s=Math.max(-1,Math.min(1,f32[i])); o[i]=s<0?s*0x8000:s*0x7FFF;} return o.buffer; }
  function pcm16ToFloat32(u8) { const n=u8.length>>1, out=new Float32Array(n); for(let i=0,o=0;i<n;i++,o+=2){let v=(u8[o+1]<<8)|u8[o]; if(v&0x8000)v|=0xFFFF0000; out[i]=Math.max(-1,Math.min(1,v/0x8000)); } return out; }

  // Простая децимация 48k → 16k (или любая inputRate → 16k)
  function downsample(inputFloat32, inputRate, targetRate) {
    if (inputRate === targetRate) return inputFloat32;
    const ratio = inputRate / targetRate;
    const outLen = Math.floor(inputFloat32.length / ratio);
    const out = new Float32Array(outLen);
    for (let i=0;i<outLen;i++){
      const start = Math.floor(i*ratio);
      const end = Math.min(Math.floor((i+1)*ratio), inputFloat32.length);
      let sum=0; for(let j=start;j<end;j++) sum+=inputFloat32[j];
      out[i] = sum / Math.max(1, end-start);
    }
    return out;
  }

  // ==== Playback ====
  let pcmQueue = [];
  async function playLoop() {
    if (playing) return; playing = true; stopPlaybackFlag = false;
    await ensureAudioCtx();
    while (pcmQueue.length && !stopPlaybackFlag) {
      const f32 = pcmQueue.shift();
      try {
        const buf = audioCtx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
        buf.copyToChannel(f32, 0, 0);
        const src = audioCtx.createBufferSource();
        currentSource = src;
        src.buffer = buf; src.connect(audioCtx.destination);
        await new Promise(res => { src.onended = res; src.start(); });
      } catch (e) { console.warn('PCM play error', e); }
      finally { currentSource = null; }
    }
    playing = false;
    if (!awaitingReply && !isRecording) setIdleUi();
  }
  function hardStopPlayback() {
    stopPlaybackFlag = true; pcmQueue.length = 0;
    try { currentSource && currentSource.stop(0); } catch {}
    currentSource = null;
  }

  // ==== Таймеры ====
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // тишина/нет дельт слишком долго — всё рубим
      try { socket && socket.close(); } catch {}
      hardStopPlayback();
      stopMic();
      isRecording = false; awaitingReply = false;
      setIdleUi();
    }, IDLE_TIMEOUT_MS);
  }
  function startSessionCap() {
    clearTimeout(sessionCapTimer);
    sessionCapTimer = setTimeout(() => {
      try { socket && socket.close(); } catch {}
      hardStopPlayback();
      stopMic();
      isRecording = false; awaitingReply = false;
      setIdleUi();
    }, SESSION_HARD_CAP_MS);
  }

  // ==== Mic capture + VAD ====
  let silenceMs = 0;
  async function startMic() {
    await ensureAudioCtx();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const bufSize = 4096;
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    procNode = audioCtx.createScriptProcessor(bufSize, 1, 1);
    sourceNode.connect(procNode); procNode.connect(audioCtx.destination);

    let lastVAD = performance.now();

    procNode.onaudioprocess = (e) => {
      if (!isRecording) return;
      const ch0 = e.inputBuffer.getChannelData(0);

      // 16k отправка
      const down = downsample(ch0, audioCtx.sampleRate, INPUT_TARGET_RATE);
      const b64 = b64FromAB(floatToPCM16(down));
      send({ type: 'input_audio_buffer.append', audio: b64 });

      // VAD
      const now = performance.now();
      if (now - lastVAD >= VAD_INTERVAL_MS) {
        lastVAD = now;
        let sum=0; for (let i=0;i<ch0.length;i++) sum += ch0[i]*ch0[i];
        const rms = Math.sqrt(sum / ch0.length);
        if (rms < RMS_THRESHOLD) {
          silenceMs += VAD_INTERVAL_MS;
          if (silenceMs >= SILENCE_MS_TO_STOP) {
            // автостоп записи и запрос короткого ответа
            isRecording = false;
            stopMic();
            awaitingReply = true;
            setStatus('Формирую ответ…');
            buttonText.textContent = 'Остановить ответ';
            send({ type: 'input_audio_buffer.commit' });
            send({
              type: 'response.create',
              response: {
                modalities: ['audio'],
                instructions:
                  'Отвечай только по-русски. В 1–2 коротких фразах. ' +
                  'В конце добавь: «Приходите на бесплатную диагностику к нам в сервис»'
              }
            });
          }
        } else {
          silenceMs = 0;
          resetIdleTimer(); // есть речь — продлеваем таймаут
        }
      }
    };
  }
  function stopMic() {
    try { procNode?.disconnect(); sourceNode?.disconnect(); micStream?.getTracks().forEach(t => t.stop()); } catch {}
    procNode = sourceNode = micStream = null;
  }

  // ==== WS ====
  function send(obj) { socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(obj)); }

  function connect() {
    if (socket?.readyState === WebSocket.OPEN) return;
    socket = new WebSocket(WS_URL);
    socket.binaryType = 'arraybuffer';

    socket.onopen = async () => {
      isRecording = true; awaitingReply = false; hardStopPlayback(); silenceMs = 0;
      setStatus('Говорите…'); buttonText.textContent = 'Завершить разговор';

      // Сессия: RU-only, коротко, голос, PCM16
      send({
        type: 'session.update',
        session: {
          voice: 'verse',
          output_audio_format: 'pcm16',
          temperature: 0.2,
          instructions:
            'Всегда говори только на русском. ' +
            'Ты консультант по ремонту техники (приоритет Apple: iPhone, MacBook, iMac, Apple Watch, Mac mini). ' +
            'Давай ответ в 1–2 коротких фразах: диагностика/вероятные причины/что проверить самому. ' +
            'Заверши фразой: «Приходите на бесплатную диагностику — запишу вас?»'
        }
      });

      resetIdleTimer();
      startSessionCap();
      await startMic();
    };

    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }

      // аудио-дельты (PCM16 base64)
      if ((msg.type === 'response.audio.delta' || msg.type === 'response.audio_delta' || msg.type === 'response.output_audio.delta') && msg.delta) {
        const f32 = pcm16ToFloat32(abFromB64(msg.delta));
        pcmQueue.push(f32);
        resetIdleTimer(); // пришли дельты — есть активность
        return playLoop();
      }

      // конец ответа — закрываем сокет, экономим
      if (msg.type === 'response.audio.done' || msg.type === 'response.done' || msg.type === 'response.completed') {
        awaitingReply = false;
        try { socket && socket.close(); } catch {}
        return setIdleUi();
      }

      if (msg.type) console.log('WS event', msg.type);
    };

    socket.onerror = (e) => { console.error('WS error', e); setStatus('Ошибка соединения'); };
    socket.onclose = () => {
      isRecording = false; awaitingReply = false;
      clearTimeout(idleTimer); clearTimeout(sessionCapTimer);
      stopMic(); setIdleUi();
    };
  }

  // ==== Кнопка ====
  connectButton.addEventListener('click', async () => {
    await ensureAudioCtx();

    if (isRecording) {
      // вручную завершаем запись → просим короткий ответ
      isRecording = false; stopMic(); awaitingReply = true;
      setStatus('Формирую ответ…'); buttonText.textContent = 'Остановить ответ';
      send({ type: 'input_audio_buffer.commit' });
      send({
        type: 'response.create',
        response: {
          modalities: ['audio'],
          instructions:
            'Отвечай только по-русски. В 1–2 коротких фразах. ' +
            'В конце добавь: «Приходите на бесплатную диагностику — запишу вас?»'
        }
      });
      return;
    }

    if (awaitingReply || playing) {
      // жёсткий стоп
      awaitingReply = false; hardStopPlayback();
      try { socket && socket.close(); } catch {}
      clearTimeout(idleTimer); clearTimeout(sessionCapTimer);
      return setIdleUi();
    }

    connect();
  });
});
