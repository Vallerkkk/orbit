// Palco da chamada: escolhe o destaque (Ouvir juntos ou tela assistida) e trata tela cheia por toque duplo.
export function pickStage(tiles){const pin=tiles.findIndex(t=>t.pinned);if(pin>=0)return pin;const i=tiles.findIndex(t=>t.kind==='watch');if(i>=0)return i;return tiles.findIndex(t=>t.kind==='screen');}
export function tileKind(node){if(node.classList.contains('watch-tile'))return 'watch';if(node.classList.contains('screen-placeholder'))return 'placeholder';if(node.classList.contains('media-screen'))return 'screen';if(node.classList.contains('media-tile'))return 'camera';return 'avatar';}
// Dois toques em até 320 ms e a menos de 32 px contam como toque duplo.
export function isDoubleTap(prev,cur,{time=320,distance=32}={}){if(!prev||!cur||prev.target!==cur.target)return false;const dt=cur.t-prev.t;return dt>0&&dt<=time&&Math.hypot(cur.x-prev.x,cur.y-prev.y)<=distance;}
export function fullscreenElement(doc=document){return doc.fullscreenElement||doc.webkitFullscreenElement||doc.querySelector('.pseudo-fullscreen');}
// iOS Safari não tem requestFullscreen em elementos: usa tela cheia simulada (position:fixed) mantendo nossos controles.
export async function toggleFullscreen(node,doc=document){const current=fullscreenElement(doc);
  if(current){if(current.classList?.contains('pseudo-fullscreen')){current.classList.remove('pseudo-fullscreen');doc.documentElement.classList.remove('has-pseudo-fullscreen');}else if(doc.exitFullscreen)await doc.exitFullscreen();else doc.webkitExitFullscreen?.();if(current===node)return false;}
  if(node.requestFullscreen){try{await node.requestFullscreen();return true;}catch{}}
  else if(node.webkitRequestFullscreen){node.webkitRequestFullscreen();return true;}
  node.classList.add('pseudo-fullscreen');doc.documentElement.classList.add('has-pseudo-fullscreen');return true;}
