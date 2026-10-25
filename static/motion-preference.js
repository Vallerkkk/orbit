// Preferência de movimento única do app: SO (prefers-reduced-motion) ou ajuste "Reduzir animações".
// Leitura preguiçosa e com guardas para módulos que também carregam fora do navegador (testes Node).
const QUERY='(prefers-reduced-motion: reduce)';
function media(){return typeof matchMedia==='function'?matchMedia(QUERY):null;}
function osReduced(){return media()?.matches===true;}
function appReduced(){try{return localStorage.getItem('orbita-reduce-motion')==='true';}catch{return false;}}
export function prefersReducedMotion(){return osReduced()||appReduced();}
export function onMotionPreferenceChange(callback){
  const list=media(),hasWindow=typeof window!=='undefined';
  list?.addEventListener?.('change',callback);
  if(hasWindow)window.addEventListener('orbita:motion-changed',callback);
  return()=>{list?.removeEventListener?.('change',callback);if(hasWindow)window.removeEventListener('orbita:motion-changed',callback);};
}
