"""Registro das pontes ativas: no máximo uma por servidor do Discord (limite do
próprio Discord: um bot só tem uma conexão de voz por servidor), N servidores
por instância do bot."""
import asyncio

import structlog

from .session import BridgeSession

log = structlog.get_logger('bridge.manager')


class BridgeError(RuntimeError):
    pass


class BridgeManager:
    def __init__(self, max_bridges: int):
        self.max_bridges = max_bridges
        self.sessions: dict[object, BridgeSession] = {}
        self._lock = asyncio.Lock()

    async def enter(self, key, session_factory) -> tuple[BridgeSession, dict]:
        async with self._lock:
            if key in self.sessions:
                raise BridgeError('Já existe uma ponte ativa neste servidor. Use /bridge leave primeiro.')
            if len(self.sessions) >= self.max_bridges:
                raise BridgeError(f'Limite de {self.max_bridges} pontes simultâneas atingido nesta instância.')
            session: BridgeSession = session_factory()
            self.sessions[key] = session
        try:
            connected = await session.start()
        except Exception:
            self.sessions.pop(key, None)
            await session.stop(drain=False)
            raise
        return session, connected

    async def leave(self, key) -> bool:
        session = self.sessions.pop(key, None)
        if session is None:
            return False
        await session.stop()
        return True

    async def stop_all(self) -> None:
        sessions, self.sessions = list(self.sessions.values()), {}
        if sessions:
            log.info('stopping_all_bridges', count=len(sessions))
        await asyncio.gather(*(s.stop() for s in sessions), return_exceptions=True)
