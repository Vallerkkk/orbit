// These helpers never upload data; image conversion happens on the device.
export async function compressImage(file, kind = 'attachment') {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (file.size > 25 * 1024 * 1024) throw Error('A imagem deve ter até 25 MB.');
  if (file.type === 'image/webp') {
    const header = new TextDecoder('latin1').decode(await file.slice(0, 4096).arrayBuffer());
    if (header.includes('ANIM')) return file; // Preserve animated banners/stickers.
  }
  const max = { avatar: 512, banner: 1600, attachment: 1920 }[kind] || 1920;
  const budget = { avatar: 300_000, banner: 500_000, attachment: 1_000_000 }[kind] || 1_000_000;
  let source, objectUrl;
  try {
    if (typeof createImageBitmap === 'function') source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    else { objectUrl = URL.createObjectURL(file); source = new Image(); source.src = objectUrl; await source.decode(); }
    const width = source.width || source.naturalWidth, height = source.height || source.naturalHeight;
    if (!width || !height || width * height > 80_000_000) throw Error('Esta imagem é grande demais para processar no dispositivo.');
    // Avatares: recorte quadrado centralizado em 512px (nítido em telas 2x/3x e sem distorcer retratos/paisagens).
    const side = Math.min(width, height), square = kind === 'avatar';
    const sw = square ? side : width, sh = square ? side : height, sx = square ? (width - side) / 2 : 0, sy = square ? (height - side) / 2 : 0;
    const ratio = Math.min(1, max / Math.max(sw, sh));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sw * ratio)); canvas.height = Math.max(1, Math.round(sh * ratio));
    const context = canvas.getContext('2d'); if (!context) return file;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    let blob;
    for (const quality of (kind === 'avatar' ? [0.92, 0.86, 0.8] : [0.85, 0.72, 0.58])) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.size <= budget) break;
    }
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: blob.type, lastModified: file.lastModified });
  } finally { source?.close?.(); if (objectUrl) URL.revokeObjectURL(objectUrl); }
}

const formatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function relativeTime(value, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  if (!Number.isFinite(seconds)) return '';
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, 'second');
}

function youtubeURL(value) {
  const text=String(value||'').trim();
  const url=new URL(/^(?:(?:www|m|music)\.)?youtube\.com\/|^youtu\.be\//i.test(text)?'https://'+text:text);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
  return url;
}
export function youtubeId(value) {
  try {
    const url=youtubeURL(value);if(!url)return null;let id;
    if(url.hostname==='youtu.be')id=url.pathname.split('/')[1];
    else if(['www.youtube.com','youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname))id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];
    else if(['www.youtube-nocookie.com','youtube-nocookie.com'].includes(url.hostname))id=url.pathname.match(/^\/embed\/([^/]+)\/?$/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:null;
  }catch{return null;}
}
export function youtubeStart(value) {
  try {
    if(!youtubeId(value))return 0;const url=youtubeURL(value),raw=url.searchParams.get('t')||url.searchParams.get('start')||new URLSearchParams(url.hash.slice(1)).get('t')||'0';
    if(/^\d+$/.test(raw))return Math.min(86400,Number(raw));
    const parts=raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    return parts?Math.min(86400,Number(parts[1]||0)*3600+Number(parts[2]||0)*60+Number(parts[3]||0)):0;
  }catch{return 0;}
}

export const stickerNames = ['orbita', 'ola', 'boa', 'festa'];
export function safeLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url : null; } catch { return null; }
}
