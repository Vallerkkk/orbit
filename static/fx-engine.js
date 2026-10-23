// Motor de partículas leve (canvas 2D) da Loja v2.
// - Um único requestAnimationFrame para todas as instâncias.
// - Só anima o que está visível (IntersectionObserver) e com a aba ativa; fora da tela fica parado.
// - prefers-reduced-motion: desenha um quadro estático e não anima.
// - DPR limitado a 1.5 e poucas partículas por instância para manter 60fps.
const TAU=Math.PI*2,rnd=(a,b)=>a+Math.random()*(b-a),pick=a=>a[Math.random()*a.length|0];
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const live=new Set();let raf=0,last=0,tick=0;
const io=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(es=>{for(const e of es){const fx=e.target.__fx;if(fx){fx.visible=e.isIntersecting;if(fx.visible)fx.resize();}}kick();},{rootMargin:'80px'}):null;
document.addEventListener('visibilitychange',kick);
function kick(){if(!raf&&!document.hidden&&[...live].some(f=>f.visible)&&!reduced()){last=performance.now();raf=requestAnimationFrame(loop);}}
function loop(now){raf=0;const dt=Math.min(.05,(now-last)/1000);last=now;tick++;let any=false;
  for(const fx of live){if(tick%60===0&&!fx.canvas.isConnected){fx.destroy();continue;}if(!fx.visible)continue;any=true;fx.step(dt,now/1000);}
  if(any&&!document.hidden)raf=requestAnimationFrame(loop);}

// ---------- formas ----------
const glow=(c,x,y,r,col,a=1)=>{const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,col);g.addColorStop(1,'transparent');c.globalAlpha=a;c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();};
function star4(c,x,y,r,col,a){c.globalAlpha=a;c.fillStyle=col;c.beginPath();c.moveTo(x,y-r);c.quadraticCurveTo(x,y,x+r,y);c.quadraticCurveTo(x,y,x,y+r);c.quadraticCurveTo(x,y,x-r,y);c.quadraticCurveTo(x,y,x,y-r);c.fill();}
function petal(c,p,col){c.save();c.translate(p.x,p.y);c.rotate(p.rot);c.scale(1,.6+.4*Math.sin(p.rot*2));c.globalAlpha=p.a;c.fillStyle=col;c.beginPath();c.moveTo(0,-p.s);c.bezierCurveTo(p.s,-p.s,p.s*.8,p.s*.6,0,p.s);c.bezierCurveTo(-p.s*.8,p.s*.6,-p.s,-p.s,0,-p.s);c.fill();c.restore();}
function flame(c,p,cols){const k=p.life/p.max,s=p.s*(1-k*.7);c.globalAlpha=(1-k)*.9;const g=c.createRadialGradient(p.x,p.y,0,p.x,p.y,s*2);g.addColorStop(0,cols[2]||'#fff');g.addColorStop(.35,cols[1]);g.addColorStop(1,'transparent');c.fillStyle=g;c.beginPath();c.ellipse(p.x,p.y,s,s*1.8,0,0,TAU);c.fill();}
function bubble(c,p,col){c.globalAlpha=p.a*.9;c.strokeStyle=col;c.lineWidth=1;c.beginPath();c.arc(p.x,p.y,p.s,0,TAU);c.stroke();c.globalAlpha=p.a*.7;c.fillStyle='#fff';c.beginPath();c.arc(p.x-p.s*.35,p.y-p.s*.35,p.s*.25,0,TAU);c.fill();}
function flake(c,p,col){c.save();c.translate(p.x,p.y);c.rotate(p.rot);c.globalAlpha=p.a;c.strokeStyle=col;c.lineWidth=Math.max(.8,p.s/4);c.beginPath();for(let i=0;i<3;i++){c.rotate(TAU/6);c.moveTo(-p.s,0);c.lineTo(p.s,0);}c.stroke();c.restore();}
function bat(c,p,col,t){const f=Math.sin(t*14+p.seed)*.8;c.save();c.translate(p.x,p.y);c.scale(p.s/8,p.s/8);c.globalAlpha=p.a;c.fillStyle=col;c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(-4,-4-f*4,-9,-2-f*5);c.quadraticCurveTo(-6,0,-7,3);c.quadraticCurveTo(-3,1,0,3);c.quadraticCurveTo(3,1,7,3);c.quadraticCurveTo(6,0,9,-2-f*5);c.quadraticCurveTo(4,-4-f*4,0,0);c.fill();c.restore();}
function bolt(c,x1,y1,x2,y2,col,a,w=1.6){const pts=[[x1,y1]];const n=7;for(let i=1;i<n;i++){const k=i/n;pts.push([x1+(x2-x1)*k+rnd(-8,8),y1+(y2-y1)*k+rnd(-8,8)]);}pts.push([x2,y2]);
  c.globalAlpha=a;c.strokeStyle=col;c.lineWidth=w;c.shadowColor=col;c.shadowBlur=10;c.beginPath();c.moveTo(...pts[0]);for(const p of pts)c.lineTo(...p);c.stroke();c.shadowBlur=0;c.lineWidth=w/2.5;c.strokeStyle='#fff';c.stroke();}

