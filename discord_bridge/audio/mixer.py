"""Mixer multi-fonte: cada falante escreve PCM de qualquer tamanho; o consumidor
puxa exatamente um frame de 20ms por tick, com a soma de todos os falantes.

Thread-safe: no lado Discord, `push` vem da thread do voice_recv e `pull_frame`
da thread do AudioPlayer; no lado LiveKit, ambos vêm do event loop.
"""
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from .format import FRAME_BYTES, FRAME_MS, SILENCE_FRAME
from .jitter import AdaptiveJitterBuffer, JitterStats


@dataclass
class _Source:
    buffer: AdaptiveJitterBuffer
    last_push: float
    carry: bytearray = field(default_factory=bytearray)


@dataclass
class MixerSnapshot:
    sources: int
    buffered_ms: float      # maior atraso de buffer entre as fontes ativas
    jitter_ms: float        # maior jitter estimado entre as fontes ativas
    totals: JitterStats     # acumulado desde o início, inclusive fontes já removidas
    frames_mixed: int


class Mixer:
    def __init__(self, name: str, *, min_frames: int = 1, max_frames: int = 6, capacity: int = 25,
                 idle_timeout: float = 5.0, clock=time.monotonic):
        self.name = name
        self._buffer_kwargs = dict(min_frames=min_frames, max_frames=max_frames,
                                   capacity=capacity, clock=clock)
        self._idle_timeout = idle_timeout
        self._clock = clock
        self._sources: dict[object, _Source] = {}
        self._retired = JitterStats()
        self._frames_mixed = 0
        self._closed = False
        self._lock = threading.Lock()

    def push(self, source_id, pcm: bytes) -> None:
        """Acrescenta PCM 48k estéreo de uma fonte; fatiado em frames de 20ms."""
        if not pcm:
            return
        with self._lock:
            if self._closed:
                return
            now = self._clock()
            source = self._sources.get(source_id)
            if source is None:
                source = self._sources[source_id] = _Source(AdaptiveJitterBuffer(**self._buffer_kwargs), now)
            source.last_push = now
            source.carry += pcm
            while len(source.carry) >= FRAME_BYTES:
                source.buffer.push(bytes(source.carry[:FRAME_BYTES]))
                del source.carry[:FRAME_BYTES]

    def pull_frame(self) -> bytes:
        """Sempre devolve FRAME_BYTES: a soma (com clipping) dos falantes, ou silêncio."""
        with self._lock:
            frames = []
            now = self._clock()
            for source_id, source in list(self._sources.items()):
                frame = source.buffer.pop()
                if frame is not None:
                    frames.append(frame)
                elif source.buffer.depth == 0 and now - source.last_push > self._idle_timeout:
                    self._retire(source_id)
            if frames:
                self._frames_mixed += 1
        if not frames:
            return SILENCE_FRAME
        if len(frames) == 1:
            return frames[0]  # um falante só: nada a somar
        total = np.zeros(FRAME_BYTES // 2, dtype=np.int32)
        for frame in frames:
            total += np.frombuffer(frame, dtype=np.int16)
        return np.clip(total, -32768, 32767).astype(np.int16).tobytes()

    def remove(self, source_id) -> None:
        with self._lock:
            if source_id in self._sources:
                self._retire(source_id)

    def close_input(self) -> None:
        """Para de aceitar áudio novo (shutdown); o que já está bufferizado ainda sai."""
        with self._lock:
            self._closed = True

    def clear(self) -> None:
        with self._lock:
            for source_id in list(self._sources):
                self._retire(source_id)

    def snapshot(self) -> MixerSnapshot:
        with self._lock:
            totals = JitterStats(**vars(self._retired))
            buffered = jitter = 0.0
            for source in self._sources.values():
                for key, value in vars(source.buffer.stats).items():
                    setattr(totals, key, getattr(totals, key) + value)
                buffered = max(buffered, source.buffer.depth * FRAME_MS)
                jitter = max(jitter, source.buffer.jitter_ms)
            return MixerSnapshot(len(self._sources), buffered, jitter, totals, self._frames_mixed)

    def _retire(self, source_id) -> None:
        source = self._sources.pop(source_id)
        for key, value in vars(source.buffer.stats).items():
            setattr(self._retired, key, getattr(self._retired, key) + value)
