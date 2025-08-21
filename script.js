function copyPrompt(btn){
  const text = document.getElementById('promptContent').textContent;

  // надёжное копирование (работает и на iOS)
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly','');
  ta.style.position = 'absolute';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) { console.error(e); }
  document.body.removeChild(ta);

  showCopiedMsg();
  spawnParticles(btn);
}

function showCopiedMsg(){
  const el = document.createElement('div');
  el.textContent = '✓ Copied';
  Object.assign(el.style, {
    position:'fixed', bottom:'10%', right:'10%', background:'rgba(0,0,0,0.8)',
    color:'#0f0', padding:'6px 12px', borderRadius:'6px',
    fontFamily:"Press Start 2P, monospace", fontSize:'0.7rem',
    zIndex:10000, opacity:'1', transition:'opacity 1s ease-out'
  });
  document.body.appendChild(el);
  setTimeout(()=> el.style.opacity='0',800);
  setTimeout(()=> el.remove(),1800);
}

// частицы не выходят за границы: x/y и радиус ограничены
function spawnParticles(btn){
  const rect = btn.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = rect.left + rect.width/2;
  let y = rect.top  + rect.height/2;
  // зажимаем координаты в пределах экрана
  x = Math.min(vw-2, Math.max(2, x));
  y = Math.min(vh-2, Math.max(2, y));

  const n = 18;
  const edgeDist = Math.min(x, vw-x, y, vh-y) - 6; // расстояние до края
  const max = Math.max(32, Math.min(80, edgeDist)); // не вылетать за край

  for(let i=0;i<n;i++){
    const p = document.createElement('span');
    p.className = 'particle';
    const ang = Math.random()*2*Math.PI;
    const dist = Math.random()*max;
    const dx = Math.cos(ang)*dist;
    const dy = Math.sin(ang)*dist;
    p.style.setProperty('--dx', dx+'px');
    p.style.setProperty('--dy', dy+'px');
    p.style.left = x+'px';
    p.style.top  = y+'px';
    const size = 6 + Math.random()*6; // 6–12 px
    p.style.width  = size+'px';
    p.style.height = size+'px';
    p.style.background = `hsl(${Math.floor(Math.random()*360)},100%,60%)`;
    document.body.appendChild(p);
    setTimeout(()=> p.remove(), 700);
  }
}
