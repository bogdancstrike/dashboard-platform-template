# Docling, CPU only, for "Ask your documents" (§44). Adapted from Horizon's
# deploy/docling: models are downloaded at build time and the running
# container converts offline. The layers up to `uv sync` are kept identical to
# Horizon's (pyproject.toml and uv.lock included) so a machine that built one
# reuses the cache for the other.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /uvx /bin/
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-calc libreoffice-impress ffmpeg libmagic1 libgl1 libglib2.0-0 \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-ron fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" \
    CUDA_VISIBLE_DEVICES="" NVIDIA_VISIBLE_DEVICES=void DOCLING_DEVICE=cpu DOCLING_NUM_THREADS=2 OMP_NUM_THREADS=2
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv apt-get update && apt-get install -y --no-install-recommends build-essential && \
    uv sync --frozen --no-dev && apt-get purge -y --auto-remove build-essential gcc g++ && rm -rf /var/lib/apt/lists/*
COPY nucleus_docling/prefetch.py /app/prefetch.py
RUN python /app/prefetch.py && chmod -R a+rX /models
RUN useradd -u 10001 -m docling
COPY nucleus_docling ./nucleus_docling
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HOME=/models/huggingface DOCLING_ARTIFACTS_PATH=/models HOME=/tmp
USER docling
CMD ["uvicorn", "nucleus_docling.server:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
