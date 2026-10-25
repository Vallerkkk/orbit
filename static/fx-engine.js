// Motor de partículas leve (canvas 2D) da Loja v2.
// - Um único requestAnimationFrame para todas as instâncias.
// - Só anima o que está visível (IntersectionObserver) e com a aba ativa; fora da tela fica parado.
// - Movimento reduzido (SO ou ajuste do app): desenha um quadro estático, para o RAF e retoma ao desativar.
// - DPR limitado a 1.5 e poucas partículas por instância para manter 60fps.
import {prefersReducedMotion,onMotionPreferenceChange} from './motion-preference.js';
const TAU=Math.PI*2,rnd=(a,b)=>a+Math.random()*(b-a),pick=a=>a[Math.random()*a.length|0];
const reduced=()=>prefersReducedMotion();
const live=new Set();let raf=0,last=0,tick=0;
const io=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(es=>{for(const e of es){const fx=e.target.__fx;if(fx){fx.visible=e.isIntersecting;if(fx.visible){fx.resize();if(reduced())fx.step(0,2);}}}kick();},{rootMargin:'80px'}):null;
document.addEventListener('visibilitychange',kick);
function sweep(){for(const fx of live)if(!fx.canvas.isConnected)fx.destroy();}
function kick(){sweep();if(!raf&&!document.hidden&&[...live].some(f=>f.visible)&&!reduced()){last=performance.now();raf=requestAnimationFrame(loop);}}
function loop(now){raf=0;if(reduced()){for(const fx of live)if(fx.visible)fx.step(0,now/1000);return;}const dt=Math.min(.05,(now-last)/1000);last=now;tick++;let any=false;
  for(const fx of live){if(tick%60===0&&!fx.canvas.isConnected){fx.destroy();continue;}if(!fx.visible)continue;any=true;fx.step(dt,now/1000);}
  // Sem varredura no fim do ciclo, um canvas removido do DOM depois que todas as
  // instâncias saem da tela ficaria preso em `live` para sempre.
  if(any&&!document.hidden)raf=requestAnimationFrame(loop);else sweep();}
