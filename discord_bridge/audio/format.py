"""Formato de áudio interno da ponte: PCM 16-bit, 48kHz, estéreo, frames de 20ms.

É o formato nativo dos dois lados (o voice_recv entrega 48k estéreo e o LiveKit
entrega o que pedirmos no AudioStream), então `to_bridge_format` normalmente só
devolve os bytes recebidos — o resample/remix existe apenas como fallback.
"""
import numpy as np

SAMPLE_RATE = 48000
CHANNELS = 2
FRAME_MS = 20
FRAME_SECONDS = FRAME_MS / 1000
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000          # 960
FRAME_BYTES = SAMPLES_PER_FRAME * CHANNELS * 2              # 3840
SILENCE_FRAME = b'\x00' * FRAME_BYTES


def to_bridge_format(pcm: bytes, sample_rate: int, channels: int) -> bytes:
    """Converte PCM int16 intercalado para 48kHz estéreo; sem custo se já estiver nele."""
    if sample_rate == SAMPLE_RATE and channels == CHANNELS:
        return pcm
    samples = np.frombuffer(pcm, dtype=np.int16).reshape(-1, channels)
    if channels == 1:
        samples = np.repeat(samples, 2, axis=1)
    elif channels > 2:
        samples = samples[:, :2]
    if sample_rate != SAMPLE_RATE and len(samples):
        # interpolação linear: suficiente para voz e só usada se um lado mudar de taxa
        out_len = round(len(samples) * SAMPLE_RATE / sample_rate)
        src_pos = np.arange(len(samples))
        dst_pos = np.linspace(0, len(samples) - 1, out_len)
        samples = np.stack([np.interp(dst_pos, src_pos, samples[:, c]) for c in range(2)], axis=1)
    return np.ascontiguousarray(samples, dtype=np.int16).tobytes()


def peak(pcm: bytes) -> int:
    """Pico absoluto de um frame int16 (usado em métricas e no teste local)."""
    if not pcm:
        return 0
    return int(np.abs(np.frombuffer(pcm, dtype=np.int16).astype(np.int32)).max())
