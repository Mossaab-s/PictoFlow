"""Administrator-only runtime configuration and explicit synthetic connection tests."""

from asyncio import timeout
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Request

from app.ai.configuration import (
    ConfigurationChange,
    ConfigurationConflict,
    ConfigurationView,
    ProbeResult,
    probe_provider,
)
from app.ai.manager import create_provider
from app.api.access import administrator
from app.infrastructure.postgres.provider_configuration import ProviderConfigurations

router = APIRouter(
    prefix="/api/v1/providers",
    tags=["Provider configuration"],
    dependencies=[Depends(administrator)],
)


def repository(request):
    units = request.app.state.pcl_units
    if units is None:
        raise HTTPException(503, "Persistent storage unavailable")
    return ProviderConfigurations(units.factory, request.app.state.settings)


@asynccontextmanager
async def active_provider(request):
    # Each operation holds its own immutable provider/settings snapshot. Switching
    # providers never closes another request's HTTP client or changes its provenance.
    settings = repository(request).override() if request.app.state.pcl_units else None
    if settings is None:
        yield request.app.state.ai_provider
        return
    provider = create_provider(settings, request.app.state.telemetry)
    try:
        yield provider
    finally:
        await provider.aclose()


def conflict_or_invalid(operation):
    try:
        return operation()
    except ConfigurationConflict:
        raise HTTPException(409, "Provider configuration changed; reload before saving") from None
    except ValueError:
        raise HTTPException(422, "Invalid provider settings or key action") from None


@router.get("/configuration", response_model=ConfigurationView)
def configuration(request: Request):
    return repository(request).view()


@router.put("/configuration", response_model=ConfigurationView)
def save(request: Request, body: ConfigurationChange):
    return conflict_or_invalid(lambda: repository(request).save(body, request.state.account.id))


@router.post("/test", response_model=ProbeResult)
async def test(request: Request, body: ConfigurationChange):
    settings = conflict_or_invalid(lambda: repository(request).preview(body))
    try:
        async with timeout(110):
            return await probe_provider(settings)
    except TimeoutError:
        return ProbeResult(connection="unavailable", generation="unavailable")
