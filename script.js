function copyPrompt(btn) {
  const text = document.getElementById('promptContent').textContent;

  // надёжное копирование через textarea (работает и на iOS)
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly','');
  ta.style.position = 'absolute';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showCopiedMsg();
    spawnParticles(btn);
  } catch(e) {
    console.error('Не удалось скопировать', e);
  }
  document.body.removeChild(ta);
}

function showCopiedMsg() {
  const msg = document.createElement('div');
  msg.textContent = '✓ Copied';
  msg.style.position = 'fixed';
  msg.style.bottom = '10%';
  msg.style.right = '10%';
  msg.style.background = 'rgba(0,0,0,0.8)';
  msg.style.color = '#0f0';
  msg.style.padding = '6px 12px';
  msg.style.borderRadius = '6px';
  msg.style.fontFamily = "Press Start 2P, monospace";
  msg.style.fontSize = '0.7rem';
  msg.style.zIndex = '10000';
  msg.style.opacity = '1';
  msg.style.transition = 'opacity 1s ease-out';
  document.body.appendChild(msg);
  setTimeout(()=> msg.style.opacity='0',800);
  setTimeout(()=> msg.remove(),1800);
}

function spawnParticles(btn) {
  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width/2;
  const y = rect.top + rect.height/2;
  const n = 18, max = 80;

  for (let i=0;i<n;i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    const ang = Math.random()*2*Math.PI;
    const dist = Math.random()*max;
    const dx = Math.cos(ang)*dist;
    const dy = Math.sin(ang)*dist;
    p.style.setProperty('--dx', dx+'px');
    p.style.setProperty('--dy', dy+'px');
    p.style.left = x+'px';
    p.style.top = y+'px';
    p.style.background = `hsl(${Math.floor(Math.random()*360)},100%,60%)`;
    const size = 6 + Math.random()*6; // 6–12 px
    p.style.width = size+'px';
    p.style.height = size+'px';
    document.body.appendChild(p);
    setTimeout(()=> p.remove(),700);
  }
}
