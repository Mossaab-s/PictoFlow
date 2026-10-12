"""Versioned REST entry point for future application endpoints."""

from fastapi import APIRouter

from app.api.health import router as health_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
