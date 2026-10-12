"""Process liveness endpoint; dependency readiness is a separate future concern."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["healthy"] = "healthy"


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Report that the API can serve requests."""
    return HealthResponse()