// ---------- presets ----------
// spawn(fx) cria partícula; move(p,dt,fx,t); draw(c,p,fx,t); bg(c,fx,t) desenha camadas de fundo (modo effect/hero).
const P={};
const drift={move(p,dt){p.x+=p.vx*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;}};
P.nebula={n:[26,14,22],spawn:f=>({vx:rnd(-4,4),vy:rnd(-3,3),s:rnd(.6,1.8),tw:rnd(0,TAU)}),...drift,
  draw(c,p,f,t){const a=.35+.65*Math.abs(Math.sin(t*1.6+p.tw));glow(c,p.x,p.y,p.s*4,f.cols[2],a*.5);c.globalAlpha=a;c.fillStyle='#fff';c.fillRect(p.x-p.s/2,p.y-p.s/2,p.s,p.s);},
  bg(c,f,t){const {w,h}=f;for(let i=0;i<3;i++){const x=w*(.25+.5*Math.sin(t*.07+i*2.1)),y=h*(.4+.3*Math.cos(t*.05+i));glow(c,x,y,Math.max(w,h)*.45,f.cols[i%2],.22);}
    const k=(t*.35)%3;if(k<.6){const x=w*(1.1-k*1.6),y=h*(-.1+k*.9);const g=c.createLinearGradient(x,y,x+60,y-30);g.addColorStop(0,'#fff');g.addColorStop(1,'transparent');c.globalAlpha=1-k/.6;c.strokeStyle=g;c.lineWidth=1.5;c.beginPath();c.moveTo(x,y);c.lineTo(x+60,y-30);c.stroke();}}};
P.neonrain={n:[34,16,26],spawn:f=>({vx:-20,vy:rnd(220,380),s:rnd(8,22),c:Math.random()<.5?0:1}),...drift,
  draw(c,p,f){c.globalAlpha=.75;const g=c.createLinearGradient(p.x,p.y-p.s,p.x,p.y);g.addColorStop(0,'transparent');g.addColorStop(1,f.cols[p.c]);c.strokeStyle=g;c.lineWidth=1.4;c.beginPath();c.moveTo(p.x+p.s*.08,p.y-p.s);c.lineTo(p.x,p.y);c.stroke();},
  bg(c,f,t){if(Math.sin(t*3.1)>.93){for(let i=0;i<3;i++){c.globalAlpha=.35;c.fillStyle=f.cols[i%2];c.fillRect(0,rnd(0,f.h),f.w,rnd(2,7));}}glow(c,f.w*.8,f.h,f.w*.6,f.cols[0],.25);glow(c,f.w*.1,f.h*.2,f.w*.5,f.cols[1],.18);}};
P.fireflies={n:[22,12,18],spawn:f=>({vx:rnd(-10,10),vy:rnd(-10,10),s:rnd(1.2,2.6),tw:rnd(0,TAU),leaf:Math.random()<.25,rot:rnd(0,TAU),vr:rnd(-1,1)}),
  move(p,dt,f,t){if(p.leaf){p.y+=18*dt;p.x+=Math.sin(t+p.tw)*14*dt;p.rot+=p.vr*dt;}else{p.vx+=rnd(-30,30)*dt;p.vy+=rnd(-30,30)*dt;p.vx*=.98;p.vy*=.98;p.x+=p.vx*dt;p.y+=p.vy*dt;}},
  draw(c,p,f,t){if(p.leaf){p.a=.7;p.s2=p.s;petal(c,{...p,s:p.s*3},f.cols[0]);return;}const a=Math.max(0,Math.sin(t*2+p.tw));glow(c,p.x,p.y,p.s*6,f.cols[2],a*.8);c.globalAlpha=a;c.fillStyle='#fffbd0';c.beginPath();c.arc(p.x,p.y,p.s*.7,0,TAU);c.fill();},
  bg(c,f){glow(c,f.w*.5,f.h*1.1,f.w*.8,f.cols[0],.22);}};
