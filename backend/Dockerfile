# Local development image; includes the test/lint tools and editable application.
FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTEST_ADDOPTS="-p no:cacheprovider" \
    RUFF_CACHE_DIR=/tmp/ruff-cache

WORKDIR /workspace/backend

COPY backend/pyproject.toml backend/README.md ./
COPY backend/app ./app
RUN python -m pip install --no-cache-dir -e ".[dev]" \
    && useradd --create-home --uid 10001 pictoflow

COPY backend/migrations ./migrations
COPY backend/alembic.ini ./alembic.ini
COPY backend/tests ./tests
COPY backend/scripts ./scripts
COPY deploy /workspace/deploy
COPY .env.example /workspace/.env.example

USER pictoflow
EXPOSE 8000

ENTRYPOINT ["python", "scripts/container_entrypoint.py"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
