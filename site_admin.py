"""Comandos de moderação do ADM global do app.

Defesa em duas camadas: (1) o FastAPI valida o JWT (current_user) e relê o cargo em
public.site_roles; (2) cada ação é uma função SECURITY DEFINER que repete a checagem com
auth.uid() e grava a auditoria. Nada do cliente (flag, localStorage) é considerado.
"""
from typing import Literal, Optional
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException
from livekit import api
from pydantic import BaseModel, Field
from upstream import client_for, read_json

DENIED = 'Somente administradores do app podem usar este comando.'


class Confirmed(BaseModel):
    confirm: str = Field(min_length=1, max_length=200)
    reason: str = Field(default='', max_length=500)


class Reason(BaseModel):
    reason: str = Field(default='', max_length=500)


class MemberCommand(BaseModel):
    action: Literal['remove', 'ban', 'unban']
    reason: str = Field(default='', max_length=500)


class Suspension(BaseModel):
    hours: int = Field(ge=0, le=87600)
    confirm: str = Field(default='', max_length=200)
    reason: str = Field(default='', max_length=500)


class Transfer(BaseModel):
    new_owner: UUID
    confirm: str = Field(min_length=1, max_length=200)
    reason: str = Field(default='', max_length=500)


class CallCommand(BaseModel):
    action: Literal['end_call', 'kick_participant']
    member: Optional[UUID] = None
    reason: str = Field(default='', max_length=500)