P.flames={n:[46,26,34],life:[.6,1.3],spawn:f=>({vx:rnd(-12,12),vy:rnd(-90,-40),s:rnd(3,8),ember:Math.random()<.25}),
  move(p,dt,f,t){p.x+=(p.vx+Math.sin(t*6+p.y*.05)*12)*dt;p.y+=p.vy*dt;},
  draw(c,p,f){if(p.ember){c.globalAlpha=1-p.life/p.max;c.fillStyle=f.cols[2];c.fillRect(p.x,p.y,1.6,1.6);glow(c,p.x,p.y,4,f.cols[1],.6*(1-p.life/p.max));}else flame(c,p,f.cols);},
  bg(c,f,t){glow(c,f.w*.5,f.h*1.15,f.w*.75,f.cols[0],.45+.1*Math.sin(t*5));},from:'bottom'};
P.bubbles={n:[24,12,18],spawn:f=>({vx:0,vy:rnd(-45,-18),s:rnd(1.5,5),tw:rnd(0,TAU),a:rnd(.4,.9),plank:Math.random()<.35}),
  move(p,dt,f,t){p.y+=p.vy*dt;p.x+=Math.sin(t*2+p.tw)*10*dt;},
  draw(c,p,f,t){if(p.plank){const a=Math.max(0,Math.sin(t*1.5+p.tw));glow(c,p.x,p.y,6,f.cols[2],a*.7);return;}bubble(c,p,f.cols[1]);},
  bg(c,f,t){for(let i=0;i<3;i++){const x=f.w*(.2+i*.3)+Math.sin(t*.4+i)*20;const g=c.createLinearGradient(x,0,x+40,f.h);g.addColorStop(0,'rgba(180,240,255,.16)');g.addColorStop(1,'transparent');c.globalAlpha=1;c.fillStyle=g;c.beginPath();c.moveTo(x-10,0);c.lineTo(x+30,0);c.lineTo(x+90,f.h);c.lineTo(x+20,f.h);c.fill();}},from:'bottom'};
P.petals={n:[20,10,16],spawn:f=>({vx:rnd(8,22),vy:rnd(22,45),s:rnd(3,6),rot:rnd(0,TAU),vr:rnd(-2,2),tw:rnd(0,TAU),a:rnd(.6,1),c:Math.random()<.7?0:1}),
  move(p,dt,f,t){p.x+=(p.vx+Math.sin(t*1.5+p.tw)*20)*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;},draw(c,p,f){petal(c,p,f.cols[p.c]);},
  bg(c,f){glow(c,f.w*.85,f.h*.1,f.w*.5,f.cols[0],.2);},from:'top'};
P.pixels={n:[26,12,20],spawn:f=>({vx:0,vy:rnd(30,70),s:pick([2,3,4]),c:Math.random()*3|0}),...drift,
  draw(c,p,f){const q=4;c.globalAlpha=.9;c.fillStyle=f.cols[p.c];c.fillRect(Math.round(p.x/q)*q,Math.round(p.y/q)*q,p.s,p.s);},
  bg(c,f,t){c.globalAlpha=.08;c.fillStyle='#fff';for(let y=(t*20)%4;y<f.h;y+=4)c.fillRect(0,y,f.w,1);},from:'top'};
P.lightning={n:[22,12,18],life:[.3,.9],spawn:f=>({vx:rnd(-80,80),vy:rnd(-80,80),s:rnd(1,2.2)}),...drift,
  draw(c,p,f){const a=1-p.life/p.max;c.globalAlpha=a;c.strokeStyle=f.cols[1];c.lineWidth=p.s*.7;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x-p.vx*.04,p.y-p.vy*.04);c.stroke();glow(c,p.x,p.y,5,f.cols[0],a*.6);},
  bg(c,f,t){f.zap=(f.zap||0)-1/60;if(f.zap<=0&&Math.random()<.025){f.zap=.18;f.bx=rnd(.1,.9)*f.w;}if(f.zap>0){c.fillStyle=f.cols[0];c.globalAlpha=f.zap*.6;c.fillRect(0,0,f.w,f.h);bolt(c,f.bx,0,f.bx+rnd(-40,40),f.h*rnd(.5,1),f.cols[1],1,2);}}};
