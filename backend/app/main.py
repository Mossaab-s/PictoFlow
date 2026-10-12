"""ASGI entry point: python -m uvicorn app.main:app."""

from app.api.application import create_app

app = create_app()
