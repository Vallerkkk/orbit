// Passo de recorte (foto/banner): arrastar para posicionar, zoom, máscara redonda no avatar, proporção do banner.
// Devolve um File recortado (canvas) ou null se cancelar. GIFs não passam por aqui (preserva animação).
export function cropImage(file,{kind='avatar',host=document.body}={}){return new Promise(resolve=>{
  const banner=kind==='banner',W=banner?960:512,H=banner?384:512,VW=banner?420:280,VH=VW*H/W;
  const url=URL.createObjectURL(file),img=new Image();
  const back=document.createElement('div');back.className='crop-overlay';back.innerHTML=`<div class="crop-box" role="dialog" aria-modal="true" aria-label="Ajustar ${banner?'banner':'foto'}"><h3>Ajustar ${banner?'banner':'foto do perfil'}</h3><div class="crop-view${banner?'':' round'}" style="width:${VW}px;height:${VH}px"><img alt="" draggable="false"></div><label class="crop-zoom">Zoom <input type="range" min="1" max="4" step="0.01" value="1"></label><p class="muted">Arraste a imagem para posicionar.</p><div class="crop-actions"><button type="button" class="crop-cancel">Cancelar</button><button type="button" class="crop-ok">Aplicar</button></div></div>`;
  const view=back.querySelector('.crop-view'),pic=back.querySelector('img'),zoom=back.querySelector('input');
  let base=1,z=1,x=0,y=0;
  const clamp=()=>{const w=img.naturalWidth*base*z,h=img.naturalHeight*base*z;x=Math.min(0,Math.max(VW-w,x));y=Math.min(0,Math.max(VH-h,y));};
  const draw=()=>{clamp();pic.style.width=img.naturalWidth*base*z+'px';pic.style.transform=`translate(${x}px,${y}px)`;};
  const done=v=>{URL.revokeObjectURL(url);back.remove();document.removeEventListener('keydown',key,true);resolve(v);};
  const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(null);}};document.addEventListener('keydown',key,true);
  img.onload=()=>{base=Math.max(VW/img.naturalWidth,VH/img.naturalHeight);x=(VW-img.naturalWidth*base)/2;y=(VH-img.naturalHeight*base)/2;pic.src=url;draw();};
  img.onerror=()=>done(file);img.src=url;
  zoom.oninput=()=>{const cx=VW/2,cy=VH/2,nz=Number(zoom.value);x=cx-(cx-x)*nz/z;y=cy-(cy-y)*nz/z;z=nz;draw();};
  view.addEventListener('wheel',e=>{e.preventDefault();zoom.value=Math.min(4,Math.max(1,z-e.deltaY*0.002));zoom.oninput();},{passive:false});
  let drag=null;view.addEventListener('pointerdown',e=>{drag={sx:e.clientX-x,sy:e.clientY-y};view.setPointerCapture(e.pointerId);});
  view.addEventListener('pointermove',e=>{if(!drag)return;x=e.clientX-drag.sx;y=e.clientY-drag.sy;draw();});
  view.addEventListener('pointerup',()=>drag=null);view.addEventListener('pointercancel',()=>drag=null);
  back.querySelector('.crop-cancel').onclick=()=>done(null);
  back.querySelector('.crop-ok').onclick=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;const s=base*z,r=W/VW;
    c.getContext('2d').drawImage(img,-x/s,-y/s,VW/s,VH/s,0,0,W,H);void r;
    const type=file.type==='image/png'?'image/png':'image/webp';c.toBlob(b=>done(b?new File([b],(file.name||kind).replace(/\.\w+$/,'')+(type==='image/png'?'.png':'.webp'),{type}):file),type,0.92);};
  host.append(back);back.querySelector('.crop-ok').focus();});}