onMotionPreferenceChange(()=>{
  if(!reduced())return kick();
  if(raf&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(raf);
  raf=0;
  for(const fx of live)if(fx.visible){fx.resize();fx.step(0,2);}
});

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
// ---------- presets das coleções clássicas (refeitas na Loja v3) ----------
function heart(c,x,y,s,col,a){c.globalAlpha=a;c.fillStyle=col;c.beginPath();c.moveTo(x,y+s*.3);c.bezierCurveTo(x,y,x-s*.5,y-s*.2,x-s*.5,y+s*.25);c.bezierCurveTo(x-s*.5,y+s*.6,x,y+s*.8,x,y+s);c.bezierCurveTo(x,y+s*.8,x+s*.5,y+s*.6,x+s*.5,y+s*.25);c.bezierCurveTo(x+s*.5,y-s*.2,x,y,x,y+s*.3);c.fill();}
function diamond(c,x,y,s,rot,col,a){c.save();c.translate(x,y);c.rotate(rot);c.globalAlpha=a;c.fillStyle=col;c.beginPath();c.moveTo(0,-s);c.lineTo(s*.7,0);c.lineTo(0,s);c.lineTo(-s*.7,0);c.closePath();c.fill();c.globalAlpha=a*.8;c.fillStyle='#fff';c.beginPath();c.moveTo(0,-s);c.lineTo(s*.25,-s*.2);c.lineTo(0,0);c.lineTo(-s*.25,-s*.2);c.closePath();c.fill();c.restore();}
const rays=(c,f,t,col,a,n=7,ox=.5,oy=-.1)=>{c.save();c.translate(f.w*ox,f.h*oy);for(let i=0;i<n;i++){const ang=Math.PI*.15+i*(Math.PI*.7/(n-1))+Math.sin(t*.4+i)*.04;c.rotate(0);const g=c.createLinearGradient(0,0,Math.cos(ang)*f.h*1.4,Math.sin(ang)*f.h*1.4);g.addColorStop(0,col);g.addColorStop(1,'transparent');c.globalAlpha=a*(.5+.5*Math.sin(t*.8+i*1.7));c.fillStyle=g;c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(ang-.05)*f.h*1.4,Math.sin(ang-.05)*f.h*1.4);c.lineTo(Math.cos(ang+.05)*f.h*1.4,Math.sin(ang+.05)*f.h*1.4);c.fill();}c.restore();};
const INV=['00100100','00011000','00111100','01011010','11111111','10100101'];
P.synthgrid={n:[30,14,24],spawn:f=>({vx:0,vy:rnd(-40,-14),s:rnd(1.5,3.5),c:Math.random()<.5?0:1,tw:rnd(0,TAU)}),...drift,from:'bottom',
  draw(c,p,f,t){const a=.4+.6*Math.abs(Math.sin(t*4+p.tw));c.globalAlpha=a;c.fillStyle=f.cols[p.c];c.fillRect(p.x,p.y,p.s,p.s*2.4);glow(c,p.x,p.y,p.s*5,f.cols[p.c],a*.35);},
  bg(c,f,t){const hz=f.h*.62;glow(c,f.w*.5,hz,f.w*.7,f.cols[0],.32);c.globalAlpha=.5;c.strokeStyle=f.cols[1];c.lineWidth=1;for(let i=0;i<10;i++){const k=((i+(t*.8)%1)/10)**2,y=hz+k*(f.h-hz);c.beginPath();c.moveTo(0,y);c.lineTo(f.w,y);c.stroke();}
    for(let i=-9;i<=9;i++){c.beginPath();c.moveTo(f.w/2+i*6,hz);c.lineTo(f.w/2+i*f.w*.16,f.h);c.stroke();}const sy=(t*60)%f.h;c.globalAlpha=.12;c.fillStyle='#fff';c.fillRect(0,sy,f.w,2);
    for(let i=0;i<4;i++){const bx=(i*.27+.05)*f.w,bh=f.h*(.18+.1*((i*7)%3));c.globalAlpha=.55;c.fillStyle='#0a0614';c.fillRect(bx,hz-bh,f.w*.12,bh);for(let j=0;j<5;j++){if(Math.sin(t*2+i*3+j*5)>.2){c.globalAlpha=.8;c.fillStyle=f.cols[(i+j)%2];c.fillRect(bx+3+(j%2)*f.w*.05,hz-bh+4+j*bh/6,f.w*.03,2);}}}},spread:true};
P.sparkle={n:[22,12,18],spawn:f=>({vx:rnd(-8,8),vy:rnd(-8,8),s:rnd(2,5),tw:rnd(0,TAU),h:Math.random()<.5}),...drift,
  draw(c,p,f,t){const a=Math.max(0,Math.sin(t*3+p.tw));star4(c,p.x,p.y,p.s*(.6+a),p.h?'#fff':f.cols[1],a);glow(c,p.x,p.y,p.s*4,f.cols[0],a*.4);},
  bg(c,f,t){c.save();c.translate(f.w/2,f.h/2);for(let i=0;i<22;i++){const ang=i*TAU/22+t*.05,len=f.w*(.35+.3*Math.abs(Math.sin(t*2+i*1.3)));c.globalAlpha=.08+.08*Math.sin(t*3+i);c.strokeStyle='#fff';c.lineWidth=1+i%3;c.beginPath();c.moveTo(Math.cos(ang)*f.w*.25,Math.sin(ang)*f.w*.25);c.lineTo(Math.cos(ang)*len*1.4,Math.sin(ang)*len*1.4);c.stroke();}c.restore();
    for(let i=0;i<5;i++)glow(c,f.w*((i*.23+t*.02)%1),f.h*(.2+.6*((i*.37)%1)),f.w*.12,f.cols[i%2],.18);}};
