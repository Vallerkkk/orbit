// Only uploaded clips use this controller; call tracks and YouTube stay independent.
const clips=new Map();
let visibilityObserver,removalObserver,soundBlocked=false,armed=false,gestureAt=0;
const RATIO=0.55;
function armUnmute(){if(armed)return;armed=true;const go=()=>{armed=false;gestureAt=Date.now();soundBlocked=false;for(const [video,record] of clips)if(video.dataset.sound==='1'&&!record.userMuted&&visible(video,record)){record.quiet=true;video.muted=false;record.quiet=false;}for(const t of ['pointerdown','keydown','touchstart'])document.removeEventListener(t,go,true);};for(const t of ['pointerdown','keydown','touchstart'])document.addEventListener(t,go,{capture:true,passive:true});}

function visible(video,record){
  return !record.disposed&&record.visible&&video.isConnected&&!document.hidden;
}
function pause(video,record){
  if(!video.paused){record.autoPause=true;video.pause();}
}
function start(video,record){
  if(!visible(video,record)||record.manualPause||record.pending||!video.paused||video.ended)return;
  // Sem fonte ainda (URL assinada chega depois): espera loadedmetadata/canplay para tentar de novo.
  if(!video.currentSrc&&!video.getAttribute('src'))return;
  record.pending=true;
  const done=()=>{if(!visible(video,record)||record.manualPause)pause(video,record);};
  const playMuted=()=>{record.quiet=true;video.muted=true;return Promise.resolve(video.play()).then(()=>{done();if(video.dataset.sound==='1'&&!record.userMuted)armUnmute();});};
  const finish=()=>{record.pending=false;setTimeout(()=>{record.quiet=false;},0);};
  try{
    const wantSound=video.dataset.sound==='1'&&!record.userMuted&&!soundBlocked;
    record.quiet=true;video.muted=!wantSound;
    Promise.resolve(video.play()).then(done).catch(err=>{
      if(err?.name==='AbortError')return; // fonte trocada; canplay tenta de novo
      if(!video.muted){soundBlocked=true;return playMuted();} // som bloqueado: toca mudo já
      throw err;
    }).catch(()=>{}).finally(finish);
  }catch{finish();}
}
async function enlarge(video){
  if(video.requestFullscreen){try{await video.requestFullscreen();return;}catch{}}
  if(video.webkitEnterFullscreen){try{video.webkitEnterFullscreen();return;}catch{}}
  const dialog=document.createElement('dialog'),close=document.createElement('button'),large=video.cloneNode(true);
  close.type='button';close.textContent='Fechar vídeo';dialog.className='video-lightbox';dialog.setAttribute('aria-label','Vídeo ampliado');
  large.removeAttribute('id');large.controls=true;large.muted=video.muted;large.currentTime=video.currentTime;
  const sink=localStorage.getItem('orbita-audio-output');if(sink&&large.setSinkId)large.setSinkId(sink).catch(()=>{});
  const playing=!video.paused;video.pause();dialog.append(close,large);document.body.append(dialog);
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{video.currentTime=large.currentTime;large.pause();dialog.remove();if(playing&&video.isConnected)video.play().catch(()=>{});},{once:true});dialog.showModal();if(playing)large.play().catch(()=>{});close.focus();
}
function expandButton(video,record){if(record.expand||!video.isConnected)return;const button=document.createElement('button');button.type='button';button.className='soft-button video-enlarge';button.textContent='Ampliar vídeo';button.setAttribute('aria-label','Ampliar vídeo em tela cheia');button.onclick=()=>enlarge(video);video.after(button);record.expand=button;}
function release(video,record){
  record.expand?.remove();record.disposed=true;visibilityObserver?.unobserve(video);clips.delete(video);
  for(const [name,handler] of record.events)video.removeEventListener(name,handler);
  video.pause();video.removeAttribute('src');video.load();
}
function init(){
  if(removalObserver)return;
  if('IntersectionObserver' in window)visibilityObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){const record=clips.get(entry.target);if(!record)continue;
      record.visible=entry.isIntersecting&&entry.intersectionRatio>=RATIO;
      if(record.visible)start(entry.target,record);else pause(entry.target,record);
    }
  },{threshold:[0,RATIO,0.8]});
  removalObserver=new MutationObserver(()=>{
    for(const [video,record] of clips)if(!video.isConnected)release(video,record);
  });
  removalObserver.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{
    for(const [video,record] of clips){if(document.hidden)pause(video,record);else start(video,record);}
  });
  window.addEventListener('pagehide',()=>{for(const [video,record] of clips)pause(video,record);});
  window.addEventListener('pageshow',()=>{for(const [video,record] of clips)start(video,record);});
}

export function watchUploadedVideo(video){
  if(clips.has(video))return video;
  init();video.classList.add('uploaded-video');video.controls=true;video.playsInline=true;
  video.defaultMuted=false;video.muted=true;video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.preload='metadata';
  const output=localStorage.getItem('orbita-audio-output');if(output&&video.setSinkId)video.setSinkId(output).catch(()=>{});
  // Calling play only for visible clips avoids background downloads and playback.
  const record={quiet:true,userMuted:false,visible:!visibilityObserver,manualPause:false,autoPause:false,pending:false,disposed:false,events:[]};
  record.events=[
    ['loadeddata',()=>{expandButton(video,record);start(video,record);}],
    ['loadedmetadata',()=>start(video,record)],
    ['canplay',()=>start(video,record)],
    ['play',()=>{record.manualPause=false;if(!visible(video,record))pause(video,record);}],
    ['volumechange',()=>{if(!record.quiet&&!record.pending&&navigator.userActivation?.isActive!==false)record.userMuted=video.muted;}],
    ['pause',()=>{if(record.autoPause)record.autoPause=false;else if(Date.now()-gestureAt<600&&visible(video,record)){record.quiet=true;video.muted=false;video.play().catch(()=>{}).finally(()=>{record.quiet=false;});}else if(visible(video,record)&&video.getClientRects().length)record.manualPause=true;}],
  ];
  setTimeout(()=>{if(!record.pending)record.quiet=false;},0);clips.set(video,record);for(const [name,handler] of record.events)video.addEventListener(name,handler);
  if(visibilityObserver)visibilityObserver.observe(video);
  return video;
}

export async function setUploadedVideoOutput(id){
  await Promise.all([...clips.keys()].filter(video=>typeof video.setSinkId==='function').map(video=>video.setSinkId(id||'')));
}
