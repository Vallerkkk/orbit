"""Insígnias: contadores de eventos validados pelo servidor e leitura do estado calculado no banco.

O cliente nunca informa quantidades. O heartbeat só registra minutos de chamada/tela/câmera depois
que o LiveKit confirma que a pessoa está na sala com aquela faixa publicada. O banco limita a um
registro por minuto (record_badge_event) e calcula níveis a partir de contagens reais (badge_state).
"""
import os
from typing import Optional
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException
from livekit import api
from pydantic import BaseModel
from upstream import client_for, read_json


class Heartbeat(BaseModel):
    channel_id: Optional[UUID] = None
    watch_party: bool = False


def install_badges(app, current_user, settings):
    async def rpc(name, headers, body):
        url = settings()['SUPABASE_URL'] + '/rest/v1/rpc/' + name
        try:
            async with client_for(app) as client:
                result = await client.post(url, headers=headers, json=body)
        except httpx.HTTPError:
            raise HTTPException(503, 'O serviço de dados está indisponível. Tente novamente.')
        if result.status_code == 404:
            raise HTTPException(503, 'As insígnias ainda não foram instaladas no banco.')
        if result.is_error:
            raise HTTPException(403 if result.status_code in (401, 403) else 400 if result.status_code < 500 else 503,
                                'Não foi possível atualizar as insígnias.')
        return read_json(result, (dict, list, bool, int, type(None))) if result.content else None

    async def live_sources(channel_id, user_id):
        config = settings()
        if not all(config.get(k) for k in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
            return None
        try:
            async with api.LiveKitAPI(config['LIVEKIT_URL'], config['LIVEKIT_API_KEY'], config['LIVEKIT_API_SECRET']) as lk:
                participant = await lk.room.get_participant(api.RoomParticipantIdentity(room='channel-' + str(channel_id), identity=user_id))
        except Exception:
            return None
        sources = set()
        for track in participant.tracks:
            if not track.muted:
                sources.add(track.source)
        return sources

    @app.post('/api/badges/heartbeat')
    async def badge_heartbeat(body: Heartbeat, identity=Depends(current_user)):
        user, headers = identity
        key = os.getenv('PUSH_TRANSPORT_KEY', '')
        if not key:
            return {'ok': False, 'reason': 'unconfigured'}
        recorded = ['active_day'] if await rpc('record_badge_event', headers, {'transport_key': key, 'event_kind': 'active_day'}) else []
        if body.channel_id is not None:
            sources = await live_sources(body.channel_id, user['id'])
            if sources is not None:
                kinds = ['call_minute']
                if api.TrackSource.SCREEN_SHARE in sources:
                    kinds.append('screenshare_minute')
                if api.TrackSource.CAMERA in sources:
                    kinds.append('camera_minute')
                if body.watch_party:
                    kinds.append('watch_party')
                for kind in kinds:
                    if await rpc('record_badge_event', headers, {'transport_key': key, 'event_kind': kind}):
                        recorded.append(kind)
        unlocked = await rpc('sync_my_badges', headers, {})
        return {'ok': True, 'recorded': recorded, 'unlocked': unlocked or 0}

    @app.get('/api/badges/{user_id}')
    async def badge_state(user_id: UUID, identity=Depends(current_user)):
        return await rpc('badge_state', identity[1], {'target': str(user_id)})