P.starfield={n:[40,14,24],life:[1.5,3.5],spawn:f=>({ang:rnd(0,TAU),r:rnd(2,20),v:rnd(30,110),s:rnd(.6,1.8)}),
  move(p,dt,f){p.r+=p.v*dt*(1+p.r/60);p.x=f.w/2+Math.cos(p.ang)*p.r;p.y=f.h/2+Math.sin(p.ang)*p.r*.7;},
  draw(c,p,f){const a=Math.min(1,p.r/40);c.globalAlpha=a;c.strokeStyle='#fff';c.lineWidth=p.s;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x-Math.cos(p.ang)*p.r*.08,p.y-Math.sin(p.ang)*p.r*.056);c.stroke();},
  bg(c,f,t){glow(c,f.w*.5,f.h*.5,f.w*.6,f.cols[0],.22);const px=f.w*.78,py=f.h*.3,pr=Math.min(f.w,f.h)*.13;const g=c.createLinearGradient(px-pr,py-pr,px+pr,py+pr);g.addColorStop(0,f.cols[1]);g.addColorStop(1,f.bg);c.globalAlpha=.9;c.fillStyle=g;c.beginPath();c.arc(px,py,pr,0,TAU);c.fill();
    c.save();c.translate(px,py);c.rotate(-.35);c.globalAlpha=.7;c.strokeStyle=f.cols[2];c.lineWidth=2;c.beginPath();c.ellipse(0,0,pr*1.9,pr*.45,0,0,TAU);c.stroke();c.restore();glow(c,px-pr*.4,py-pr*.4,pr*.6,'#fff',.25);}};
P.canopy={n:[18,10,14],spawn:f=>({vx:rnd(-6,6),vy:rnd(14,30),s:rnd(3,6),rot:rnd(0,TAU),vr:rnd(-1.4,1.4),a:rnd(.6,1),tw:rnd(0,TAU),c:Math.random()<.6?0:1}),
  move(p,dt,f,t){p.x+=(p.vx+Math.sin(t*1.3+p.tw)*16)*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;},draw(c,p,f){petal(c,p,f.cols[p.c]);c.save();c.translate(p.x,p.y);c.rotate(p.rot);c.globalAlpha=p.a*.5;c.strokeStyle='#0b2a17';c.lineWidth=.6;c.beginPath();c.moveTo(0,-p.s);c.lineTo(0,p.s);c.stroke();c.restore();},
  bg(c,f,t){for(let i=0;i<2;i++){c.globalAlpha=.22;const g=c.createLinearGradient(0,0,f.w,0);g.addColorStop(0,'transparent');g.addColorStop(.5,f.cols[i]);g.addColorStop(1,'transparent');c.fillStyle=g;c.beginPath();c.moveTo(0,f.h*(.2+i*.1));for(let x=0;x<=f.w;x+=8)c.lineTo(x,f.h*(.2+i*.1)+Math.sin(x/30+t*(.6+i*.3))*10);c.lineTo(f.w,0);c.lineTo(0,0);c.fill();}rays(c,f,t,'rgba(255,250,200,.5)',.22,6,.3,-.2);},from:'top'};
