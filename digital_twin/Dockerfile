# Hito 5.4.1 — Digital Twin: imagen Docker para Fly.io
FROM python:3.11-slim AS runtime

WORKDIR /app

# Dependencias del sistema mínimas
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar deps Python
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY . /app/digital_twin

ENV PYTHONUNBUFFERED=1
ENV PORT=8090

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/health || exit 1

CMD ["uvicorn", "digital_twin.main:app", "--host", "0.0.0.0", "--port", "8090"]