def install_site_admin(app, current_user, settings, is_site_admin):
    async def admin(identity=Depends(current_user)):
        if not await is_site_admin(identity):
            raise HTTPException(403, DENIED)
        return identity

    async def rpc(name, headers, body, method='POST', params=None):
        url = settings()['SUPABASE_URL'] + '/rest/v1/' + name
        try:
            async with client_for(app) as client:
                result = await client.request(method, url, headers=headers, json=body, params=params)
        except httpx.HTTPError:
            raise HTTPException(503, 'O serviço de dados está indisponível. Tente novamente.')
        if result.is_error:
            message = 'Não foi possível concluir o comando.'
            try:
                details = result.json()
                if isinstance(details, dict) and isinstance(details.get('message'), str):
                    message = details['message'][:250]
            except (ValueError, TypeError):
                pass
            if result.status_code == 404:
                raise HTTPException(503, 'Os comandos de administração ainda não foram instalados no banco.')
            raise HTTPException(403 if result.status_code in (401, 403) else 400 if result.status_code < 500 else 503, message)
        return read_json(result, (dict, list, bool, str, int, float, type(None))) if result.content else None

    def livekit():
        config = settings()
        if not all(config.get(key) for key in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
            return None
        return api.LiveKitAPI(config['LIVEKIT_URL'], config['LIVEKIT_API_KEY'], config['LIVEKIT_API_SECRET'])

    async def drop_everywhere(member, rooms=None):
        """Melhor esforço: tira a pessoa das chamadas ao vivo. A regra já vale no banco."""
        lk = livekit()
        if lk is None:
            return None
        try:
            async with lk:
                if rooms is None:
                    listed = await lk.room.list_rooms(api.ListRoomsRequest())
                    rooms = [room.name for room in listed.rooms]
                for room in rooms:
                    try:
                        await lk.room.remove_participant(api.RoomParticipantIdentity(room=room, identity=str(member)))
                    except api.TwirpError as error:
                        if error.code != 'not_found':
                            raise
        except Exception:
            return 'A ação foi salva, mas a chamada ao vivo não pôde ser atualizada agora.'
        return None

    @app.post('/api/admin/communities/{community_id}/delete')
    async def admin_delete_community(community_id: UUID, body: Confirmed, identity=Depends(admin)):
        await rpc('rpc/admin_delete_community', identity[1], {'community': str(community_id), 'confirm_name': body.confirm, 'reason_text': body.reason})
        return {'ok': True}

    @app.post('/api/admin/channels/{channel_id}/delete')
    async def admin_delete_channel(channel_id: UUID, body: Confirmed, identity=Depends(admin)):
        await rpc('rpc/admin_delete_channel', identity[1], {'channel': str(channel_id), 'confirm_name': body.confirm, 'reason_text': body.reason})
        warning = None
        lk = livekit()
        if lk is not None:
            try:
                async with lk:
                    await lk.room.delete_room(api.DeleteRoomRequest(room='channel-' + str(channel_id)))
            except Exception:
                pass
        return {'ok': True, 'warning': warning}

    @app.post('/api/admin/messages/{message_id}/delete')
    async def admin_delete_message(message_id: UUID, body: Reason, identity=Depends(admin)):
        await rpc('rpc/admin_delete_message', identity[1], {'message': str(message_id), 'reason_text': body.reason})
        return {'ok': True}

    @app.post('/api/admin/communities/{community_id}/members/{member_id}')
    async def admin_member(community_id: UUID, member_id: UUID, body: MemberCommand, identity=Depends(admin)):
        headers = identity[1]
        await rpc('rpc/admin_member_action', headers, {'community': str(community_id), 'member': str(member_id), 'action_name': body.action, 'reason_text': body.reason})
        warning = None
        if body.action in ('remove', 'ban'):
            try:
                channels = await rpc('channels', headers, None, method='GET', params={'community_id': f'eq.{community_id}', 'kind': 'eq.voice', 'select': 'id'})
                warning = await drop_everywhere(member_id, ['channel-' + c['id'] for c in channels or [] if isinstance(c, dict)])
            except HTTPException:
                warning = 'A ação foi salva, mas a chamada ao vivo não pôde ser atualizada agora.'
        return {'ok': True, 'warning': warning}

    @app.post('/api/admin/users/{member_id}/suspend')
    async def admin_suspend(member_id: UUID, body: Suspension, identity=Depends(admin)):
        await rpc('rpc/admin_suspend_account', identity[1], {'member': str(member_id), 'confirm_username': body.confirm, 'hours': body.hours, 'reason_text': body.reason})
        warning = await drop_everywhere(member_id) if body.hours else None
        return {'ok': True, 'warning': warning}

    @app.post('/api/admin/communities/{community_id}/transfer')
    async def admin_transfer(community_id: UUID, body: Transfer, identity=Depends(admin)):
        await rpc('rpc/admin_transfer_community', identity[1], {'community': str(community_id), 'new_owner': str(body.new_owner), 'confirm_name': body.confirm, 'reason_text': body.reason})
        return {'ok': True}

    @app.post('/api/admin/channels/{channel_id}/call')
    async def admin_call(channel_id: UUID, body: CallCommand, identity=Depends(admin)):
        if body.action == 'kick_participant' and body.member is None:
            raise HTTPException(422, 'Informe o participante.')
        await rpc('rpc/admin_call_action', identity[1], {'channel': str(channel_id), 'action_name': body.action, 'member': str(body.member) if body.member else None, 'reason_text': body.reason})
        lk = livekit()
        if lk is None:
            raise HTTPException(503, 'As chamadas não estão configuradas.')
        room = 'channel-' + str(channel_id)
        try:
            async with lk:
                if body.action == 'end_call':
                    await lk.room.delete_room(api.DeleteRoomRequest(room=room))
                else:
                    await lk.room.remove_participant(api.RoomParticipantIdentity(room=room, identity=str(body.member)))
        except api.TwirpError as error:
            if error.code != 'not_found':
                raise HTTPException(503, 'Não foi possível atualizar a chamada agora.')
        except Exception:
            raise HTTPException(503, 'Não foi possível atualizar a chamada agora.')
        return {'ok': True}

    @app.get('/api/admin/actions')
    async def admin_actions(identity=Depends(admin)):
        rows = await rpc('site_admin_actions', identity[1], None, method='GET', params={'select': '*', 'order': 'created_at.desc', 'limit': '50'})
        return {'actions': rows or []}
