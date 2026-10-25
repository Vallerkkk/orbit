"""Integração com Spotify (Authorization Code + PKCE) no backend.

Tokens ficam só no servidor, na tabela public.spotify_connections (RLS sem policies, sem grants
para anon/authenticated). O backend acessa com SUPABASE_SERVICE_ROLE_KEY; sem essa variável (ou sem
SPOTIFY_CLIENT_ID/SECRET) a integração fica desligada e o app mostra "Em breve".
"""
import base64
import hashlib
import os
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from upstream import client_for, read_json

SCOPES = 'user-read-currently-playing user-read-playback-state'
DEFAULT_REDIRECT = 'https://orbita-8nwu.onrender.com/api/spotify/callback'
STATE_TTL = 600
CACHE_TTL = 15


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
    states: dict[str, dict] = {}
    cache: dict[str, tuple[float, dict]] = {}

    def rest(c):
        return c['url'] + '/rest/v1/spotify_connections', {
            'apikey': c['service'], 'Authorization': 'Bearer ' + c['service'], 'Content-Type': 'application/json'}

    async def load(c, user_id):
        url, h = rest(c)
        async with client_for(app) as client:
            r = await client.get(url, headers=h, params={'user_id': 'eq.' + user_id, 'select': '*'})
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
        row = {'user_id': row['user_id'], 'access_token': t['access_token'],
               'refresh_token': t.get('refresh_token') or row['refresh_token'],
               'expires_at': datetime.fromtimestamp(time.time() + int(t.get('expires_in', 3600)), timezone.utc).isoformat()}
        await save(c, row)
        return row['access_token']

    @app.get('/api/spotify/status')
    async def spotify_status(identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            return {'enabled': False}
        row = await load(c, identity[0]['id'])
        return {'enabled': True, 'connected': bool(row), 'displayName': (row or {}).get('display_name'),
                'showOnProfile': bool((row or {}).get('show_on_profile', True))}

    @app.post('/api/spotify/login')
    async def spotify_login(identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            raise HTTPException(503, 'Integração com Spotify em breve.')
        now = time.time()
        for k in [k for k, v in states.items() if v['exp'] < now]:
            states.pop(k, None)
        verifier = secrets.token_urlsafe(64)[:96]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        state = secrets.token_urlsafe(24)
        states[state] = {'user': identity[0]['id'], 'verifier': verifier, 'exp': now + STATE_TTL}
        return {'url': 'https://accounts.spotify.com/authorize?' + urlencode({
            'response_type': 'code', 'client_id': c['client_id'], 'scope': SCOPES, 'redirect_uri': c['redirect'],
            'state': state, 'code_challenge_method': 'S256', 'code_challenge': challenge})}

    @app.get('/api/spotify/callback')
    async def spotify_callback(request: Request, code: str = '', state: str = '', error: str = ''):
        c = config()
        pending = states.pop(state, None)
        if error or not code or not pending or pending['exp'] < time.time() or not enabled(c):
            return RedirectResponse('/#spotify=erro', status_code=303)
        t = await token_call(c, {'grant_type': 'authorization_code', 'code': code, 'redirect_uri': c['redirect'],
                                 'client_id': c['client_id'], 'code_verifier': pending['verifier']})
        if not t or not t.get('refresh_token'):
            return RedirectResponse('/#spotify=erro', status_code=303)
        name = None
        try:
            async with client_for(app) as client:
                me = await client.get('https://api.spotify.com/v1/me', headers={'Authorization': 'Bearer ' + t['access_token']})
            if me.status_code == 200:
                name = (read_json(me, dict).get('display_name') or '')[:80] or None
        except httpx.HTTPError:
            pass
        await save(c, {'user_id': pending['user'], 'access_token': t['access_token'], 'refresh_token': t['refresh_token'],
                       'expires_at': datetime.fromtimestamp(time.time() + int(t.get('expires_in', 3600)), timezone.utc).isoformat(),
                       'display_name': name})
        cache.pop(pending['user'], None)
        return RedirectResponse('/#spotify=conectado', status_code=303)

    @app.post('/api/spotify/settings')
    async def spotify_settings(request: Request, identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            raise HTTPException(503, 'Integração com Spotify em breve.')
        body = await request.json()
        uid = identity[0]['id']
        if not await load(c, uid):
            raise HTTPException(404, 'Spotify não conectado.')
        url, h = rest(c)
        async with client_for(app) as client:
            await client.patch(url, headers=h, params={'user_id': 'eq.' + uid}, json={'show_on_profile': bool(body.get('showOnProfile'))})
        cache.pop(uid, None)
        return {'ok': True}

    @app.post('/api/spotify/disconnect')
    async def spotify_disconnect(identity=Depends(current_user)):
        c = config()
        if not enabled(c):
            return {'ok': True}
        url, h = rest(c)
        async with client_for(app) as client:
            await client.delete(url, headers=h, params={'user_id': 'eq.' + identity[0]['id']})
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