P.aurora={n:[18,10,14],spawn:f=>({vx:0,vy:0,s:rnd(.5,1.4),tw:rnd(0,TAU)}),move(){},
  draw(c,p,f,t){c.globalAlpha=.4+.6*Math.abs(Math.sin(t+p.tw));c.fillStyle='#fff';c.fillRect(p.x,p.y,p.s,p.s);},
  bg(c,f,t){for(let i=0;i<3;i++){c.globalAlpha=.32;const g=c.createLinearGradient(0,0,0,f.h);g.addColorStop(0,'transparent');g.addColorStop(.45,f.cols[i===1?1:0]);g.addColorStop(1,'transparent');c.fillStyle=g;c.beginPath();
    for(let x=0;x<=f.w;x+=8){const y=f.h*(.35+.12*i)+Math.sin(x*.012+t*(.6+i*.2)+i*2)*f.h*.12;x?c.lineTo(x,y):c.moveTo(x,y);}for(let x=f.w;x>=0;x-=8){const y=f.h*(.35+.12*i)+Math.sin(x*.012+t*(.6+i*.2)+i*2)*f.h*.12+f.h*.3;c.lineTo(x,y);}c.fill();}},spread:true};
P.snow={n:[30,14,22],spawn:f=>{const z=Math.random();return {vx:rnd(-6,6),vy:10+z*40,s:1+z*3.2,rot:rnd(0,TAU),vr:rnd(-.6,.6),a:.4+z*.6,tw:rnd(0,TAU)};},
  move(p,dt,f,t){p.x+=(p.vx+Math.sin(t+p.tw)*8)*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;},draw(c,p,f){p.s>3?flake(c,p,f.cols[1]):(c.globalAlpha=p.a,c.fillStyle='#fff',c.beginPath(),c.arc(p.x,p.y,p.s*.6,0,TAU),c.fill());},
  bg(c,f,t){const x=((t*.25)%2)*f.w*1.5-f.w*.25;const g=c.createLinearGradient(x-60,0,x+60,f.h);g.addColorStop(0,'transparent');g.addColorStop(.5,'rgba(255,255,255,.12)');g.addColorStop(1,'transparent');c.globalAlpha=1;c.fillStyle=g;c.fillRect(0,0,f.w,f.h);},from:'top'};
P.gold={n:[24,12,18],spawn:f=>({vx:rnd(-6,6),vy:rnd(-20,-6),s:rnd(1.5,4),tw:rnd(0,TAU)}),...drift,
  draw(c,p,f,t){const a=Math.max(0,Math.sin(t*3+p.tw));star4(c,p.x,p.y,p.s*(1+a),f.cols[1],a);glow(c,p.x,p.y,p.s*4,f.cols[0],a*.5);},
  bg(c,f,t){const x=((t*.3)%2.2)*f.w-f.w*.3;const g=c.createLinearGradient(x-80,0,x+80,f.h*.4);g.addColorStop(0,'transparent');g.addColorStop(.5,'rgba(255,236,170,.18)');g.addColorStop(1,'transparent');c.globalAlpha=1;c.fillStyle=g;c.fillRect(0,0,f.w,f.h);glow(c,f.w*.5,f.h*.5,f.w*.6,f.cols[2],.15);}};
P.vapor={n:[14,8,12],spawn:f=>({vx:0,vy:0,s:rnd(1,2.5),tw:rnd(0,TAU)}),move(){},
  draw(c,p,f,t){star4(c,p.x,p.y*.5,p.s*2,'#fff',.3+.7*Math.abs(Math.sin(t*2+p.tw)));},
  bg(c,f,t){const hz=f.h*.58,sx=f.w*.5,sr=Math.min(f.w,f.h)*.24;const g=c.createLinearGradient(0,hz-sr,0,hz);g.addColorStop(0,'#ffd36e');g.addColorStop(1,f.cols[0]);c.globalAlpha=.85;c.fillStyle=g;c.beginPath();c.arc(sx,hz,sr,Math.PI,0);c.fill();
    c.fillStyle=f.bg;for(let i=0;i<5;i++){c.fillRect(sx-sr,hz-sr*.1-i*sr*.17,sr*2,1.5+i*.8);}c.globalAlpha=.55;c.strokeStyle=f.cols[1];c.lineWidth=1;
    for(let i=0;i<9;i++){const k=((i+(t*.6)%1)/9)**2;const y=hz+k*(f.h-hz);c.beginPath();c.moveTo(0,y);c.lineTo(f.w,y);c.stroke();}for(let i=-8;i<=8;i++){c.beginPath();c.moveTo(sx+i*8,hz);c.lineTo(sx+i*f.w*.18,f.h);c.stroke();}},spread:true};
