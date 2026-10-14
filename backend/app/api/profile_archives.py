"""Bounded profile backup downloads, preview and explicitly confirmed restoration."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.api.business import units
from app.api.photos import schema
from app.application.profile_archive import (
    MAX_ARCHIVE_BYTES,
    MAX_RESTORE_BYTES,
    ArchiveTooLarge,
    ProfileArchive,
    RestoreRequest,
    archive_summary,
    parse_archive,
    parse_restore,
)
from app.domain.pcl.entities import UserCommunicationProfile
from app.infrastructure.postgres.profile_archives import PostgresProfileArchives

router = APIRouter(prefix="/api/v1/profiles", tags=["Profile backup"])


async def bounded_archive_body(request: Request, limit: int) -> bytes:
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(415, "JSON archive required")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > limit:
            raise ArchiveTooLarge("Archive request exceeds its limit")
        content.extend(chunk)
    return bytes(content)


@router.get("/{profile_id}/backup")
def backup(request: Request, profile_id: UUID):
    content = PostgresProfileArchives(units(request).factory).export(profile_id)
    return Response(
        content,
        media_type="application/json",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="pictoflow-profile-{profile_id}.json"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/restore-preview", openapi_extra=schema(ProfileArchive))
async def preview(request: Request):
    value = await bounded_archive_body(request, MAX_ARCHIVE_BYTES)
    snapshot = await run_in_threadpool(parse_archive, value)
    await run_in_threadpool(PostgresProfileArchives.preview, snapshot)
    return archive_summary(snapshot)


@router.post(
    "/restore",
    status_code=201,
    response_model=UserCommunicationProfile,
    openapi_extra=schema(RestoreRequest),
)
async def restore(request: Request):
    value = await bounded_archive_body(request, MAX_RESTORE_BYTES)
    parsed = await run_in_threadpool(parse_restore, value)
    service = PostgresProfileArchives(units(request).factory)
    return await run_in_threadpool(service.restore, parsed)
