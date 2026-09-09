"""SQLAlchemy engine and session scope.

The API runs under gunicorn + gevent workers, so this is the synchronous
psycopg2 engine with `psycogreen` patching applied in `wsgi.py`. One engine per
process, created lazily so importing a model never opens a socket.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from src.config import Config

#: Where a transaction records the datasets it changed, for the cache.
#:
#: On `session.info` rather than in a module variable, because gevent workers
#: interleave requests inside one process: a module-level set would attribute
#: one request's writes to another's transaction.
TOUCHED = "nucleus.touched_datasets"

_engine = None
_SessionLocal: sessionmaker | None = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(
            Config.DATABASE_URL,
            pool_size=Config.DB_POOL_SIZE,
            max_overflow=Config.DB_MAX_OVERFLOW,
            pool_timeout=Config.DB_POOL_TIMEOUT,
            pool_pre_ping=True,
            echo=Config.DB_ECHO,
            future=True,
        )
    return _engine


def _maker() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _SessionLocal


def touched(session: Session, *datasets: str) -> None:
    """Note that this transaction changed these datasets (§ caching).

    Recorded rather than acted on, because the cache must be invalidated
    *after* the commit and not before. Bumping a generation while the
    transaction is still open leaves a window in which another request
    recomputes from the pre-commit state and stores the answer under the new
    generation — a stale entry that now looks fresh. That is the race the
    whole after-commit hook exists to close.
    """
    names = session.info.setdefault(TOUCHED, set())
    names.update(name for name in datasets if name)


@event.listens_for(Session, "after_commit")
def _invalidate_aggregates(session: Session) -> None:
    """Bump the generation of every dataset the committed transaction changed.

    Registered once, on the `Session` class, so it covers every session in the
    process — including the seed's and a script's. A rolled-back transaction
    never reaches here, which is the point: an invalidation for a change that
    did not happen only costs a recomputation, but the reverse would serve a
    wrong number.
    """
    names = session.info.pop(TOUCHED, None)
    if not names:
        return
    from src.core import cache

    cache.bump(*sorted(names))


@contextmanager
def session_scope() -> Iterator[Session]:
    """Commit on success, roll back on error, always close."""
    session = _maker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def new_session() -> Session:
    """An unmanaged session, for scripts that drive their own transaction."""
    return _maker()()
