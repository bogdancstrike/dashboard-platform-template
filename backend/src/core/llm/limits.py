"""The per-process cap on concurrent and long model calls, and the fake header."""

from __future__ import annotations

import threading
from contextlib import contextmanager

from src.config import Config
from src.core.llm.results import LlmError

FAKE_HEADER = "X-Nucleus-LLM"


class _Expired(Exception):
    """Raised inside a call by the gevent timer when the time cap passes."""


def max_seconds() -> float:
    return max(0.05, float(Config.LLM_MAX_SECONDS or 30))


_slots: threading.BoundedSemaphore | None = None


_slots_size = 0


_slots_lock = threading.Lock()


def _semaphore() -> threading.BoundedSemaphore:
    global _slots, _slots_size
    size = max(1, int(Config.LLM_MAX_CONCURRENCY or 1))
    with _slots_lock:
        if _slots is None or _slots_size != size:
            _slots, _slots_size = threading.BoundedSemaphore(size), size
        return _slots


@contextmanager
def slot(timeout: float | None = None):
    """One of the LLM_MAX_CONCURRENCY slots, or LLM_BUSY within the time cap."""
    sem = _semaphore()
    if not sem.acquire(timeout=max_seconds() if timeout is None else timeout):
        raise LlmError("LLM_BUSY", "too many model calls in flight", retryable=True)
    try:
        yield
    finally:
        sem.release()


def _bounded(seconds: float, fn, *args, **kwargs):
    """Run fn with a hard wall-clock cap when the process is gevent-patched
    (gunicorn's workers are); otherwise the socket timeouts are the cap."""
    if seconds <= 0:
        raise LlmError("LLM_TIMEOUT", "the model took too long", retryable=True)
    try:
        from gevent import Timeout, monkey

        patched = monkey.is_module_patched("socket")
    except ImportError:  # pragma: no cover - gevent is a requirement
        patched = False
    if not patched:
        return fn(*args, **kwargs)
    try:  # pragma: no cover - exercised under gunicorn/gevent only
        with Timeout(seconds, _Expired):
            return fn(*args, **kwargs)
    except _Expired as exc:  # pragma: no cover
        raise LlmError("LLM_TIMEOUT", "the model took too long", retryable=True) from exc
