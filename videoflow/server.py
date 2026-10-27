import os, json, hashlib, mimetypes, socket, threading, re, urllib.parse, tempfile, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get('VIDEO_FOLDER', str(Path.home() / 'Videos' / 'beta2'))).expanduser().resolve()
PORT = int(os.environ.get('PORT', '8765'))
DATA = BASE / 'dados.json'
LOCK = threading.RLock()
EXT = {'.mp4', '.mov', '.m4v', '.webm'}
_scan_cache = {}
_scan_time = 0.0
_scan_lock = threading.Lock()
def scan(ttl=4):
    global _scan_cache, _scan_time
    now = time.monotonic()
    if _scan_cache and now - _scan_time < ttl: return _scan_cache
    with _scan_lock:
        now = time.monotonic()
        if not _scan_cache or now - _scan_time >= ttl:
            out = {}
            if ROOT.is_dir():
                for p in ROOT.rglob('*'):
                    if p.is_file() and p.suffix.lower() in EXT:
                        try:
                            resolved = p.resolve()
                            if not resolved.is_relative_to(ROOT): continue
                            rel = p.relative_to(ROOT).as_posix()
                            key = hashlib.sha256(rel.encode('utf-8')).hexdigest()[:24]
                            out[key] = {'id': key, 'name': p.stem, 'path': rel, 'file': resolved}
                        except OSError: pass
            _scan_cache = out; _scan_time = now
    return _scan_cache

def load():
    try:
        d = json.loads(DATA.read_text(encoding='utf-8'))
        return {'favorites': d.get('favorites', []), 'folders': d.get('folders', [])}
    except (OSError, ValueError, AttributeError): return {'favorites': [], 'folders': []}
def save(d):
    fd, name = tempfile.mkstemp(dir=BASE, prefix='dados-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f: json.dump(d, f, ensure_ascii=False)
        os.replace(name, DATA)
    finally:
        if os.path.exists(name): os.unlink(name)

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def respond(self, code, body, typ='application/json; charset=utf-8'):
        if isinstance(body, str): body = body.encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', typ); self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/library':
            videos = scan()
            with LOCK: state = load()
            return self.respond(200, json.dumps({'videos': [{k:v for k,v in x.items() if k != 'file'} for x in videos.values()], 'state': state, 'folderExists': ROOT.is_dir()}, ensure_ascii=False))
        if path.startswith('/video/'):
            video = scan().get(path.removeprefix('/video/'))
            if not video: return self.respond(404, 'Not found', 'text/plain')
            try:
                f = video['file'].open('rb'); size = os.fstat(f.fileno()).st_size
                start, end = 0, size - 1; rng = self.headers.get('Range'); status = 200
                if rng:
                    m = re.fullmatch(r'bytes=(\d*)-(\d*)', rng.strip())
                    if not m or (not m[1] and not m[2]): f.close(); return self.range_error(size)
                    if m[1]: start = int(m[1]); end = min(int(m[2]), end) if m[2] else end
                    else: start = max(size - int(m[2]), 0)
                    if start > end or start >= size: f.close(); return self.range_error(size)
                    status = 206
                self.send_response(status); self.send_header('Content-Type', mimetypes.guess_type(video['path'])[0] or 'application/octet-stream'); self.send_header('Accept-Ranges','bytes'); self.send_header('Content-Length',str(max(0,end-start+1))); self.send_header('Cache-Control','private, max-age=3600');
                if status == 206: self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
                self.end_headers()
                if self.command != 'HEAD':
                    f.seek(start); remaining = end-start+1
                    while remaining > 0:
                        chunk = f.read(min(512*1024,remaining))
                        if not chunk: break
                        self.wfile.write(chunk); remaining -= len(chunk)
                f.close()
            except (BrokenPipeError, ConnectionResetError, OSError): pass
            return
        files = {'/': ('index.html','text/html; charset=utf-8'), '/app.js': ('app.js','text/javascript; charset=utf-8'), '/style.css': ('style.css','text/css; charset=utf-8'), '/manifest.json': ('manifest.json','application/manifest+json')}
        if path not in files: return self.respond(404,'Not found','text/plain')
        filename, typ = files[path]; return self.respond(200,(BASE/'static'/filename).read_bytes(),typ)
    def range_error(self,size):
        self.send_response(416); self.send_header('Content-Range',f'bytes */{size}'); self.send_header('Content-Length','0'); self.end_headers()
    def do_POST(self):
        if self.path != '/api/action': return self.respond(404,'{}')
        try:
            n = int(self.headers.get('Content-Length','0'))
            if n <= 0 or n > 8192: raise ValueError()
            a = json.loads(self.rfile.read(n)); videos = scan()
            with LOCK:
                d = load(); kind = a.get('type'); vid = a.get('video'); fid = a.get('folder')
                if kind == 'favorite' and vid in videos:
                    d['favorites'] = [x for x in d['favorites'] if x != vid] if vid in d['favorites'] else d['favorites'] + [vid]
                elif kind == 'create':
                    name = str(a.get('name','')).strip()[:60]
                    if not name: raise ValueError()
                    d['folders'].append({'id': os.urandom(8).hex(), 'name': name, 'videos': []})
                elif kind == 'delete': d['folders'] = [f for f in d['folders'] if f['id'] != fid]
                elif kind == 'toggle_folder' and vid in videos:
                    folder = next((f for f in d['folders'] if f['id'] == fid), None)
                    if not folder: raise ValueError()
                    folder['videos'] = [x for x in folder['videos'] if x != vid] if vid in folder['videos'] else folder['videos'] + [vid]
                else: raise ValueError()
                save(d)
            self.respond(200,json.dumps(d,ensure_ascii=False))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError): self.respond(400,'{"error":"Solicitação inválida"}')
    def log_message(self, format, *args): pass

def lan_ip():
    try:
        s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(('192.0.2.1',80)); ip=s.getsockname()[0]; s.close(); return ip
    except OSError: return 'IP-DO-SEU-PC'
if __name__ == '__main__':
    print('\n  VIDEOFLOW — mantenha esta janela aberta', flush=True)
    print(f'  Pasta: {ROOT}\n  No computador: http://localhost:{PORT}\n  No iPhone: http://{lan_ip()}:{PORT}\n',flush=True)
    if not ROOT.is_dir(): print('  ATENÇÃO: pasta de vídeos não encontrada. Confira o README.\n',flush=True)
    ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
