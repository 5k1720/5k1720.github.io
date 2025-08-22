// script.js
function copyPrompt(btn){
  const text=document.getElementById('promptContent').textContent;
  const ta=document.createElement('textarea');
  ta.value=text;ta.setAttribute('readonly','');ta.style.position='absolute';ta.style.left='-9999px';
  document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(e){}document.body.removeChild(ta);
  showCopiedMsg();spawnParticles(btn)
}
function showCopiedMsg(){
  const el=document.createElement('div');el.textContent='✓ Copied';
  Object.assign(el.style,{position:'fixed',bottom:'10%',right:'10%',background:'rgba(0,0,0,0.8)',color:'#0f0',padding:'6px 12px',borderRadius:'6px',fontFamily:'Press Start 2P, monospace',fontSize:'0.7rem',zIndex:10000,opacity:'1',transition:'opacity 1s ease-out'});
  document.body.appendChild(el);setTimeout(()=>el.style.opacity='0',800);setTimeout(()=>el.remove(),1800)
}
function spawnParticles(btn){
  const r=btn.getBoundingClientRect(),vw=window.innerWidth,vh=window.innerHeight;
  let x=r.left+r.width/2,y=r.top+r.height/2;x=Math.min(vw-2,Math.max(2,x));y=Math.min(vh-2,Math.max(2,y));
  const n=18,edge=Math.min(x,vw-x,y,vh-y)-6,max=Math.max(32,Math.min(80,edge));
  for(let i=0;i<n;i++){const p=document.createElement('span');p.className='particle';
    const a=Math.random()*2*Math.PI,d=Math.random()*max,dx=Math.cos(a)*d,dy=Math.sin(a)*d;
    p.style.setProperty('--dx',dx+'px');p.style.setProperty('--dy',dy+'px');p.style.left=x+'px';p.style.top=y+'px';
    const s=6+Math.random()*6;p.style.width=s+'px';p.style.height=s+'px';p.style.background=`hsl(${Math.floor(Math.random()*360)},100%,60%)`;
    document.body.appendChild(p);setTimeout(()=>p.remove(),700)}
}
(function(){
  const el=document.querySelector('.tilt');if(!el)return;
  let px=0,py=0;
  function set(tX,tY){el.style.transform=`translateY(${py}px) rotateX(${tY}deg) rotateY(${tX}deg)`;}
  function onMove(e){
    const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
    const x=(e.clientX-cx)/r.width,y=(e.clientY-cy)/r.height;
    const rx=(x*8),ry=(-y*8);set(rx,ry)
  }
  function onOrient(e){
    const rx=(e.gamma||0)/8,ry=-(e.beta||0)/12;set(rx,ry)
  }
  el.addEventListener('mousemove',onMove);
  if(window.DeviceOrientationEvent){window.addEventListener('deviceorientation',onOrient)}
})();
