import numpy as np

from discord_bridge.audio.format import FRAME_BYTES, peak, to_bridge_format


def test_native_format_is_bypassed():
    pcm = bytes(range(256)) * 15
    assert to_bridge_format(pcm, 48000, 2) is pcm


def test_mono_is_upmixed_to_stereo():
    mono = np.array([1, -2, 3], dtype=np.int16).tobytes()
    out = np.frombuffer(to_bridge_format(mono, 48000, 1), dtype=np.int16)
    assert out.tolist() == [1, 1, -2, -2, 3, 3]


def test_resample_produces_one_bridge_frame_from_24k():
    mono_24k = np.zeros(480, dtype=np.int16).tobytes()   # 20ms a 24kHz
    assert len(to_bridge_format(mono_24k, 24000, 1)) == FRAME_BYTES


def test_peak():
    assert peak(np.array([3, -700, 12], dtype=np.int16).tobytes()) == 700
    assert peak(b'') == 0
