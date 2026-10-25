import numpy as np
import pytest

from discord_bridge.audio.format import FRAME_BYTES


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds: float):
        self.now += seconds


@pytest.fixture
def clock():
    return FakeClock()


def frame_of(value: int) -> bytes:
    """Frame de 20ms com todas as amostras iguais a `value`."""
    return np.full(FRAME_BYTES // 2, value, dtype=np.int16).tobytes()


def samples(frame: bytes) -> np.ndarray:
    return np.frombuffer(frame, dtype=np.int16)