P.pumpkin={n:[22,12,18],life:[2,4],spawn:f=>({vx:rnd(-8,8),vy:rnd(-50,-20),s:rnd(1,2.6),ghost:Math.random()<.12,tw:rnd(0,TAU)}),...drift,from:'bottom',
  draw(c,p,f,t){if(p.ghost){const a=.25*Math.sin(Math.PI*p.life/p.max);c.globalAlpha=a;c.fillStyle='#e9e4ff';c.beginPath();c.arc(p.x,p.y,7,Math.PI,0);c.lineTo(p.x+7,p.y+9);for(let i=0;i<4;i++)c.lineTo(p.x+7-i*3.5-1.75,p.y+9-(i%2?0:3));c.lineTo(p.x-7,p.y+9);c.fill();c.globalAlpha=a*2;c.fillStyle='#120714';c.fillRect(p.x-3,p.y-2,1.6,2);c.fillRect(p.x+1.5,p.y-2,1.6,2);return;}
    const a=1-p.life/p.max;glow(c,p.x,p.y,p.s*5,f.cols[0],a*.7);c.globalAlpha=a;c.fillStyle='#ffd27a';c.fillRect(p.x,p.y,p.s,p.s);},
  bg(c,f,t){const fl=.8+.2*Math.sin(t*9)*Math.sin(t*3.3);for(const [x,s] of [[.18,.12],[.82,.1]]){const px=f.w*x,py=f.h*.9,r=Math.min(f.w,f.h)*s;glow(c,px,py,r*3,f.cols[0],.35*fl);c.globalAlpha=.95;c.fillStyle='#e8661a';c.beginPath();c.ellipse(px,py,r,r*.8,0,0,TAU);c.fill();c.globalAlpha=fl;c.fillStyle='#ffd65a';c.beginPath();c.moveTo(px-r*.5,py-r*.15);c.lineTo(px-r*.25,py-r*.4);c.lineTo(px-r*.1,py-r*.15);c.moveTo(px+r*.1,py-r*.15);c.lineTo(px+r*.25,py-r*.4);c.lineTo(px+r*.5,py-r*.15);c.fill();c.fillRect(px-r*.45,py+r*.15,r*.9,r*.15);}
    glow(c,f.w*.5,f.h*.1,f.w*.5,f.cols[1],.25);}};
P.lofi={n:[26,10,18],spawn:f=>({vx:-6,vy:rnd(70,120),s:rnd(6,14),bok:Math.random()<.25,r:rnd(6,16),tw:rnd(0,TAU)}),
  move(p,dt,f,t){if(p.bok){p.x+=Math.sin(t*.3+p.tw)*4*dt;return;}p.x+=p.vx*dt;p.y+=p.vy*dt;},
  draw(c,p,f,t){if(p.bok){glow(c,p.x,p.y,p.r,f.cols[(p.tw*10|0)%2],.25+.15*Math.sin(t+p.tw));return;}c.globalAlpha=.35;c.strokeStyle='#cfe0ff';c.lineWidth=1;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x+1,p.y-p.s);c.stroke();},
  bg(c,f,t){const g=c.createLinearGradient(0,0,0,f.h);g.addColorStop(0,f.cols[1]+'55');g.addColorStop(1,f.cols[0]+'44');c.globalAlpha=1;c.fillStyle=g;c.fillRect(0,0,f.w,f.h);c.globalAlpha=.35;c.strokeStyle='#1a1424';c.lineWidth=3;c.strokeRect(f.w*.08,f.h*.1,f.w*.84,f.h*.8);c.beginPath();c.moveTo(f.w*.5,f.h*.1);c.lineTo(f.w*.5,f.h*.9);c.moveTo(f.w*.08,f.h*.5);c.lineTo(f.w*.92,f.h*.5);c.stroke();glow(c,f.w*.85,f.h*.15,f.w*.25,'#ffd9a0',.3+.05*Math.sin(t));}};
