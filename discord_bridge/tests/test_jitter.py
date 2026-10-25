import pytest

from discord_bridge.audio.format import FRAME_SECONDS
from discord_bridge.audio.jitter import AdaptiveJitterBuffer

from .conftest import frame_of


def steady_push(buf, clock, count, gap=FRAME_SECONDS, start=0):
    for i in range(count):
        clock.advance(gap)
        buf.push(frame_of(start + i))


def test_waits_for_target_before_playing(clock):
    buf = AdaptiveJitterBuffer(min_frames=1, max_frames=6, clock=clock)
    assert buf.target == 2
    buf.push(frame_of(1))
    assert buf.pop() is None            # ainda acumulando
    clock.advance(FRAME_SECONDS)
    buf.push(frame_of(2))
    assert buf.pop() == frame_of(1)     # alvo atingido: sai em ordem
    assert buf.pop() == frame_of(2)


def test_steady_stream_keeps_minimal_target(clock):
    buf = AdaptiveJitterBuffer(min_frames=1, max_frames=6, clock=clock)
    steady_push(buf, clock, 50)
    assert buf.jitter_ms == pytest.approx(0, abs=0.01)
    assert buf.target == 1


def test_target_grows_with_jitter_and_respects_max(clock):
    buf = AdaptiveJitterBuffer(min_frames=1, max_frames=4, clock=clock)
    for i in range(200):
        clock.advance(0.0 if i % 2 else 0.08)   # rajadas: 80ms de espera e depois 2 juntos
        buf.push(frame_of(i))
    assert buf.jitter_ms > 20
    assert buf.target == 4


def test_underrun_counted_mid_speech_but_not_after_speaker_stops(clock):
    buf = AdaptiveJitterBuffer(min_frames=1, max_frames=6, clock=clock)
    steady_push(buf, clock, 3)
    while buf.pop() is not None:
        pass
    assert buf.stats.underruns == 1      # esvaziou logo após uma chegada: underrun real
    clock.advance(1.0)                    # pessoa parou de falar
    assert buf.pop() is None
    assert buf.stats.underruns == 1


def test_drift_correction_drops_oldest_frames(clock):
    buf = AdaptiveJitterBuffer(min_frames=1, max_frames=6, capacity=50, clock=clock)
    steady_push(buf, clock, 10)          # produtor adiantado: 10 frames acumulados
    out = buf.pop()
    assert buf.stats.drift_drops == 10 - (buf.target + buf.DRIFT_SLACK)
    assert out == frame_of(buf.stats.drift_drops)
    assert buf.depth == buf.target + buf.DRIFT_SLACK - 1


def test_capacity_is_hard_backpressure(clock):
    buf = AdaptiveJitterBuffer(min_frames=1, max_frames=2, capacity=5, clock=clock)
    steady_push(buf, clock, 12)
    assert buf.depth == 5
    assert buf.stats.overflow_drops == 7


def test_rejects_invalid_bounds():
    with pytest.raises(ValueError):
        AdaptiveJitterBuffer(min_frames=4, max_frames=2)
