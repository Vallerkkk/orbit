import threading

import numpy as np

from discord_bridge.audio.format import FRAME_BYTES, FRAME_SECONDS, SILENCE_FRAME
from discord_bridge.audio.mixer import Mixer

from .conftest import frame_of, samples


def make_mixer(clock, **kwargs):
    kwargs.setdefault('min_frames', 1)
    kwargs.setdefault('max_frames', 1)   # alvo 1: frame sai no pull seguinte, facilita os asserts
    return Mixer('test', clock=clock, **kwargs)


def test_silence_when_nobody_talks(clock):
    assert make_mixer(clock).pull_frame() == SILENCE_FRAME


def test_single_source_passes_through_untouched(clock):
    mixer = make_mixer(clock)
    mixer.push('a', frame_of(1234))
    assert mixer.pull_frame() == frame_of(1234)


def test_sums_sources(clock):
    mixer = make_mixer(clock)
    mixer.push('a', frame_of(1000))
    mixer.push('b', frame_of(-300))
    mixer.push('c', frame_of(50))
    assert (samples(mixer.pull_frame()) == 750).all()


def test_clips_instead_of_wrapping(clock):
    mixer = make_mixer(clock)
    mixer.push('a', frame_of(30000))
    mixer.push('b', frame_of(30000))
    assert (samples(mixer.pull_frame()) == 32767).all()
    mixer.push('c', frame_of(-30000))
    mixer.push('d', frame_of(-30000))
    assert (samples(mixer.pull_frame()) == -32768).all()


def test_reframes_irregular_chunks(clock):
    mixer = make_mixer(clock)
    data = frame_of(7) * 2
    mixer.push('a', data[:1000])
    assert mixer.pull_frame() == SILENCE_FRAME            # frame incompleto não sai
    mixer.push('a', data[1000:5000])
    assert mixer.pull_frame() == frame_of(7)
    mixer.push('a', data[5000:])
    assert mixer.pull_frame() == frame_of(7)
    assert mixer.pull_frame() == SILENCE_FRAME


def test_idle_sources_are_retired_but_stats_kept(clock):
    mixer = make_mixer(clock, idle_timeout=2.0)
    mixer.push('a', frame_of(1))
    mixer.pull_frame()
    assert mixer.snapshot().sources == 1
    clock.advance(3.0)
    mixer.pull_frame()
    snap = mixer.snapshot()
    assert snap.sources == 0
    assert snap.totals.frames_in == 1 and snap.totals.frames_out == 1


def test_close_input_drops_new_audio_but_drains_buffered(clock):
    mixer = make_mixer(clock, max_frames=3, min_frames=3)
    for _ in range(3):
        clock.advance(FRAME_SECONDS)
        mixer.push('a', frame_of(5))
    mixer.close_input()
    mixer.push('a', frame_of(9))
    out = [mixer.pull_frame() for _ in range(4)]
    assert out == [frame_of(5)] * 3 + [SILENCE_FRAME]


def test_snapshot_reports_buffer_latency(clock):
    mixer = make_mixer(clock, max_frames=6, min_frames=4)
    for _ in range(4):
        clock.advance(FRAME_SECONDS)
        mixer.push('a', frame_of(1))
    assert mixer.snapshot().buffered_ms == 80


def test_concurrent_push_and_pull_is_safe(clock):
    mixer = Mixer('threads', min_frames=1, max_frames=4, capacity=10)
    stop = threading.Event()
    errors = []

    def producer(source):
        while not stop.is_set():
            mixer.push(source, frame_of(1)[:FRAME_BYTES // 3])

    def consumer():
        try:
            for _ in range(2000):
                assert len(mixer.pull_frame()) == FRAME_BYTES
        except AssertionError as exc:
            errors.append(exc)

    threads = [threading.Thread(target=producer, args=(s,)) for s in 'abc']
    for t in threads:
        t.start()
    consumer()
    stop.set()
    for t in threads:
        t.join()
    assert not errors