P.invaders={n:[10,6,10],spawn:f=>({vx:rnd(12,26)*(Math.random()<.5?-1:1),vy:rnd(-4,4),s:rnd(1.6,2.6),c:Math.random()*3|0,tw:rnd(0,TAU)}),...drift,
  draw(c,p,f,t){c.globalAlpha=.9;c.fillStyle=f.cols[p.c%f.cols.length];const fr=(t*2+p.tw|0)%2;for(let r=0;r<INV.length;r++){const row=fr&&r===5?'01000010':INV[r];for(let k=0;k<8;k++)if(row[k]==='1')c.fillRect(p.x+k*p.s-4*p.s,p.y+r*p.s-3*p.s,p.s,p.s);}},
  bg(c,f,t){for(let i=0;i<24;i++){const x=(i*53.7%1)*f.w||((i*97)%f.w),y=((i*31+t*20*(1+i%3))%f.h);c.globalAlpha=.5;c.fillStyle='#fff';c.fillRect((i*71)%f.w,y,2,2);}c.globalAlpha=.08;c.fillStyle='#000';for(let y=0;y<f.h;y+=3)c.fillRect(0,y,f.w,1);c.globalAlpha=.9;c.fillStyle=f.cols[1];c.fillRect(f.w/2+Math.sin(t*1.5)*f.w*.3-8,f.h-10,16,5);c.fillRect(f.w/2+Math.sin(t*1.5)*f.w*.3-2,f.h-14,4,4);}};
P.jelly={n:[7,5,8],spawn:f=>({vx:rnd(-4,4),vy:rnd(-14,-6),s:rnd(6,12),tw:rnd(0,TAU),c:Math.random()<.5?0:1}),
  move(p,dt,f,t){const pulse=Math.max(0,Math.sin(t*2+p.tw));p.x+=p.vx*dt;p.y+=p.vy*dt*(1+pulse*2);},from:'bottom',life:[6,10],
  draw(c,p,f,t){const k=.8+.2*Math.sin(t*2+p.tw);glow(c,p.x,p.y,p.s*3,f.cols[p.c],.35);c.globalAlpha=.55;c.fillStyle=f.cols[p.c];c.beginPath();c.ellipse(p.x,p.y,p.s*k,p.s*.7/k,0,Math.PI,0);c.fill();c.globalAlpha=.45;c.strokeStyle=f.cols[2]||'#fff';c.lineWidth=1;for(let i=-2;i<=2;i++){c.beginPath();c.moveTo(p.x+i*p.s*.3,p.y);for(let j=1;j<5;j++)c.lineTo(p.x+i*p.s*.3+Math.sin(t*3+j+i)*2,p.y+j*p.s*.4);c.stroke();}},
  bg(c,f,t){for(let i=0;i<6;i++){c.globalAlpha=.08;c.strokeStyle='#bff';c.lineWidth=2;c.beginPath();for(let x=0;x<=f.w;x+=10)c.lineTo(x,f.h*(i/6)+Math.sin(x/25+t*(1+i*.2)+i)*6+Math.cos(x/13-t)*3);c.stroke();}rays(c,f,t,'rgba(160,240,255,.5)',.2,5,.5,-.3);}};
P.rgbglitch={n:[18,10,16],life:[.2,.8],spawn:f=>({vx:0,vy:0,s:rnd(2,30),h:rnd(1,4),c:Math.random()*2|0}),move(){},
  draw(c,p,f){c.globalAlpha=.7;c.fillStyle=f.cols[p.c];c.fillRect(p.x,p.y,p.s,p.h);},
  bg(c,f,t){const on=Math.sin(t*5)>.6||Math.sin(t*1.7)>.95;if(on){for(let i=0;i<5;i++){const y=rnd(0,f.h),h=rnd(3,14),dx=rnd(-14,14);c.globalAlpha=.25;c.fillStyle=f.cols[0];c.fillRect(dx,y,f.w,h);c.fillStyle=f.cols[1];c.fillRect(-dx,y+2,f.w,h);}}c.globalAlpha=.06;c.fillStyle='#fff';for(let y=(t*40)%4;y<f.h;y+=4)c.fillRect(0,y,f.w,1);glow(c,f.w*.3,f.h*.5,f.w*.4,f.cols[0],.15);glow(c,f.w*.7,f.h*.5,f.w*.4,f.cols[1],.15);}};
