"""Backoff exponencial com jitter, usado na reconexão dos dois lados da ponte."""
import random


class Backoff:
    def __init__(self, *, base: float = 1.0, factor: float = 2.0, maximum: float = 60.0,
                 jitter: float = 0.2, rng: random.Random | None = None):
        self.base = base
        self.factor = factor
        self.maximum = maximum
        self.jitter = jitter
        self._rng = rng or random.Random()
        self.attempts = 0

    def next_delay(self) -> float:
        raw = min(self.maximum, self.base * self.factor ** self.attempts)
        self.attempts += 1
        spread = raw * self.jitter
        return max(0.0, raw + self._rng.uniform(-spread, spread))

    def reset(self) -> None:
        self.attempts = 0
