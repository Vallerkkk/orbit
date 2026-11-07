"""Painel Órbita: dados de moderação, sujeitos ao cargo global no servidor."""
import httpx
from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from livekit import api
from upstream import client_for, read_json

def install_admin_dashboard(app, current_user, settings, is_site_admin, root):
    async def authorized(identity=Depends(current_user)):
        if not await is_site_admin(identity):
            raise HTTPException(403, "Acesso restrito a administradores da Órbita.")
        return identity

    async def query(identity, path, params=None, method="GET", payload=None):
        async with client_for(app) as client:
            try:
                resp = await client.request(method, settings()["SUPABASE_URL"] + "/rest/v1/" + path,
                    headers=identity[1], params=params, json=payload)
            except httpx.HTTPError:
                raise HTTPException(503, "Supabase indisponível.")
        if resp.is_error:
            raise HTTPException(503, "Dados indisponíveis. Confira a migração SQL e as políticas RLS.")
        return read_json(resp, (list, dict)) if resp.content else []

    @app.get("/ADM")
    def page():
        return FileResponse(root / "static" / "adm.html", headers={"Cache-Control":"no-store"})

    @app.get("/api/adm/me")
    async def me(identity=Depends(authorized)):
        return {"id": identity[0]["id"], "role": "admin"}

    @app.get("/api/adm/overview")
    async def overview(identity=Depends(authorized)):
        users = await query(identity, "rpc/adm_member_summary", method="POST", payload={})
        logs = await query(identity, "site_admin_actions", {"select":"*","order":"created_at.desc","limit":"60"})
        rooms = []
        cfg = settings()
        if all(cfg.get(k) for k in ("LIVEKIT_URL","LIVEKIT_API_KEY","LIVEKIT_API_SECRET")):
            try:
                async with api.LiveKitAPI(cfg["LIVEKIT_URL"], cfg["LIVEKIT_API_KEY"], cfg["LIVEKIT_API_SECRET"]) as lk:
                    found = await lk.room.list_rooms(api.ListRoomsRequest())
                    rooms = [{"name":r.name,"participants":r.num_participants} for r in found.rooms]
            except Exception:
                pass
        return {"members":users, "logs":logs, "rooms":rooms,
                "counts":{"members":len(users), "recent_signins":sum(bool(u.get("recent_login")) for u in users),
                          "active_calls":len(rooms), "participants_in_calls":sum(r["participants"] for r in rooms)}}