P.constel={n:[14,10,14],spawn:f=>({vx:rnd(-5,5),vy:rnd(-5,5),s:rnd(1,2.2),tw:rnd(0,TAU)}),...drift,
  draw(c,p,f,t){for(const q of f.parts){if(q===p||q.x<p.x)continue;const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<f.w*.28){c.globalAlpha=(1-d/(f.w*.28))*.35;c.strokeStyle=f.cols[0];c.lineWidth=.7;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.stroke();}}const a=.5+.5*Math.sin(t*2+p.tw);star4(c,p.x,p.y,p.s*2.4,'#fff',a);glow(c,p.x,p.y,p.s*6,f.cols[0],a*.4);},
  bg(c,f,t){glow(c,f.w*.5,f.h*.5,f.w*.55,f.cols[2]||f.cols[0],.22+.06*Math.sin(t*1.5));c.globalAlpha=.25;c.strokeStyle='#fff';c.lineWidth=1;c.beginPath();c.ellipse(f.w/2,f.h/2,f.w*.4,f.h*.18,Math.sin(t*.2)*.3,0,TAU);c.stroke();}};
P.divine={n:[18,10,16],spawn:f=>({vx:rnd(-6,6),vy:rnd(8,20),s:rnd(3,6),rot:rnd(0,TAU),vr:rnd(-.8,.8),a:rnd(.5,.9),mote:Math.random()<.5,tw:rnd(0,TAU)}),
  move(p,dt,f,t){if(p.mote){p.y-=10*dt;p.x+=Math.sin(t+p.tw)*6*dt;}else{p.x+=(p.vx+Math.sin(t*1.5+p.tw)*12)*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;}},
  draw(c,p,f,t){if(p.mote){const a=.5+.5*Math.sin(t*3+p.tw);glow(c,p.x,p.y,p.s*2,f.cols[0],a*.6);return;}c.save();c.translate(p.x,p.y);c.rotate(p.rot);c.globalAlpha=p.a;c.fillStyle='#fffaf0';c.beginPath();c.ellipse(0,0,p.s*.45,p.s*1.6,0,0,TAU);c.fill();c.strokeStyle='#e8d9a8';c.lineWidth=.6;c.beginPath();c.moveTo(0,-p.s*1.6);c.lineTo(0,p.s*1.6);c.stroke();c.restore();},
  bg(c,f,t){rays(c,f,t,'rgba(255,240,190,.7)',.35,9,.5,-.15);glow(c,f.w*.5,0,f.w*.5,f.cols[0],.35);c.globalAlpha=.6;c.strokeStyle=f.cols[0];c.lineWidth=2;c.beginPath();c.ellipse(f.w*.5,f.h*.12,f.w*.12,f.h*.035,0,0,TAU);c.stroke();}};
P.shadow={n:[18,10,16],life:[2,5],spawn:f=>({vx:rnd(-6,6),vy:rnd(-22,-8),s:rnd(6,16),eye:Math.random()<.12,tw:rnd(0,TAU)}),...drift,from:'bottom',
  draw(c,p,f,t){const k=Math.sin(Math.PI*p.life/p.max);if(p.eye){const blink=Math.sin(t*1.3+p.tw)>.92?.1:1;c.globalAlpha=k;glow(c,p.x-4,p.y,5,f.cols[1],.8);glow(c,p.x+4,p.y,5,f.cols[1],.8);c.fillStyle=f.cols[1];c.fillRect(p.x-5,p.y-1*blink,3,2*blink);c.fillRect(p.x+3,p.y-1*blink,3,2*blink);return;}glow(c,p.x,p.y,p.s*2.2,f.cols[0],k*.35);},
  bg(c,f,t){c.globalAlpha=.5;c.strokeStyle=f.cols[2]||'#3a0a14';c.lineWidth=1.4;for(let i=0;i<5;i++){const x0=i*f.w/4;c.beginPath();c.moveTo(x0,f.h);for(let j=1;j<6;j++)c.lineTo(x0+Math.sin(j*1.7+i+t*.2)*14,f.h-j*f.h*.09);c.stroke();}glow(c,f.w*.5,f.h*1.05,f.w*.7,f.cols[1],.22+.05*Math.sin(t*2));}};