P.holo={n:[20,10,16],spawn:f=>({vx:rnd(-5,5),vy:rnd(-5,5),s:rnd(1.5,3.5),tw:rnd(0,TAU),h:rnd(0,360)}),...drift,
  draw(c,p,f,t){const a=Math.abs(Math.sin(t*2+p.tw));star4(c,p.x,p.y,p.s*(1+a),`hsl(${(p.h+t*90)%360} 100% 80%)`,a);},
  bg(c,f,t){const x=Math.sin(t*.6)*f.w*.5+f.w*.5;const g=c.createLinearGradient(x-f.w*.6,0,x+f.w*.6,f.h);for(let i=0;i<=6;i++)g.addColorStop(i/6,`hsla(${(i*60+t*40)%360} 100% 70% / ${i%2?.16:.05})`);c.globalAlpha=1;c.fillStyle=g;c.fillRect(0,0,f.w,f.h);}};
P.bats={n:[12,6,10],spawn:f=>({vx:rnd(30,60)*(Math.random()<.5?-1:1),vy:rnd(-10,10),s:rnd(5,10),seed:rnd(0,10),a:rnd(.6,1),ember:Math.random()<.35}),
  move(p,dt,f,t){p.x+=p.vx*dt;p.y+=(p.vy+Math.sin(t*3+p.seed)*15)*dt;},draw(c,p,f,t){if(p.ember){glow(c,p.x,p.y,4,f.cols[0],.7);return;}bat(c,p,'#0b0710',t);c.globalAlpha=.4;},
  bg(c,f,t){glow(c,f.w*.78,f.h*.25,Math.min(f.w,f.h)*.35,'#fff3c4',.35);c.globalAlpha=.9;c.fillStyle='#ffeeb0';c.beginPath();c.arc(f.w*.78,f.h*.25,Math.min(f.w,f.h)*.11,0,TAU);c.fill();glow(c,f.w*.3,f.h*1.1,f.w*.7,f.cols[1],.3);},spread:true};
P.halo={n:[20,10,16],life:[1.5,3],spawn:f=>({vx:rnd(-4,4),vy:rnd(-30,-10),s:rnd(1,2.5)}),...drift,
  draw(c,p,f){const a=Math.sin(Math.PI*p.life/p.max);glow(c,p.x,p.y,p.s*5,f.cols[0],a*.6);c.globalAlpha=a;c.fillStyle='#fff';c.beginPath();c.arc(p.x,p.y,p.s*.6,0,TAU);c.fill();},
  bg(c,f,t){glow(c,f.w*.5,f.h*.5,f.w*.5,f.cols[2],.18+.06*Math.sin(t*2));},from:'bottom'};
for(const k of ['stars','particles','glitch','aurora2'])P[k]=P[k]||P.nebula;

