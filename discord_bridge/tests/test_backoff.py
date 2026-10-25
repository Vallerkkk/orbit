import random

from discord_bridge.bridge.backoff import Backoff


def test_grows_exponentially_and_caps():
    backoff = Backoff(base=1, factor=2, maximum=10, jitter=0)
    assert [backoff.next_delay() for _ in range(6)] == [1, 2, 4, 8, 10, 10]


def test_reset_starts_over():
    backoff = Backoff(base=0.5, jitter=0)
    backoff.next_delay()
    backoff.next_delay()
    backoff.reset()
    assert backoff.next_delay() == 0.5


def test_jitter_stays_within_bounds():
    backoff = Backoff(base=4, factor=1, jitter=0.25, rng=random.Random(1))
    delays = [backoff.next_delay() for _ in range(200)]
    assert all(3 <= d <= 5 for d in delays)
    assert len(set(delays)) > 1