P.winter={n:[28,12,20],spawn:f=>{const z=Math.random();return {vx:rnd(-6,6),vy:10+z*36,s:1+z*3,rot:rnd(0,TAU),vr:rnd(-.6,.6),a:.4+z*.6,tw:rnd(0,TAU)};},
  move(p,dt,f,t){p.x+=(p.vx+Math.sin(t+p.tw)*8)*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;},draw(c,p,f){p.s>2.8?flake(c,p,'#eaf6ff'):(c.globalAlpha=p.a,c.fillStyle='#fff',c.beginPath(),c.arc(p.x,p.y,p.s*.6,0,TAU),c.fill());},from:'top',
  bg(c,f,t){c.globalAlpha=.5;c.strokeStyle='#1d3a2a';c.lineWidth=1.2;c.beginPath();c.moveTo(0,8);for(let x=0;x<=f.w;x+=6)c.lineTo(x,8+Math.sin(x/f.w*Math.PI*3)*6+6);c.stroke();const n=Math.max(6,f.w/26|0);for(let i=0;i<n;i++){const x=(i+.5)*f.w/n,y=14+Math.sin(x/f.w*Math.PI*3)*6+4,on=Math.sin(t*3+i*1.9)>-.2;glow(c,x,y,on?9:4,f.cols[i%3],on?.9:.3);}glow(c,f.w*.5,f.h*1.1,f.w*.6,'#ffcf8a',.2);}};
P.hearts={n:[16,10,14],spawn:f=>({vx:rnd(-6,6),vy:rnd(-30,-12),s:rnd(5,11),tw:rnd(0,TAU),c:Math.random()*3|0,bub:Math.random()<.3}),...drift,from:'bottom',
  draw(c,p,f,t){const x=p.x+Math.sin(t*2+p.tw)*4;if(p.bub){bubble(c,{x,y:p.y,s:p.s*.6,a:.6},`hsl(${(p.tw*60+t*60)%360} 90% 75%)`);return;}heart(c,x,p.y,p.s,f.cols[p.c%f.cols.length],.75);glow(c,x,p.y+p.s*.4,p.s*1.6,f.cols[p.c%f.cols.length],.3);},
  bg(c,f,t){for(let i=0;i<3;i++)glow(c,f.w*(.2+i*.3),f.h*(.5+.25*Math.sin(t*.5+i)),f.w*.35,f.cols[i],.2);}};
P.jewel={n:[12,8,12],spawn:f=>({vx:rnd(-4,4),vy:rnd(-6,6),s:rnd(3,7),rot:rnd(0,TAU),vr:rnd(-.8,.8),tw:rnd(0,TAU),c:Math.random()*3|0}),...drift,
  draw(c,p,f,t){const a=.55+.45*Math.sin(t*2+p.tw);diamond(c,p.x,p.y,p.s,p.rot,f.cols[p.c%f.cols.length],a);if(a>.9)star4(c,p.x+p.s*.3,p.y-p.s*.6,p.s*.9,'#fff',(a-.9)*10);},
  bg(c,f,t){c.globalAlpha=.4;c.strokeStyle=f.cols[0];c.lineWidth=1;for(let i=0;i<4;i++){c.beginPath();c.moveTo(0,f.h*(.2+i*.22));for(let x=0;x<=f.w;x+=12)c.lineTo(x,f.h*(.2+i*.22)+Math.sin(x/20+i*2)*8+Math.cos(x/9+i)*3);c.stroke();}
    const x=((t*.3)%2.2)*f.w-f.w*.3;const g=c.createLinearGradient(x-70,0,x+70,f.h);g.addColorStop(0,'transparent');g.addColorStop(.5,'rgba(255,255,255,.2)');g.addColorStop(1,'transparent');c.globalAlpha=1;c.fillStyle=g;c.fillRect(0,0,f.w,f.h);}};
