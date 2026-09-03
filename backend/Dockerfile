# Nucleus API image.
#
# Two stages: the first resolves wheels — the vendored QF framework plus
# requirements.txt — into /install, the second copies that prefix onto a clean
# slim base. The runtime image carries no compiler and no pip cache.
#
# Build context is `backend/`, so paths here are relative to it and the
# frontend can own its own Dockerfile the same way.

FROM python:3.12-slim AS builder

WORKDIR /build

# Requirements first: this layer is cached until the dependency set itself
# changes, which is the difference between a 4-second rebuild and a 90-second
# one on every source edit.
COPY requirements.txt .
COPY dist/qf-1.0.5-py3-none-any.whl dist/

RUN pip install --no-cache-dir --prefix=/install \
    dist/qf-1.0.5-py3-none-any.whl \
    -r requirements.txt


FROM python:3.12-slim

COPY --from=builder /install /usr/local

# curl is here for the container healthcheck, nothing else.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    API_PORT=5101 \
    STORAGE_DIR=/app/backend/var/storage

RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app/backend
COPY . /app/backend/

# The uploads directory is a mount point in the stack; creating it here means
# the container still starts when nothing is mounted over it.
RUN mkdir -p /app/backend/var/storage /app/backend/instance && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 5101

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD curl -fsS "http://localhost:${API_PORT}/platform/health/live" || exit 1

# `-k gevent` is stated explicitly rather than left to gunicorn.conf.py: the
# worker class is the one setting that changes what the process *is*, and
# reading it off the command line beats grepping a config file. The rest —
# bind, worker count, timeouts, and the psycopg2 patch each worker needs — is
# in gunicorn.conf.py.
CMD ["gunicorn", "-k", "gevent", "-c", "gunicorn.conf.py", "wsgi:application"]
