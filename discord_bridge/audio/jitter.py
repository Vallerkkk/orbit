"""Jitter buffer adaptativo por fonte de áudio.

Cada falante (usuário do Discord ou track do LiveKit) tem o seu. Frames de 20ms
chegam no ritmo da rede e saem no ritmo do relógio do lado consumidor; o buffer
absorve a variação de chegada (jitter) e a diferença entre os dois relógios (drift).

- O alvo de profundidade acompanha o jitter medido (estimador estilo RFC 3550).
- Só começa a tocar quando atinge o alvo; se esvaziar no meio da fala, conta um
  underrun e volta a acumular.
- Se ficar acima do alvo + folga, descarta o frame mais antigo (correção de drift,
  mantém a latência baixa).
- `capacity` é o teto rígido (backpressure): nunca guarda mais que isso.
"""
import math
import time
from collections import deque
from dataclasses import dataclass

from .format import FRAME_SECONDS


@dataclass
class JitterStats:
    frames_in: int = 0
    frames_out: int = 0
    underruns: int = 0
    drift_drops: int = 0
    overflow_drops: int = 0


class AdaptiveJitterBuffer:
    DRIFT_SLACK = 2           # frames acima do alvo tolerados antes de descartar
    IDLE_GAP = 0.1            # sem chegada há mais que isso = pessoa parou de falar, não underrun

    def __init__(self, *, min_frames: int = 1, max_frames: int = 6, capacity: int = 25,
                 clock=time.monotonic):
        if not 1 <= min_frames <= max_frames <= capacity:
            raise ValueError('esperado 1 <= min_frames <= max_frames <= capacity')
        self.min_frames = min_frames
        self.max_frames = max_frames
        self.capacity = capacity
        self._clock = clock
        self._frames: deque[bytes] = deque()
        self._jitter = 0.0
        self._last_arrival: float | None = None
        self._playing = False
        self.target = min(min_frames + 1, max_frames)
        self.stats = JitterStats()

    @property
    def depth(self) -> int:
        return len(self._frames)

    @property
    def jitter_ms(self) -> float:
        return self._jitter * 1000

    @property
    def last_arrival(self) -> float | None:
        return self._last_arrival

    def push(self, frame: bytes) -> None:
        now = self._clock()
        if self._last_arrival is not None:
            gap = now - self._last_arrival
            if gap < 1.0:  # pausas longas de fala não entram na estimativa
                self._jitter += (abs(gap - FRAME_SECONDS) - self._jitter) / 16
                # -0.05 evita que ruído de ponto flutuante num fluxo estável suba o alvo
                wanted = 1 + math.ceil(2 * self._jitter / FRAME_SECONDS - 0.05)
                self.target = max(self.min_frames, min(self.max_frames, wanted))
        self._last_arrival = now

        self._frames.append(frame)
        self.stats.frames_in += 1
        while len(self._frames) > self.capacity:
            self._frames.popleft()
            self.stats.overflow_drops += 1

    def pop(self) -> bytes | None:
        if not self._playing:
            if len(self._frames) < self.target:
                return None
            self._playing = True
        if not self._frames:
            self._playing = False
            if self._last_arrival is not None and self._clock() - self._last_arrival < self.IDLE_GAP:
                self.stats.underruns += 1
            return None
        while len(self._frames) > self.target + self.DRIFT_SLACK:
            self._frames.popleft()
            self.stats.drift_drops += 1
        self.stats.frames_out += 1
        return self._frames.popleft()

    def clear(self) -> None:
        self._frames.clear()
        self._playing = False
