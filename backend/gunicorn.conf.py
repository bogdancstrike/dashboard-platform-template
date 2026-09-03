"""Gunicorn configuration — `gunicorn -c gunicorn.conf.py wsgi:application`.

Gevent workers, because the work this API does is almost entirely waiting on
PostgreSQL. Greenlets let one worker hold hundreds of in-flight requests for
the price of a few megabytes, where the same concurrency in threads costs a
stack each and in processes costs a connection pool each.

Two settings are the ones people get wrong:

* **`post_fork` patches psycopg2.** Gevent's monkey patch makes sockets
  cooperative, but psycopg2 is a C extension that blocks in libpq regardless.
  `psycogreen` installs a wait callback so it yields. Without it every query
  stalls the entire worker, and the server gets *slower* as concurrency rises.
* **`preload_app` stays off.** Preloading forks the workers from a parent that
  has already built the app — including its SQLAlchemy engine, whose pooled
  sockets would then be shared by every child. Each worker builds its own.
"""

from __future__ import annotations

import multiprocessing
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


bind = f"{os.getenv('API_HOST', '0.0.0.0')}:{_int('API_PORT', 5101)}"
chdir = os.path.dirname(os.path.abspath(__file__))

worker_class = "gevent"
#: Two per core is the usual starting point for IO-bound gevent workers; each
#: one opens its own database pool, so this multiplies DB_POOL_SIZE.
workers = _int("WEB_CONCURRENCY", min(4, multiprocessing.cpu_count() * 2 + 1))
worker_connections = _int("WORKER_CONNECTIONS", 1000)

#: Generous, because exports and imports (§29, §30) are legitimately slow. The
#: work that outlives this belongs in a background job, not a request.
timeout = _int("GUNICORN_TIMEOUT", 120)
graceful_timeout = _int("GUNICORN_GRACEFUL_TIMEOUT", 30)
#: Slightly above a typical proxy's 60s idle timeout, so the proxy closes
#: connections rather than the worker closing one mid-response.
keepalive = _int("GUNICORN_KEEPALIVE", 65)

#: Recycling workers caps the damage any slow leak can do, and the jitter stops
#: every worker from retiring in the same second.
max_requests = _int("GUNICORN_MAX_REQUESTS", 2000)
max_requests_jitter = _int("GUNICORN_MAX_REQUESTS_JITTER", 200)

preload_app = False

accesslog = "-" if os.getenv("GUNICORN_ACCESS_LOG", "false").lower() in ("1", "true", "yes") else None
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info").lower()
capture_output = True

#: Trust the proxy's forwarded headers only from these peers.
forwarded_allow_ips = os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1")

proc_name = os.getenv("SERVICE_NAME", "platform-api")


def post_fork(server, worker):
    """Make psycopg2 cooperate with the event loop in each worker."""
    from psycogreen.gevent import patch_psycopg

    patch_psycopg()
    server.log.info(f"worker {worker.pid}: psycopg2 patched for gevent")


def when_ready(server):
    server.log.info(f"listening on {bind} with {workers} {worker_class} workers")
