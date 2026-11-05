"""Integração com Spotify (Authorization Code + PKCE) no backend.

Tokens ficam só no servidor, na tabela public.spotify_connections (RLS sem policies, sem grants
para anon/authenticated). O backend acessa com SUPABASE_SERVICE_ROLE_KEY; sem essa variável (ou sem
SPOTIFY_CLIENT_ID/SECRET) a integração fica desligada e o app mostra "Em breve".
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from upstream import client_for, read_json

SCOPES = 'user-read-currently-playing user-read-playback-state'
DEFAULT_REDIRECT = 'https://orbita-8nwu.onrender.com/api/spotify/callback'
STATE_TTL = 600
CACHE_TTL = 15
CACHE_LIMIT = 500
STATE_COOKIE, PENDING_COOKIE, COOKIE_PATH = 'orbita_sp_state', 'orbita_sp_pending', '/api/spotify'


def _state_key(c):
    return hashlib.sha256(('spotify-state:' + c['client_secret']).encode()).digest()


def make_state(user_id, nonce, key, now=None):
    body = base64.urlsafe_b64encode(json.dumps(
        {'u': user_id, 'n': nonce, 'e': int((now or time.time()) + STATE_TTL)}).encode()).decode().rstrip('=')
    sig = hmac.new(key, b'state.' + body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + sig


def check_state(state, cookie_nonce, key, now=None):
    """Devolve o id do usuário se o state é íntegro, não expirou e casa com o cookie deste navegador."""
    try:
        body, sig = str(state).split('.', 1)
        if not hmac.compare_digest(sig, hmac.new(key, b'state.' + body.encode(), hashlib.sha256).hexdigest()):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
    except Exception:
        return None
    if data.get('e', 0) < (now or time.time()) or not cookie_nonce or not hmac.compare_digest(str(data.get('n')), str(cookie_nonce)):
        return None
    return data.get('u') or None


def seal_pending(verifier, nonce, key, now=None):
    body = base64.urlsafe_b64encode(json.dumps(
        {'v': verifier, 'n': nonce, 'e': int((now or time.time()) + STATE_TTL)}).encode()).decode().rstrip('=')
    sig = hmac.new(key, b'pending.' + body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + sig


def unseal_pending(blob, nonce, key, now=None):
    try:
        body, sig = str(blob).split('.', 1)
        if not hmac.compare_digest(sig, hmac.new(key, b'pending.' + body.encode(), hashlib.sha256).hexdigest()):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
    except Exception:
        return None
    if data.get('e', 0) < (now or time.time()) or not nonce or not hmac.compare_digest(str(data.get('n')), str(nonce)):
        return None
    return data.get('v') or None


def config():
    return {
        'client_id': os.getenv('SPOTIFY_CLIENT_ID', '').strip(),
        'client_secret': os.getenv('SPOTIFY_CLIENT_SECRET', '').strip(),
        'redirect': os.getenv('SPOTIFY_REDIRECT_URI', '').strip() or DEFAULT_REDIRECT,
        'url': os.getenv('SUPABASE_URL', '').strip(),
        'service': os.getenv('SUPABASE_SERVICE_ROLE_KEY', '').strip(),
    }


def enabled(c=None):
    c = c or config()
    return all(c[k] for k in ('client_id', 'client_secret', 'url', 'service'))


def install_spotify(app, current_user):
    cache: dict[str, tuple[float, dict]] = {}

    def trim_cache():
        now = time.time()
        for key in [k for k, v in cache.items() if v[0] <= now]:
            cache.pop(key, None)
        while len(cache) > CACHE_LIMIT:
            cache.pop(next(iter(cache)))

    def rest(c):
        return c['url'] + '/rest/v1/spotify_connections', {
            'apikey': c['service'], 'Authorization': 'Bearer ' + c['service'], 'Content-Type': 'application/json'}

    async def load(c, user_id):
        url, h = rest(c)
        try:
            async with client_for(app) as client:
                r = await client.get(url, headers=h, params={'user_id': 'eq.' + user_id, 'select': '*'})
        except httpx.HTTPError:
            raise HTTPException(503, 'Spotify indisponível no momento.') from None
        if r.status_code != 200:
            raise HTTPException(503, 'Spotify indisponível no momento.')
        rows = read_json(r, list)
        return rows[0] if rows else None

    async def save(c, row):
        url, h = rest(c)
        async with client_for(app) as client:
            r = await client.post(url, headers={**h, 'Prefer': 'resolution=merge-duplicates,return=minimal'},
                                  params={'on_conflict': 'user_id'}, json=row)
        if r.status_code >= 300:
            raise HTTPException(503, 'Não foi possível salvar a conexão com o Spotify.')

    async def token_call(c, data):
        auth = base64.b64encode(f"{c['client_id']}:{c['client_secret']}".encode()).decode()
        async with client_for(app) as client:
            r = await client.post('https://accounts.spotify.com/api/token', data=data,
                                  headers={'Authorization': 'Basic ' + auth})
        if r.status_code != 200:
            return None
        return read_json(r, dict)

    async def access_token(c, row):
        exp = datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00')).timestamp() if row.get('expires_at') else 0
        if row.get('access_token') and exp - 60 > time.time():
            return row['access_token']
        t = await token_call(c, {'grant_type': 'refresh_token', 'refresh_token': row['refresh_token'], 'client_id': c['client_id']})
        if not t or not t.get('access_token'):
            return None
        updated = {'access_token': t['access_token'],
                   'refresh_token': t.get('refresh_token') or row['refresh_token'],
                   'expires_at': datetime.fromtimestamp(time.time() + int(t.get('expires_in', 3600)), timezone.utc).isoformat()}
        # Compare com a conexão carregada: refresh não pode recriar um DELETE nem sobrescrever outro OAuth.
        params = {'user_id': 'eq.' + row['user_id'], 'refresh_token': 'eq.' + row['refresh_token'],
                  'expires_at': 'eq.' + row['expires_at'] if row.get('expires_at') is not None else 'is.null'}
        url, h = rest(c)
        try:
            async with client_for(app) as client:
                r = await client.patch(url, headers={**h, 'Prefer': 'return=representation'},
                                       params=params, json=updated)
        except httpx.HTTPError:
            raise HTTPException(503, 'Não foi possível salvar a conexão com o Spotify.') from None
        if r.status_code != 200:
            raise HTTPException(503, 'Não foi possível salvar a conexão com o Spotify.')
        rows = read_json(r, list)
        if not rows:
            return None
        if (len(rows) != 1 or not isinstance(rows[0], dict) or rows[0].get('user_id') != row['user_id']
                or rows[0].get('access_token') != updated['access_token']
                or rows[0].get('refresh_token') != updated['refresh_token']):
            raise HTTPException(503, 'O serviço de dados retornou uma resposta inválida.')
        return rows[0]['access_token']

    @app.get('/api/spotify/status')
    async def spotify_status(identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            return {'enabled': False}
        row = await load(c, identity[0]['id'])
        return {'enabled': True, 'connected': bool(row), 'displayName': (row or {}).get('display_name'),
                'showOnProfile': bool((row or {}).get('show_on_profile', True))}

    @app.post('/api/spotify/login')
    async def spotify_login(request: Request, identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            raise HTTPException(503, 'Integração com Spotify em breve.')
        key = _state_key(c)
        nonce = secrets.token_urlsafe(24)
        verifier = secrets.token_urlsafe(64)[:96]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        response = JSONResponse({'url': 'https://accounts.spotify.com/authorize?' + urlencode({
            'response_type': 'code', 'client_id': c['client_id'], 'scope': SCOPES, 'redirect_uri': c['redirect'],
            'state': make_state(identity[0]['id'], nonce, key), 'code_challenge_method': 'S256', 'code_challenge': challenge})})
        # O nonce no cookie amarra o retorno a este navegador; o verifier fica só no servidor.
        secure = request.url.scheme == 'https' or 'https' in request.headers.get('x-forwarded-proto', '')
        for name, value in ((STATE_COOKIE, nonce), (PENDING_COOKIE, seal_pending(verifier, nonce, key))):
            response.set_cookie(name, value, max_age=STATE_TTL, httponly=True, secure=secure, samesite='lax', path=COOKIE_PATH)
        return response

    @app.get('/api/spotify/callback')
    async def spotify_callback(request: Request, code: str = '', state: str = '', error: str = ''):
        c = config()

        def back(result):
            response = RedirectResponse('/#spotify=' + result, status_code=303)
            response.delete_cookie(STATE_COOKIE, path=COOKIE_PATH)
            response.delete_cookie(PENDING_COOKIE, path=COOKIE_PATH)
            return response

        if error or not code or not enabled(c):
            return back('erro')
        key = _state_key(c)
        nonce = request.cookies.get(STATE_COOKIE) or ''
        uid = check_state(state, nonce, key)
        verifier = unseal_pending(request.cookies.get(PENDING_COOKIE, ''), nonce, key)
        if not uid or not verifier:
            return back('erro')
        t = await token_call(c, {'grant_type': 'authorization_code', 'code': code, 'redirect_uri': c['redirect'],
                                 'client_id': c['client_id'], 'code_verifier': verifier})
        if not t or not t.get('refresh_token'):
            return back('erro')
        name = None
        try:
            async with client_for(app) as client:
                me = await client.get('https://api.spotify.com/v1/me', headers={'Authorization': 'Bearer ' + t['access_token']})
            if me.status_code == 200:
                name = (read_json(me, dict).get('display_name') or '')[:80] or None
        except httpx.HTTPError:
            pass
        await save(c, {'user_id': uid, 'access_token': t['access_token'], 'refresh_token': t['refresh_token'],
                       'expires_at': datetime.fromtimestamp(time.time() + int(t.get('expires_in', 3600)), timezone.utc).isoformat(),
                       'display_name': name})
        cache.pop(uid, None)
        return back('conectado')

    @app.post('/api/spotify/settings')
    async def spotify_settings(request: Request, identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            raise HTTPException(503, 'Integração com Spotify em breve.')
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, 'Pedido inválido.') from None
        if not isinstance(body, dict):
            raise HTTPException(400, 'Pedido inválido.')
        uid = identity[0]['id']
        if not await load(c, uid):
            raise HTTPException(404, 'Spotify não conectado.')
        url, h = rest(c)
        try:
            async with client_for(app) as client:
                response = await client.patch(url, headers=h, params={'user_id': 'eq.' + uid}, json={'show_on_profile': body.get('showOnProfile') is True})
        except httpx.HTTPError:
            raise HTTPException(503, 'Não foi possível atualizar a privacidade do Spotify.') from None
        if not response.is_success:
            raise HTTPException(503, 'Não foi possível atualizar a privacidade do Spotify.')
        cache.pop(uid, None)
        return {'ok': True}

    @app.post('/api/spotify/disconnect')
    async def spotify_disconnect(identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            return {'ok': True}
        url, h = rest(c)
        try:
            async with client_for(app) as client:
                response = await client.delete(url, headers=h, params={'user_id': 'eq.' + identity[0]['id']})
        except httpx.HTTPError:
            raise HTTPException(503, 'Não foi possível desconectar o Spotify.') from None
        if not response.is_success:
            raise HTTPException(503, 'Não foi possível desconectar o Spotify.')
        cache.pop(identity[0]['id'], None)
        return {'ok': True}

    @app.get('/api/spotify/now-playing/{user_id}')
    async def spotify_now_playing(user_id: UUID, identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            return {'playing': False}
        uid = str(user_id)
        # O direito de ver vem sempre do banco, antes de qualquer cache: um acerto aqui
        # entregava a faixa a um estranho quando a própria pessoa acabara de consultar o
        # próprio cartão (show_on_profile desligado não protegia nada por 15 segundos).
        row = await load(c, uid)
        if not row or not (row.get('show_on_profile', True) or uid == identity[0]['id']):
            return {'playing': False}
        hit = cache.get(uid)
        if hit and hit[0] > time.time():
            return hit[1]
        trim_cache()
        out = {'playing': False}
        token = await access_token(c, row)
        if token:
            try:
                async with client_for(app) as client:
                    r = await client.get('https://api.spotify.com/v1/me/player/currently-playing', headers={'Authorization': 'Bearer ' + token})
                if r.status_code == 200:
                    d = read_json(r, dict)
                    item = d.get('item') or {}
                    if item and d.get('is_playing') and item.get('type', 'track') == 'track':
                        imgs = (item.get('album') or {}).get('images') or []
                        out = {'playing': True, 'track': item.get('name'), 'artist': ', '.join(a.get('name', '') for a in item.get('artists') or []),
                               'album': (item.get('album') or {}).get('name'), 'art': imgs[-2]['url'] if len(imgs) > 1 else (imgs[0]['url'] if imgs else None),
                               'url': (item.get('external_urls') or {}).get('spotify'), 'progressMs': d.get('progress_ms') or 0,
                               'durationMs': item.get('duration_ms') or 0, 'fetchedAt': int(time.time() * 1000)}
            except httpx.HTTPError:
                pass
        cache[uid] = (time.time() + CACHE_TTL, out)
        return out
