# syntax=docker/dockerfile:1.7

FROM python:3.11-slim AS runtime

WORKDIR /app

ARG TORCH_VERSION=2.11.0

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN grep -v '^torch' requirements.txt > requirements.runtime.txt \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==${TORCH_VERSION}" \
    && pip install --no-cache-dir -r requirements.runtime.txt

COPY . /app/rl_service

ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV RL_MODEL_PATH=/tmp/cruise_dispatch_ppo

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/health || exit 1

CMD ["uvicorn", "rl_service.main:app", "--host", "0.0.0.0", "--port", "8080"]
