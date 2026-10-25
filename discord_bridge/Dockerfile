FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# libopus: encode/decode Opus do discord.py · libsodium: criptografia de voz
# (o PyNaCl já embute a sua, mas fica disponível para o sistema).
# ffmpeg não é instalado: a ponte não toca arquivos, só PCM em memória.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libopus0 libsodium23 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/discord_bridge/requirements.txt
RUN pip install -r /app/discord_bridge/requirements.txt

COPY . /app/discord_bridge
RUN useradd --system --uid 10001 bridge
USER bridge

ENV HEALTH_HOST=0.0.0.0 HEALTH_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4)"

CMD ["python", "-m", "discord_bridge"]