// ---------- instância ----------
// mode: 'effect' (área toda), 'hero' (área toda, mais partículas), 'frame' (anel do avatar), 'border' (contorno do cartão).
export function mountFx(host,{preset='nebula',colors=['#9b7bff','#ff7ad9','#7fe3ff'],bg='#0d0a22',mode='effect',radius=16}={}){
  const def=P[preset]||P.nebula;const canvas=document.createElement('canvas');canvas.className='fx-canvas fx-'+mode;canvas.setAttribute('aria-hidden','true');host.append(canvas);
  const c=canvas.getContext('2d');const fx={canvas,visible:false,w:0,h:0,cols:colors,bg,parts:[],mode,def,
    resize(){const r=canvas.getBoundingClientRect(),d=Math.min(1.5,devicePixelRatio||1);if(!r.width||!r.height)return;if(Math.abs(r.width-fx.w)<1&&Math.abs(r.height-fx.h)<1)return;fx.w=r.width;fx.h=r.height;canvas.width=r.width*d|0;canvas.height=r.height*d|0;c.setTransform(d,0,0,d,0,0);fx.seed();},
    seed(){const n=def.n[mode==='frame'?1:mode==='border'?2:0]*(mode==='hero'?1.6:1)*(fx.w*fx.h<9000?.6:1)|0;fx.parts=[];for(let i=0;i<n;i++)fx.parts.push(fx.spawn(true));},
    spawn(initial){const p=Object.assign({rot:0,vr:0,a:1,life:0},def.spawn(fx));const [l0,l1]=def.life||[3,7];p.max=rnd(l0,l1);if(initial)p.life=rnd(0,p.max);
      if(mode==='border'){p.t=Math.random();p.sp=rnd(.03,.08)*(Math.random()<.5?1:-1);p.off=rnd(-3,3);}
      else if(mode==='frame'){const a=rnd(0,TAU),R=Math.min(fx.w,fx.h)*.36;p.ang=a;p.R=R*rnd(.92,1.12);p.av=rnd(.3,.9)*(Math.random()<.5?1:-1);p.x=fx.w/2+Math.cos(a)*p.R;p.y=fx.h/2+Math.sin(a)*p.R;}
      else{p.x=rnd(0,fx.w);p.y=def.from==='bottom'&&!initial?fx.h+8:def.from==='top'&&!initial?-8:rnd(0,fx.h);}return p;},
    perim(t){const w=fx.w-8,h=fx.h-8,L=2*(w+h);let d=((t%1)+1)%1*L;if(d<w)return [4+d,4,0];d-=w;if(d<h)return [4+w,4+d,1];d-=h;if(d<w)return [4+w-d,4+h,2];d-=w;return [4,4+h-d,3];},
    step(dt,t){if(!fx.w){fx.resize();if(!fx.w)return;}c.clearRect(0,0,fx.w,fx.h);c.globalCompositeOperation='source-over';
      if((mode==='effect'||mode==='hero')&&def.bg){def.bg(c,fx,t);c.globalAlpha=1;}
      c.globalCompositeOperation='lighter';if(preset==='bats'||preset==='pixels')c.globalCompositeOperation='source-over';
      for(let i=0;i<fx.parts.length;i++){let p=fx.parts[i];p.life+=dt;
        if(mode==='border'){p.t+=p.sp*dt;const [x,y]=fx.perim(p.t);p.x=x;p.y=y;if(def.from==='bottom'){p.y-= (p.life%1)*6;}def.draw(c,{...p,x:p.x,y:p.y,a:p.a??1},fx,t);if(p.life>p.max)fx.parts[i]=fx.spawn(false);continue;}
        if(mode==='frame'){p.ang+=p.av*dt;const tx=fx.w/2+Math.cos(p.ang)*p.R,ty=fx.h/2+Math.sin(p.ang)*p.R;if(def.from==='bottom'||def.from==='top'){def.move(p,dt,fx,t);p.x+=(tx-p.x)*.02;}else{p.x=tx;p.y=ty;}
          def.draw(c,p,fx,t);if(p.life>p.max||p.y<-10||p.y>fx.h+10)fx.parts[i]=fx.spawn(false);continue;}
        def.move(p,dt,fx,t);def.draw(c,p,fx,t);
        if(p.life>p.max||p.y<-12||p.y>fx.h+12||p.x<-12||p.x>fx.w+12){fx.parts[i]=fx.spawn(false);}}
      if(mode==='border'&&preset==='lightning'&&Math.random()<.02){const a=fx.perim(Math.random()),b=fx.perim(Math.random());c.globalCompositeOperation='lighter';bolt(c,a[0],a[1],b[0],b[1],fx.cols[1],.8,1.2);}
      c.globalAlpha=1;c.globalCompositeOperation='source-over';},
    destroy(){live.delete(fx);io?.unobserve(canvas);canvas.remove();}};
  canvas.__fx=fx;live.add(fx);
  if(reduced()){requestAnimationFrame(()=>{fx.resize();fx.step(0,2);});return fx;}
  if(io)io.observe(canvas);else{fx.visible=true;kick();}return fx;
}
export function destroyFxIn(node){node?.querySelectorAll?.('canvas.fx-canvas').forEach(cv=>cv.__fx?.destroy());}
