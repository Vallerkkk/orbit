"""YouTube no Órbita: proxy da YouTube Data API v3 e conexão Google (OAuth 2.0, fluxo web server).

- A chave YOUTUBE_API_KEY fica só no servidor; respostas são normalizadas e guardadas em cache (TTL)
  para economizar a cota diária (10k unidades; search.list custa 100).
- A conexão Google é SEPARADA da conta do Órbita: não usa o provedor Google do Supabase Auth, não liga
  identidades e nunca altera sessão, e-mail, @handle, nome, avatar ou perfil. É apenas um token do YouTube
  anexado ao usuário logado (linha em orbita_private.youtube_tokens, chaveada pelo id do Órbita),
  criptografado com AES-GCM (YOUTUBE_TOKEN_KEY). Desconectar só revoga/apaga esse token.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from collections import OrderedDict, defaultdict, deque
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from upstream import client_for, read_json

API = 'https://www.googleapis.com/youtube/v3/'
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
SCOPES = 'openid email profile https://www.googleapis.com/auth/youtube.readonly'
CALLBACK_PATH = '/api/youtube/oauth/callback'
STATE_COOKIE, PENDING_COOKIE, COOKIE_PATH = 'orbita_yt_state', 'orbita_yt_pending', '/api/youtube/oauth'
TTL = {'trending': 1800, 'search': 21600, 'videos': 3600, 'comments': 1800, 'channel': 3600, 'playlist': 3600, 'mine': 900}
SEARCH_RATE = (20, 600)  # 20 buscas novas por 10 minutos por conta
NOT_CONFIGURED = 'O YouTube ainda não foi configurado neste servidor (falta a YOUTUBE_API_KEY).'
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
CHANNEL_ID = re.compile(r'^UC[A-Za-z0-9_-]{22}$')
PLAYLIST_ID = re.compile(r'^[A-Za-z0-9_-]{10,64}$')
CATEGORIES = {'': '', 'musica': '10', 'games': '20', 'noticias': '25', 'ciencia': '28', 'esportes': '17', 'filmes': '1', 'humor': '23'}


class TTLCache:
    def __init__(self, size=500, clock=time.monotonic):
        self.size, self.clock, self.data = size, clock, OrderedDict()

    def get(self, key):
        hit = self.data.get(key)
        if not hit:
            return None
        if hit[0] < self.clock():
            self.data.pop(key, None)
            return None
        self.data.move_to_end(key)
        return hit[1]

    def set(self, key, value, ttl):
        self.data[key] = (self.clock() + ttl, value)
        self.data.move_to_end(key)
        while len(self.data) > self.size:
            self.data.popitem(last=False)
        return value


def duration_seconds(value):
    m = re.fullmatch(r'P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', str(value or ''))
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def _thumb(snippet):
    t = (snippet or {}).get('thumbnails') or {}
    for size in ('high', 'medium', 'standard', 'default'):
        url = (t.get(size) or {}).get('url', '')
        if isinstance(url, str) and url.startswith('https://') and re.match(r'https://(i\d?\.ytimg\.com|yt\d\.ggpht\.com|[a-z0-9.-]*googleusercontent\.com)/', url):
            return url
    return ''


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def video(item):
    sn, st, cd = item.get('snippet') or {}, item.get('statistics') or {}, item.get('contentDetails') or {}
    vid = item.get('id')
    if isinstance(vid, dict):
        vid = vid.get('videoId')
    vid = vid or (sn.get('resourceId') or {}).get('videoId') or cd.get('videoId')
    if not isinstance(vid, str) or not VIDEO_ID.match(vid):
        return None
    return {'id': vid, 'title': str(sn.get('title') or '')[:300], 'channelId': str(sn.get('videoOwnerChannelId') or sn.get('channelId') or '')[:64],
            'channelTitle': str(sn.get('videoOwnerChannelTitle') or sn.get('channelTitle') or '')[:200],
            'thumb': _thumb(sn) or f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg', 'published': str(sn.get('publishedAt') or cd.get('videoPublishedAt') or ''),
            'description': str(sn.get('description') or '')[:5000], 'duration': duration_seconds(cd.get('duration')),
            'views': _int(st.get('viewCount')), 'likes': _int(st.get('likeCount')), 'comments': _int(st.get('commentCount')),
            'live': sn.get('liveBroadcastContent') == 'live'}


def channel(item):
    sn, st = item.get('snippet') or {}, item.get('statistics') or {}
    cid = item.get('id')
    if isinstance(cid, dict):
        cid = cid.get('channelId')
    cid = cid or (sn.get('resourceId') or {}).get('channelId')
    if not isinstance(cid, str) or not CHANNEL_ID.match(cid):
        return None
    return {'id': cid, 'title': str(sn.get('title') or '')[:200], 'thumb': _thumb(sn), 'description': str(sn.get('description') or '')[:2000],
            'subscribers': _int(st.get('subscriberCount')), 'videos': _int(st.get('videoCount')), 'handle': str(sn.get('customUrl') or '')[:100],
            'uploads': str(((item.get('contentDetails') or {}).get('relatedPlaylists') or {}).get('uploads') or '')}


def playlist(item):
    sn = item.get('snippet') or {}
    pid = item.get('id')
    if isinstance(pid, dict):
        pid = pid.get('playlistId')
    if not isinstance(pid, str) or not PLAYLIST_ID.match(pid):
        return None
    return {'id': pid, 'title': str(sn.get('title') or '')[:300], 'channelTitle': str(sn.get('channelTitle') or '')[:200], 'channelId': str(sn.get('channelId') or '')[:64],
            'thumb': _thumb(sn), 'count': _int((item.get('contentDetails') or {}).get('itemCount')), 'description': str(sn.get('description') or '')[:2000]}


def comment(item):
    top = ((item.get('snippet') or {}).get('topLevelComment') or {}).get('snippet') or {}
    return {'id': str(item.get('id') or '')[:80], 'author': str(top.get('authorDisplayName') or '')[:120], 'avatar': _thumb({'thumbnails': {'default': {'url': top.get('authorProfileImageUrl') or ''}}}),
            'text': str(top.get('textOriginal') or top.get('textDisplay') or '')[:3000], 'likes': _int(top.get('likeCount')) or 0,
            'published': str(top.get('publishedAt') or ''), 'replies': _int((item.get('snippet') or {}).get('totalReplyCount')) or 0}


# ---- Segredos: estado OAuth assinado e tokens criptografados ----
def token_key():
    raw = os.getenv('YOUTUBE_TOKEN_KEY', '').strip()
    return hashlib.sha256(raw.encode()).digest() if len(raw) >= 16 else None


def seal(data, key=None):
    key = key or token_key()
    nonce = secrets.token_bytes(12)
    return base64.urlsafe_b64encode(nonce + AESGCM(key).encrypt(nonce, json.dumps(data).encode(), b'orbita-yt')).decode()


def unseal(blob, key=None):
    try:
        raw = base64.urlsafe_b64decode(str(blob).encode())
        return json.loads(AESGCM(key or token_key()).decrypt(raw[:12], raw[12:], b'orbita-yt'))
    except Exception:
        return None


def make_state(user_id, nonce, now=None, key=None):
    body = base64.urlsafe_b64encode(json.dumps({'u': user_id, 'n': nonce, 'e': int((now or time.time()) + 600)}).encode()).decode().rstrip('=')
    sig = hmac.new(key or token_key(), b'state.' + body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + sig


def check_state(state, cookie_nonce, now=None, key=None):
    """Devolve o id do usuário do Órbita se o state é íntegro, não expirou e casa com o cookie deste navegador."""
    try:
        body, sig = str(state).split('.', 1)
        if not hmac.compare_digest(sig, hmac.new(key or token_key(), b'state.' + body.encode(), hashlib.sha256).hexdigest()):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
    except Exception:
        return None
    if data.get('e', 0) < (now or time.time()) or not cookie_nonce or not hmac.compare_digest(str(data.get('n')), str(cookie_nonce)):
        return None
    return data.get('u') or None


def oauth_configured():
    return bool(os.getenv('GOOGLE_OAUTH_CLIENT_ID', '').strip() and os.getenv('GOOGLE_OAUTH_CLIENT_SECRET', '').strip() and token_key())


def base_url(request):
    env = os.getenv('PUBLIC_BASE_URL', '').strip().rstrip('/')
    if env:
        return env
    proto = request.headers.get('x-forwarded-proto', request.url.scheme).split(',')[0].strip()
    return f"{proto}://{request.headers.get('host', request.url.netloc)}"


def _id_profile(id_token):
    try:
        part = id_token.split('.')[1]
        data = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
    except Exception:
        return {}
    pic = data.get('picture') or ''
    return {'name': str(data.get('name') or '')[:120], 'email': str(data.get('email') or '')[:200],
            'picture': pic if isinstance(pic, str) and pic.startswith('https://') and 'googleusercontent.com/' in pic else ''}


def install_youtube(app, current_user, settings):
    cache, hits, access = TTLCache(800), defaultdict(deque), {}

    def api_key():
        key = os.getenv('YOUTUBE_API_KEY', '').strip()
        if not key:
            raise HTTPException(503, NOT_CONFIGURED)
        return key

    async def call(endpoint, params, ttl_kind, bearer=None, cache_scope=''):
        key = (endpoint, cache_scope, tuple(sorted(params.items())))
        hit = cache.get(key)
        if hit is not None:
            return hit
        query = dict(params)
        headers = {}
        if bearer:
            headers['Authorization'] = 'Bearer ' + bearer
        else:
            query['key'] = api_key()
        try:
            async with client_for(app) as client:
                response = await client.get(API + endpoint, params=query, headers=headers)
        except httpx.HTTPError:
            raise HTTPException(503, 'O YouTube não respondeu. Tente novamente.')
        if response.status_code == 403 and 'quota' in response.text.lower():
            raise HTTPException(429, 'A cota diária do YouTube acabou. Volte amanhã.')
        if response.status_code == 401 and bearer:
            raise HTTPException(401, 'Sua conexão com o Google expirou. Entre novamente.')
        if response.status_code == 404:
            raise HTTPException(404, 'Não encontrado no YouTube.')
        if response.is_error:
            raise HTTPException(503 if response.status_code >= 500 else 400, 'O YouTube recusou o pedido.')
        return cache.set(key, read_json(response, dict), TTL[ttl_kind])

    def limit(uid):
        now, bucket = time.monotonic(), hits[uid]
        while bucket and now - bucket[0] > SEARCH_RATE[1]:
            bucket.popleft()
        if len(bucket) >= SEARCH_RATE[0]:
            raise HTTPException(429, 'Muitas buscas seguidas. Espere um pouco.')
        bucket.append(now)

    async def details(ids, bearer=None):
        ids = [i for i in dict.fromkeys(ids) if VIDEO_ID.match(i)][:50]
        if not ids:
            return []
        data = await call('videos', {'part': 'snippet,contentDetails,statistics', 'id': ','.join(ids), 'hl': 'pt-BR'}, 'videos')
        found = {v['id']: v for v in map(video, data.get('items') or []) if v}
        return [found[i] for i in ids if i in found]

    @app.get('/api/youtube/status')
    async def yt_status(identity=Depends(current_user)):
        return {'available': bool(os.getenv('YOUTUBE_API_KEY', '').strip()), 'oauth': oauth_configured(),
                'message': '' if os.getenv('YOUTUBE_API_KEY', '').strip() else NOT_CONFIGURED}

    @app.get('/api/youtube/trending')
    async def yt_trending(category: str = Query('', max_length=20), page: str = Query('', max_length=100), identity=Depends(current_user)):
        params = {'part': 'snippet,contentDetails,statistics', 'chart': 'mostPopular', 'regionCode': 'BR', 'hl': 'pt-BR', 'maxResults': 24}
        if CATEGORIES.get(category):
            params['videoCategoryId'] = CATEGORIES[category]
        if page:
            params['pageToken'] = page
        data = await call('videos', params, 'trending')
        return {'items': [v for v in map(video, data.get('items') or []) if v], 'next': data.get('nextPageToken') or ''}

    @app.get('/api/youtube/search')
    async def yt_search(q: str = Query(..., min_length=1, max_length=120), type: str = Query('video', pattern='^(video|channel|playlist|all)$'),
                        page: str = Query('', max_length=100), identity=Depends(current_user)):
        params = {'part': 'snippet', 'q': q.strip(), 'maxResults': 20, 'regionCode': 'BR', 'relevanceLanguage': 'pt', 'safeSearch': 'moderate',
                  'type': 'video,channel,playlist' if type == 'all' else type}
        if page:
            params['pageToken'] = page
        key = ('search', '', tuple(sorted(params.items())))
        if cache.get(key) is None:
            api_key()
            limit(identity[0]['id'])
        data = await call('search', params, 'search')
        items = data.get('items') or []
        vids = await details([(i.get('id') or {}).get('videoId', '') for i in items if (i.get('id') or {}).get('kind') == 'youtube#video'])
        chans = [c for c in (channel(i) for i in items if (i.get('id') or {}).get('kind') == 'youtube#channel') if c]
        lists = [p for p in (playlist(i) for i in items if (i.get('id') or {}).get('kind') == 'youtube#playlist') if p]
        return {'videos': vids, 'channels': chans, 'playlists': lists, 'next': data.get('nextPageToken') or ''}

    @app.get('/api/youtube/videos')
    async def yt_videos(id: str = Query(..., max_length=600), identity=Depends(current_user)):
        return {'items': await details(id.split(','))}

    @app.get('/api/youtube/comments')
    async def yt_comments(id: str = Query(..., pattern=r'^[A-Za-z0-9_-]{11}$'), order: str = Query('relevance', pattern='^(relevance|time)$'),
                          page: str = Query('', max_length=100), identity=Depends(current_user)):
        params = {'part': 'snippet', 'videoId': id, 'maxResults': 20, 'order': order, 'textFormat': 'plainText'}
        if page:
            params['pageToken'] = page
        try:
            data = await call('commentThreads', params, 'comments')
        except HTTPException as error:
            if error.status_code in (400, 404):
                return {'items': [], 'next': '', 'disabled': True}
            raise
        return {'items': [comment(i) for i in data.get('items') or []], 'next': data.get('nextPageToken') or ''}

    async def uploads(playlist_id, page='', bearer=None, scope=''):
        params = {'part': 'snippet,contentDetails', 'playlistId': playlist_id, 'maxResults': 24}
        if page:
            params['pageToken'] = page
        data = await call('playlistItems', params, 'mine' if bearer else 'playlist', bearer, scope)
        ids = [(i.get('contentDetails') or {}).get('videoId', '') for i in data.get('items') or []]
        return await details(ids), data.get('nextPageToken') or ''

    @app.get('/api/youtube/channel')
    async def yt_channel(id: str = Query(..., pattern=r'^UC[A-Za-z0-9_-]{22}$'), page: str = Query('', max_length=100), identity=Depends(current_user)):
        data = await call('channels', {'part': 'snippet,statistics,contentDetails', 'id': id, 'hl': 'pt-BR'}, 'channel')
        info = next((c for c in map(channel, data.get('items') or []) if c), None)
        if not info:
            raise HTTPException(404, 'Canal não encontrado.')
        items, nxt = await uploads(info['uploads'], page) if info['uploads'] else ([], '')
        return {'channel': info, 'items': items, 'next': nxt}

    @app.get('/api/youtube/playlist')
    async def yt_playlist(id: str = Query(..., pattern=r'^[A-Za-z0-9_-]{10,64}$'), page: str = Query('', max_length=100), identity=Depends(current_user)):
        data = await call('playlists', {'part': 'snippet,contentDetails', 'id': id}, 'playlist')
        info = next((p for p in map(playlist, data.get('items') or []) if p), None)
        if not info:
            raise HTTPException(404, 'Playlist não encontrada.')
        items, nxt = await uploads(id, page)
        return {'playlist': info, 'items': items, 'next': nxt}

    # ---------- Conta Google (somente leitura do YouTube) ----------
    def need_oauth():
        if not oauth_configured():
            raise HTTPException(503, 'O login com Google não foi configurado neste servidor.')

    async def rpc(identity, name, body=None):
        s = settings()
        try:
            async with client_for(app) as client:
                r = await client.post(s['SUPABASE_URL'] + '/rest/v1/rpc/' + name, headers={**identity[1], 'Content-Type': 'application/json'}, json=body or {})
        except httpx.HTTPError:
            raise HTTPException(503, 'Não foi possível salvar a conexão com o Google.')
        if r.is_error:
            raise HTTPException(503, 'Não foi possível acessar a conexão com o Google.')
        if not r.content:
            return None
        try:
            return r.json()
        except (ValueError, UnicodeDecodeError):
            # Um proxy na frente do Supabase devolve HTML com 200: sem isto o erro vira 500.
            raise HTTPException(503, 'Não foi possível acessar a conexão com o Google.') from None

    async def google_token(data):
        try:
            async with client_for(app) as client:
                r = await client.post(TOKEN_URL, data={**data, 'client_id': os.getenv('GOOGLE_OAUTH_CLIENT_ID', '').strip(),
                                                      'client_secret': os.getenv('GOOGLE_OAUTH_CLIENT_SECRET', '').strip()})
        except httpx.HTTPError:
            raise HTTPException(503, 'O Google não respondeu. Tente novamente.')
        try:
            payload = r.json() if r.content else {}
        except (ValueError, UnicodeDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        # Os chamadores fazem data.get(...): uma página de erro do proxy viraria 500.
        return r.status_code, payload

    async def account(identity, required=True):
        """Token de acesso do YouTube do usuário (memória → refresh token criptografado no Supabase)."""
        uid = identity[0]['id']
        hit = access.get(uid)
        if hit and hit['exp'] > time.time() + 30:
            return hit
        stored = unseal(await rpc(identity, 'youtube_token_get') or '') if oauth_configured() else None
        if not stored or stored.get('u') != uid or not stored.get('rt'):
            access.pop(uid, None)
            if required:
                raise HTTPException(401, 'Entre com Google para ver seu YouTube.')
            return None
        status, data = await google_token({'grant_type': 'refresh_token', 'refresh_token': stored['rt']})
        if status != 200 or not data.get('access_token'):
            if data.get('error') == 'invalid_grant':
                await rpc(identity, 'youtube_token_clear')
            access.pop(uid, None)
            if required:
                raise HTTPException(401, 'Sua conexão com o Google expirou. Entre novamente.')
            return None
        access[uid] = {'at': data['access_token'], 'exp': time.time() + int(data.get('expires_in') or 3000), 'profile': stored.get('profile') or {}}
        return access[uid]

    @app.post('/api/youtube/oauth/start')
    async def oauth_start(request: Request, identity=Depends(current_user)):
        need_oauth()
        nonce = secrets.token_urlsafe(24)
        url = AUTH_URL + '?' + urlencode({'client_id': os.getenv('GOOGLE_OAUTH_CLIENT_ID', '').strip(), 'redirect_uri': base_url(request) + CALLBACK_PATH,
                                          'response_type': 'code', 'scope': SCOPES, 'access_type': 'offline', 'prompt': 'consent select_account',
                                          'include_granted_scopes': 'true', 'state': make_state(identity[0]['id'], nonce)})
        from fastapi.responses import JSONResponse
        response = JSONResponse({'url': url})
        response.set_cookie(STATE_COOKIE, nonce, max_age=600, httponly=True, secure=request.url.scheme == 'https' or 'https' in request.headers.get('x-forwarded-proto', ''),
                            samesite='lax', path=COOKIE_PATH)
        return response

    @app.get(CALLBACK_PATH)
    async def oauth_callback(request: Request, state: str = '', code: str = '', error: str = ''):
        def back(result):
            r = RedirectResponse('/?youtube=' + result, status_code=303)
            r.delete_cookie(STATE_COOKIE, path=COOKIE_PATH)
            return r
        if not oauth_configured():
            return back('indisponivel')
        uid = check_state(state, request.cookies.get(STATE_COOKIE))
        if not uid:
            return back('estado-invalido')
        if error or not code:
            return back('cancelado')
        status, data = await google_token({'grant_type': 'authorization_code', 'code': code, 'redirect_uri': base_url(request) + CALLBACK_PATH})
        if status != 200 or not data.get('refresh_token'):
            return back('erro')
        if 'youtube.readonly' not in str(data.get('scope', '')):
            return back('sem-permissao')
        r = back('conectado')
        r.set_cookie(PENDING_COOKIE, seal({'u': uid, 'rt': data['refresh_token'], 'at': data.get('access_token', ''), 'exp': time.time() + int(data.get('expires_in') or 3000),
                                           'profile': _id_profile(data.get('id_token', '')), 'until': time.time() + 600}),
                     max_age=600, httponly=True, secure=request.url.scheme == 'https' or 'https' in request.headers.get('x-forwarded-proto', ''), samesite='lax', path=COOKIE_PATH)
        return r

    @app.post('/api/youtube/oauth/finish')
    async def oauth_finish(request: Request, identity=Depends(current_user)):
        need_oauth()
        from fastapi.responses import JSONResponse
        pending = unseal(request.cookies.get(PENDING_COOKIE, ''))
        uid = identity[0]['id']
        if not pending or pending.get('u') != uid or pending.get('until', 0) < time.time():
            raise HTTPException(400, 'A conexão com o Google não pôde ser confirmada. Tente de novo.')
        await rpc(identity, 'youtube_token_put', {'ciphertext': seal({'u': uid, 'rt': pending['rt'], 'profile': pending.get('profile') or {}})})
        access[uid] = {'at': pending.get('at') or '', 'exp': pending.get('exp', 0) if pending.get('at') else 0, 'profile': pending.get('profile') or {}}
        response = JSONResponse({'connected': True, 'profile': pending.get('profile') or {}})
        response.delete_cookie(PENDING_COOKIE, path=COOKIE_PATH)
        return response

    @app.get('/api/youtube/me')
    async def yt_me(identity=Depends(current_user)):
        if not oauth_configured():
            return {'oauth': False, 'connected': False}
        acct = await account(identity, required=False)
        return {'oauth': True, 'connected': bool(acct), 'profile': (acct or {}).get('profile') or {}}

    @app.post('/api/youtube/oauth/logout')
    async def oauth_logout(identity=Depends(current_user)):
        uid = identity[0]['id']
        stored = unseal(await rpc(identity, 'youtube_token_get') or '') if oauth_configured() else None
        token = (stored or {}).get('rt') or (access.get(uid) or {}).get('at')
        if token:
            try:
                async with client_for(app) as client:
                    await client.post(REVOKE_URL, data={'token': token})
            except httpx.HTTPError:
                pass
        await rpc(identity, 'youtube_token_clear')
        access.pop(uid, None)
        for key in [k for k in cache.data if k[1] == uid]:
            cache.data.pop(key, None)
        return {'connected': False}

    @app.get('/api/youtube/mine/playlists')
    async def mine_playlists(identity=Depends(current_user)):
        acct, uid = await account(identity), identity[0]['id']
        data = await call('playlists', {'part': 'snippet,contentDetails', 'mine': 'true', 'maxResults': 50}, 'mine', acct['at'], uid)
        return {'items': [p for p in map(playlist, data.get('items') or []) if p]}

    @app.get('/api/youtube/mine/liked')
    async def mine_liked(page: str = Query('', max_length=100), identity=Depends(current_user)):
        acct, uid = await account(identity), identity[0]['id']
        params = {'part': 'snippet,contentDetails,statistics', 'myRating': 'like', 'maxResults': 24}
        if page:
            params['pageToken'] = page
        data = await call('videos', params, 'mine', acct['at'], uid)
        return {'items': [v for v in map(video, data.get('items') or []) if v], 'next': data.get('nextPageToken') or ''}

    @app.get('/api/youtube/mine/subscriptions')
    async def mine_subscriptions(identity=Depends(current_user)):
        acct, uid = await account(identity), identity[0]['id']
        subs = await call('subscriptions', {'part': 'snippet', 'mine': 'true', 'maxResults': 50, 'order': 'relevance'}, 'mine', acct['at'], uid)
        ids = [((i.get('snippet') or {}).get('resourceId') or {}).get('channelId', '') for i in subs.get('items') or []]
        ids = [i for i in ids if CHANNEL_ID.match(i)]
        channels = []
        if ids:
            data = await call('channels', {'part': 'snippet,contentDetails', 'id': ','.join(ids)}, 'channel')
            channels = [c for c in map(channel, data.get('items') or []) if c]
        latest = []
        for c in channels[:15]:  # 1 unidade por canal; feed em cache por 15 min
            if c['uploads']:
                try:
                    data = await call('playlistItems', {'part': 'contentDetails', 'playlistId': c['uploads'], 'maxResults': 4}, 'mine')
                except HTTPException:
                    continue
                latest += [(i.get('contentDetails') or {}).get('videoId', '') for i in data.get('items') or []]
        vids = sorted(await details(latest), key=lambda v: v['published'], reverse=True)
        return {'channels': [{k: c[k] for k in ('id', 'title', 'thumb')} for c in channels], 'items': vids[:48]}
