// voice-assistant.js — toggle talk, 24kHz, voice=verse, speed=1.45
// Универсальный стиль: кратко + мини-совет + чёткий CTA.
// Цены/сроки — только после диагностики.
// BUILD=toggle-24k-fast-brief-universal
document.addEventListener('DOMContentLoaded', () => {
  const connectButton = document.getElementById('connectButton');
  const statusEl = document.getElementById('status');
  const buttonText = connectButton.querySelector('.button-text');
  const WS_URL = 'wss://voice-assistant-backend-bym9.onrender.com';

  // Частоты как в гайдах
  const OUTPUT_SAMPLE_RATE = 24000;
  const INPUT_TARGET_RATE  = 24000;

  // Таймауты
  const IDLE_TIMEOUT_MS     = 20000;    // 20s — полная тишина/нет дельт → закрыть
  const SESSION_HARD_CAP_MS = 120000;   // защитный предел

  // Мягкий VAD — только для авто-commit вопроса
  const VAD_INTERVAL_MS   = 50;
  const COMMIT_SILENCE_MS = 1200;   // можешь снизить до 900 для ещё быстрее
  const RMS_THRESHOLD     = 0.010;

  let socket, audioCtx, micStream, sourceNode, procNode;
  let isLive = false;
  let playing = false;
  let stopPlaybackFlag = false;
  let currentSource = null;

  // VAD
  let silenceMs = 0;
  let lastVAD = 0;
  let hadSpeechSinceCommit = false;

  // Таймеры
  let idleTimer = null;
  let sessionCapTimer = null;

  // ==== UI ====
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
  function setStartUi() { buttonText.textContent = 'Начать разговор';     setStatus('Готов к работе'); }
  function setLiveUi()  { buttonText.textContent = 'Завершить разговор';  setStatus('В эфире: говорите, я слушаю'); }

  async function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') { try { await audioCtx.resume(); } catch {} }
  }

  // ==== PCM utils ====
  function b64FromAB(ab){const u=new Uint8Array(ab);let s='';for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s);}
  function abFromB64(b64){const s=atob(b64);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
  function floatToPCM16(f32){const o=new Int16Array(f32.length);for(let i=0;i<f32.length;i++){const v=Math.max(-1,Math.min(1,f32[i]));o[i]=v<0?v*0x8000:v*0x7FFF;}return o.buffer;}
  function pcm16ToFloat32(u8){const n=u8.length>>1,out=new Float32Array(n);for(let i=0,o=0;i<n;i++,o+=2){let v=(u8[o+1]<<8)|u8[o];if(v&0x8000)v|=0xFFFF0000;out[i]=Math.max(-1,Math.min(1,v/0x8000));}return out;}

  // downsample inputRate → targetRate
  function downsample(input, inRate, targetRate){
    if(inRate===targetRate) return input;
    const ratio=inRate/targetRate, outLen=Math.floor(input.length/ratio), out=new Float32Array(outLen);
    for(let i=0;i<outLen;i++){const start=Math.floor(i*ratio), end=Math.min(Math.floor((i+1)*ratio), input.length);
      let sum=0; for(let j=start;j<end;j++) sum+=input[j]; out[i]=sum/Math.max(1,end-start);}
    return out;
  }

  // ==== Playback ====
  let pcmQueue = [];
  async function playLoop(){
    if(playing) return; playing=true; stopPlaybackFlag=false;
    await ensureAudioCtx();
    while(pcmQueue.length && !stopPlaybackFlag){
      const f32=pcmQueue.shift();
      try{
        const buf=audioCtx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
        buf.copyToChannel(f32,0,0);
        const src=audioCtx.createBufferSource();
        currentSource=src; src.buffer=buf; src.connect(audioCtx.destination);
        await new Promise(res=>{src.onended=res; src.start();});
      }catch(e){ console.warn('PCM play error', e); }
      finally{ currentSource=null; }
    }
    playing=false;
  }
  function hardStopPlayback(){ stopPlaybackFlag=true; pcmQueue.length=0; try{ currentSource && currentSource.stop(0);}catch{} currentSource=null; }

  // ==== Таймеры ====
  function resetIdleTimer(){
    clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>{ stopAll('Нет активности'); }, IDLE_TIMEOUT_MS);
  }
  function startSessionCap(){
    clearTimeout(sessionCapTimer);
    sessionCapTimer=setTimeout(()=>{ stopAll('Лимит сессии'); }, SESSION_HARD_CAP_MS);
  }

  // ==== Микрофон + мягкий VAD (только для commit) ====
  async function startMic(){
    await ensureAudioCtx();
    micStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const bufSize=4096;
    sourceNode=audioCtx.createMediaStreamSource(micStream);
    procNode=audioCtx.createScriptProcessor(bufSize,1,1);
    sourceNode.connect(procNode); procNode.connect(audioCtx.destination);

    silenceMs=0; lastVAD=performance.now(); hadSpeechSinceCommit=false;

    procNode.onaudioprocess=(e)=>{
      if(!isLive) return;
      const ch0=e.inputBuffer.getChannelData(0);
      // отправляем звук
      const down=downsample(ch0, audioCtx.sampleRate, INPUT_TARGET_RATE);
      const b64=b64FromAB(floatToPCM16(down));
      send({ type:'input_audio_buffer.append', audio:b64 });

      // простая VAD, чтобы понять, когда «фраза закончилась»
      const now=performance.now();
      if(now-lastVAD>=VAD_INTERVAL_MS){
        lastVAD=now;
        let sum=0; for(let i=0;i<ch0.length;i++) sum+=ch0[i]*ch0[i];
        const rms=Math.sqrt(sum/ch0.length);
        if(rms<RMS_THRESHOLD){
          silenceMs+=VAD_INTERVAL_MS;
          if(silenceMs>=COMMIT_SILENCE_MS && hadSpeechSinceCommit){
            hadSpeechSinceCommit=false;
            silenceMs=0;
            send({ type:'input_audio_buffer.commit' });
            send({
              type:'response.create',
              response:{
                modalities:['audio'],
                instructions:
                  'Говори только по-русски. Ответ должен быть очень коротким, 1-2 предложения. ' +
                  'Структура ответа: сначала кратко посочувствуй и назови вероятную причину проблемы. ' +
                  'Затем дай один простой и безопасный совет, который не требует денег и не навредит устройству. ' +
                  'Всегда заканчивай фразой: «Но лучше приносите к нам на бесплатную диагностику, посмотрим и всё решим».'
              }
            });
          }
        }else{
          silenceMs=0; hadSpeechSinceCommit=true;
        }
      }

      resetIdleTimer(); // активность клиента
    };
  }
  function stopMic(){
    try{ procNode?.disconnect(); sourceNode?.disconnect(); micStream?.getTracks().forEach(t=>t.stop()); }catch{}
    procNode=sourceNode=micStream=null;
  }

  // ==== WS ====
  function send(obj){ socket?.readyState===WebSocket.OPEN && socket.send(JSON.stringify(obj)); }

  function connect(){
    if(socket?.readyState===WebSocket.OPEN) return;
    socket=new WebSocket(WS_URL);
    socket.binaryType='arraybuffer';

    socket.onopen=async ()=>{
      isLive=true; hardStopPlayback(); setLiveUi();
      // Сессионные настройки (универсальные правила)
      send({
        type:'session.update',
        session:{
          modalities:['audio'],
          voice:'verse',
          output_audio_format:'pcm16',
          temperature:0.2,
          speed:1.45,
          instructions:
            'Ты — дружелюбный и компетентный консультант сервисного центра. Говори по-русски, очень кратко и по делу. ' +
            'Твоя задача — выслушать проблему, дать один простой, безопасный и бесплатный совет, а затем пригласить на бесплатную диагностику. ' +
            'Никогда не называй цены или сроки ремонта. ' +
            'Структура каждого твоего ответа: 1. Краткое сочувствие и предположение о причине. 2. Один простой совет (например, «попробуйте перезагрузить» или «проверьте кабель»). 3. Обязательный финал: «Но лучше приносите к нам на бесплатную диагностику, посмотрим и всё решим».'
        }
      });

      resetIdleTimer();
      startSessionCap();
      await startMic();
    };

    socket.onmessage=(ev)=>{
      if(typeof ev.data!=='string') return;
      let msg; try{ msg=JSON.parse(ev.data);}catch{ return; }

      const pushDelta = (b64)=>{
        try{
          const f32=pcm16ToFloat32(abFromB64(b64));
          pcmQueue.push(f32);
          resetIdleTimer();
          playLoop();
          return true;
        }catch{ return false; }
      };

      // Классика
      if((msg.type==='response.audio.delta' || msg.type==='response.audio_delta' || msg.type==='response.output_audio.delta') && msg.delta){
        if(pushDelta(msg.delta)) return;
      }
      // Батч-дельты
      if(msg.type==='response.delta' && msg.delta){
        const arr=Array.isArray(msg.delta)?msg.delta:[msg.delta];
        for(const part of arr){
          if(part?.type==='output_audio.delta' && part?.audio){ if(pushDelta(part.audio)) return; }
          if(part?.type==='audio' && part?.delta){ if(pushDelta(part.delta)) return; }
        }
      }

      if(msg.type==='response.audio.done' || msg.type==='response.done' || msg.type==='response.completed'){
        resetIdleTimer();
        return;
      }

      if(msg.type==='response.error'){ console.error('Realtime error:', msg); }
    };

    socket.onerror=(e)=>{ console.error('WS error', e); setStatus('Ошибка соединения'); };
    socket.onclose =()=>{ stopAll(); };
  }

  // ==== Стоп всего ====
  function stopAll(reason=''){
    if(!isLive && !socket) return;
    isLive=false;
    hardStopPlayback();
    stopMic();
    try{ socket && socket.close(); }catch{}
    socket=null;
    clearTimeout(idleTimer); clearTimeout(sessionCapTimer);
    setStartUi();
    if(reason) console.log('[ended]', reason);
  }

  // ==== Кнопка-тоггл ====
  connectButton.addEventListener('click', async ()=>{
    await ensureAudioCtx();
    if(isLive){ stopAll('Кнопкой'); }
    else{ connect(); }
  });

  // helper for send
  function send(obj){ socket?.readyState===WebSocket.OPEN && socket.send(JSON.stringify(obj)); }
});