"""Application factory; importing it does not load local configuration."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import __version__
from app.ai.errors import ProviderError, ProviderUnavailableError, ProviderUnsupportedCapability
from app.ai.manager import create_provider
from app.api.business import router as business_router
from app.api.health import router as health_router
from app.api.photos import router as photo_router
from app.api.profile_archives import router as archive_router
from app.api.router import router as api_router
from app.application.keyboard_groups import KeyboardOrganizationConflict
from app.application.offline_communication import OfflineConflict, OfflineSnapshotTooLarge
from app.application.photos import PhotoPayloadError
from app.application.profile_archive import ArchiveError, ArchiveTooLarge, RestoreConflict
from app.application.repositories import ProfileVersionConflict
from app.application.semantic_space import SemanticNotFoundError
from app.application.transient import TransientStoreUnavailable
from app.config import Settings
from app.domain.pcl.invariants import DomainInvariantError
from app.infrastructure.postgres.database import create_database_engine, create_session_factory
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits
from app.infrastructure.redis.factory import create_transient_store
from app.observability import HTTPInstrumentation, Telemetry


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create an API instance without requiring a database, Redis or AI provider."""
    config = settings if settings is not None else Settings()
    telemetry = Telemetry(config.observability_enabled)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.ai_provider = create_provider(config, telemetry)
        store = create_transient_store(config)
        application.state.transient_store = store
        engine = create_database_engine(config) if config.database_url else None
        application.state.pcl_units = (
            PostgresPCLUnits(create_session_factory(engine)) if engine else None
        )
        try:
            yield
        finally:
            await store.aclose()
            await application.state.ai_provider.aclose()
            if engine is not None:
                engine.dispose()
            telemetry.close()

    application = FastAPI(
        title=config.app_name, version=__version__, debug=config.debug, lifespan=lifespan
    )
    application.state.settings = config
    application.state.telemetry = telemetry
    application.add_middleware(HTTPInstrumentation, telemetry=telemetry)
    application.include_router(health_router)
    application.include_router(api_router)
    application.include_router(archive_router)
    application.include_router(business_router)
    application.include_router(photo_router)

    # Errors contain only technical classes. Never echo request values or driver diagnostics.
    def handler(status: int, message: str):
        async def redacted_error(request, error):
            if isinstance(error, SQLAlchemyError):
                telemetry.signal("database.error", error_class=type(error).__name__)
            elif isinstance(error, TransientStoreUnavailable):
                telemetry.signal("redis.availability", availability="unavailable")
            return JSONResponse(
                status_code=status,
                content={"detail": message},
                headers={"Connection": "close"} if status == 413 else None,
            )

        return redacted_error

    for error_type, status, message in (
        (RequestValidationError, 422, "Invalid request"),
        (ValidationError, 422, "Invalid value"),
        (ArchiveTooLarge, 413, "Profile archive too large"),
        (RestoreConflict, 409, "Restore request already used for another archive"),
        (ArchiveError, 422, "Invalid profile archive"),
        (PhotoPayloadError, 422, "Invalid photo; use a static JPEG, PNG or WebP under 5 MiB"),
        (DomainInvariantError, 400, "Invalid PCL transition"),
        (SemanticNotFoundError, 404, "Object not found in this profile"),
        (IntegrityError, 409, "Conflicting persistent state"),
        (ProfileVersionConflict, 409, "Profile changed; reload before renaming"),
        (OfflineConflict, 409, "Keyboard or offline request changed; retain draft and review"),
        (OfflineSnapshotTooLarge, 413, "Offline media snapshot too large"),
        (
            KeyboardOrganizationConflict,
            409,
            "Keyboard changed or place unavailable; reload and preview again",
        ),
        (SQLAlchemyError, 503, "Persistent storage unavailable"),
        (TransientStoreUnavailable, 503, "Transient storage unavailable"),
        (ProviderUnsupportedCapability, 501, "Provider capability unavailable"),
        (ProviderUnavailableError, 503, "Provider unavailable"),
        (ProviderError, 502, "Provider operation failed"),
    ):
        application.add_exception_handler(error_type, handler(status, message))
    return application
