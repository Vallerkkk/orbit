// Compartilhamento de tela: detecção de suporte, restrições de captura e mensagens de erro (puro, testado em node).
export const SCREEN_UNSUPPORTED='Seu navegador não permite compartilhar a tela';
export function isMobileUA(ua=''){return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);}
export function isIOS(ua='',touchPoints=0){return /iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&touchPoints>1);}
// iOS (Safari e todos os outros, que usam WebKit) não tem getDisplayMedia; no Android depende da versão do Chrome.
export function screenSupport(nav=globalThis.navigator){const ua=nav?.userAgent||'',has=typeof nav?.mediaDevices?.getDisplayMedia==='function';
  if(isIOS(ua,nav?.maxTouchPoints||0))return {supported:false,mobile:true,reason:SCREEN_UNSUPPORTED+' (iPhone/iPad não oferecem isso para sites).'};
  if(!has)return {supported:false,mobile:isMobileUA(ua),reason:SCREEN_UNSUPPORTED+'.'};
  return {supported:true,mobile:isMobileUA(ua),reason:''};}
// Áudio da tela é opt-in. Quando ligado, nunca inclui o áudio desta aba (as vozes da chamada): restrictOwnAudio,
// systemAudio:'exclude' (sem "áudio do sistema" da tela inteira, que pegaria as vozes) e selfBrowserSurface:'exclude'.
export function screenCaptureOptions({mobile=false,audio=false,resolution={width:1920,height:1080,frameRate:30}}={}){
  if(mobile)return {audio:false,video:true,resolution:{width:1280,height:720,frameRate:15}};
  const o={resolution,contentHint:'detail',surfaceSwitching:'include',selfBrowserSurface:'exclude',systemAudio:'exclude',audio:false};
  if(audio){o.audio={restrictOwnAudio:true,suppressLocalAudioPlayback:false,echoCancellation:false,noiseSuppression:false,autoGainControl:false};o.suppressLocalAudioPlayback=false;}
  return o;}
export function screenErrorText(error,mobile=false){const n=error?.name||'';
  if(n==='NotAllowedError'||n==='AbortError')return 'Compartilhamento cancelado ou bloqueado. Autorize a captura de tela'+(mobile?' (no Android, toque em “Iniciar agora”).':'.');
  if(n==='NotSupportedError'||n==='TypeError'||n==='NotFoundError')return SCREEN_UNSUPPORTED+(mobile?' neste celular. Atualize o Chrome ou use um computador.':'.');
  if(n==='NotReadableError')return 'O sistema impediu a captura da tela. Feche outros apps que gravam a tela e tente de novo.';
  return error?.message||'Não foi possível compartilhar a tela.';}
