"""Proxy de busca de GIFs e figurinhas (GIPHY). A chave fica só no servidor (GIPHY_API_KEY).

Só metadados passam por aqui; as mídias carregam direto da CDN do GIPHY (media*.giphy.com).
Cache curto em memória e limite por conta para não estourar a cota do provedor.
"""
import os
import time
from collections import OrderedDict, defaultdict, deque
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import Depends, HTTPException, Query
from upstream import client_for, read_json

GIPHY = 'https://api.giphy.com/v1/'
CACHE_SECONDS = 120
CACHE_SIZE = 300
RATE = (30, 60)  # 30 buscas por minuto por conta
MEDIA_HOSTS = ('giphy.com',)


def safe_media_url(url):
    try:
        parsed = urlparse(url or '')
    except ValueError:
        return None
    host = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or parsed.username or parsed.password or not any(host == h or host.endswith('.' + h) for h in MEDIA_HOSTS):
        return None
    return parsed._replace(query='', fragment='').geturl()


def simplify(item):
    images = item.get('images') or {}
    if not isinstance(images, dict):
        return None
    main = images.get('fixed_height') or images.get('original') or {}
    small = images.get('fixed_width_small') or images.get('fixed_height_small') or main
    if not isinstance(main, dict) or not isinstance(small, dict):
        return None
    url, preview = safe_media_url(main.get('webp') or main.get('url')), safe_media_url(small.get('webp') or small.get('url'))
    if not url:
        return None
    try:
        width, height = int(main.get('width') or 0), int(main.get('height') or 0)
    except (ValueError, TypeError, OverflowError):
        width = height = 0
    return {'id': str(item.get('id', ''))[:64], 'title': str(item.get('title') or '')[:120], 'url': url,
            'preview': preview or url, 'width': width, 'height': height}


def install_media_search(app, current_user):
    cache = OrderedDict()
    hits = defaultdict(deque)

    def limit(user_id):
        now, bucket = time.monotonic(), hits[user_id]
        while bucket and now - bucket[0] > RATE[1]:
            bucket.popleft()
        if len(bucket) >= RATE[0]:
            raise HTTPException(429, 'Muitas buscas seguidas. Espere alguns segundos.')
        bucket.append(now)

    async def fetch(kind, endpoint, params, identity):
        key = os.getenv('GIPHY_API_KEY', '').strip()
        if not key:
            return {'available': False, 'results': [], 'provider': 'GIPHY'}
        cache_key = (kind, endpoint, tuple(sorted(params.items())))
        hit = cache.get(cache_key)
        if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
            cache.move_to_end(cache_key)
            return hit[1]
        limit(identity[0]['id'])
        try:
            async with client_for(app) as client:
                response = await client.request('GET', GIPHY + kind + '/' + endpoint,
                                                params={**params, 'api_key': key, 'rating': 'pg-13', 'lang': 'pt', 'bundle': 'messaging_non_clips'})
        except httpx.HTTPError:
            raise HTTPException(503, 'O provedor de GIFs não respondeu. Tente novamente.')
        if response.status_code == 429:
            raise HTTPException(429, 'Limite do provedor de GIFs atingido. Tente mais tarde.')
        if response.is_error:
            raise HTTPException(503, 'O provedor de GIFs está indisponível agora.')
        data = read_json(response, dict).get('data')
        if not isinstance(data, list):
            raise HTTPException(503, 'O provedor de GIFs retornou uma resposta inválida.')
        result = {'available': True, 'provider': 'GIPHY', 'results': [r for r in (simplify(i) for i in data if isinstance(i, dict)) if r]}
        cache[cache_key] = (time.monotonic(), result)
        while len(cache) > CACHE_SIZE:
            cache.popitem(last=False)
        return result

    Kind = Literal['gifs', 'stickers']

    @app.get('/api/media/search')
    async def media_search(type: Kind = 'gifs', q: str = Query(min_length=1, max_length=50), offset: int = Query(0, ge=0, le=200), identity=Depends(current_user)):
        return await fetch(type, 'search', {'q': q.strip().lower(), 'limit': '24', 'offset': str(offset)}, identity)

    @app.get('/api/media/trending')
    async def media_trending(type: Kind = 'gifs', offset: int = Query(0, ge=0, le=200), identity=Depends(current_user)):
        return await fetch(type, 'trending', {'limit': '24', 'offset': str(offset)}, identity)
