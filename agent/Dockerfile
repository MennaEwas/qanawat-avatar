# syntax=docker/dockerfile:1
# Qanawat Concierge — LiveKit agent worker

ARG PYTHON_VERSION=3.13
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS base

ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV HF_HOME=/app/.cache/huggingface
ENV TORCH_HOME=/app/.cache/torch

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc g++ python3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
RUN uv sync
# Pre-download plugin model files (turn detector, noise cancellation, ...).
RUN uv run --no-sync --module livekit.agents download-files
COPY . .

FROM base
RUN adduser --disabled-password --gecos "" --home /app --shell /sbin/nologin --uid 10001 appuser
COPY --from=build --chown=appuser:appuser /app /app
WORKDIR /app
USER appuser
# "start" connects the worker to LiveKit Cloud and waits for room jobs.
CMD ["uv", "run", "--no-sync", "src/agent.py", "start"]