P.lotus={n:[14,8,12],life:[4,8],spawn:f=>({vx:rnd(-4,4),vy:rnd(-18,-8),s:rnd(3,5),tw:rnd(0,TAU)}),...drift,from:'bottom',
  draw(c,p,f,t){const a=Math.sin(Math.PI*p.life/p.max);glow(c,p.x,p.y,p.s*4,f.cols[0],a*.45);c.globalAlpha=a*.9;c.fillStyle=f.cols[0];c.fillRect(p.x-p.s*.5,p.y-p.s*.7,p.s,p.s*1.4);c.fillStyle='#fff3c4';c.globalAlpha=a*.6;c.fillRect(p.x-p.s*.25,p.y-p.s*.3,p.s*.5,p.s*.6);},
  bg(c,f,t){glow(c,f.w*.75,f.h*.25,f.w*.25,'#fff6d8',.35);c.globalAlpha=.85;c.fillStyle='#fff6e0';c.beginPath();c.arc(f.w*.75,f.h*.25,Math.min(f.w,f.h)*.08,0,TAU);c.fill();
    for(let i=0;i<3;i++){const k=((t*.25+i/3)%1);c.globalAlpha=(1-k)*.4;c.strokeStyle=f.cols[1];c.lineWidth=1;c.beginPath();c.ellipse(f.w*.5,f.h*.85,k*f.w*.45,k*f.h*.08,0,0,TAU);c.stroke();}
    c.save();c.translate(f.w*.5,f.h*.85);c.globalAlpha=.8;for(let i=-2;i<=2;i++){c.save();c.rotate(i*.35);c.fillStyle=i%2?f.cols[1]:f.cols[2]||f.cols[1];c.beginPath();c.ellipse(0,-8,4,10,0,0,TAU);c.fill();c.restore();}c.restore();}};
for(const k of ['stars','particles','glitch','aurora2'])P[k]=P[k]||P.nebula;

// ---------- instância ----------
// mode: 'effect' (área toda), 'hero' (área toda, mais partículas), 'frame' (anel do avatar), 'border' (contorno do cartão).
export function mountFx(host,{preset='nebula',colors=['#9b7bff','#ff7ad9','#7fe3ff'],bg='#0d0a22',mode='effect',radius=16,density=1}={}){
  const def=P[preset]||P.nebula;const canvas=document.createElement('canvas');canvas.className='fx-canvas fx-'+mode;canvas.setAttribute('aria-hidden','true');host.append(canvas);
  const c=canvas.getContext('2d');const fx={density:Math.max(.2,Math.min(4,+density||1)),canvas,visible:false,w:0,h:0,cols:colors,bg,parts:[],mode,def,
    resize(){const r=canvas.getBoundingClientRect(),d=Math.min(1.5,devicePixelRatio||1);if(!r.width||!r.height)return;if(Math.abs(r.width-fx.w)<1&&Math.abs(r.height-fx.h)<1)return;fx.w=r.width;fx.h=r.height;canvas.width=r.width*d|0;canvas.height=r.height*d|0;c.setTransform(d,0,0,d,0,0);fx.seed();},
    seed(){const n=def.n[mode==='frame'?1:mode==='border'?2:0]*(mode==='hero'?1.6:1)*fx.density*(fx.w*fx.h<9000?.6:1)|0;fx.parts=[];for(let i=0;i<n;i++)fx.parts.push(fx.spawn(true));},
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
  if(io)io.observe(canvas);else{fx.visible=true;kick();}
  if(reduced())requestAnimationFrame(()=>{if(!canvas.isConnected)return;fx.resize();fx.step(0,2);});
  return fx;
}
export function destroyFxIn(node){node?.querySelectorAll?.('canvas.fx-canvas').forEach(cv=>cv.__fx?.destroy());}
