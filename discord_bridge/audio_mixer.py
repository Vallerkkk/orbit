"""Mixagem de PCM 16-bit estéreo a 48kHz usada pela ponte Discord <-> LiveKit."""
import numpy as np

SAMPLE_RATE = 48000
CHANNELS = 2
FRAME_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000          # 960
FRAME_BYTES = SAMPLES_PER_FRAME * CHANNELS * 2              # 3840
SILENCE_FRAME = b'\x00' * FRAME_BYTES


class RollingMixer:
    """Acumula pedaços de PCM vindos de fontes assíncronas e entrega frames fixos de 20ms.

    Vários falantes podem escrever a qualquer momento; `pull_frame` sempre devolve
    exatamente um frame (silêncio se nada chegou), somando amostras com clipping.
    """

    def __init__(self):
        self._buffer = np.zeros(0, dtype=np.int32)

    def add_pcm(self, pcm_bytes: bytes):
        if not pcm_bytes:
            return
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.int32)
        if len(samples) > len(self._buffer):
            self._buffer = np.pad(self._buffer, (0, len(samples) - len(self._buffer)))
        self._buffer[:len(samples)] += samples

    def pull_frame(self) -> bytes:
        needed = SAMPLES_PER_FRAME * CHANNELS
        if len(self._buffer) < needed:
            self._buffer = np.pad(self._buffer, (0, needed - len(self._buffer)))
        chunk, self._buffer = self._buffer[:needed], self._buffer[needed:]
        clipped = np.clip(chunk, -32768, 32767).astype(np.int16)
        return clipped.tobytes()
