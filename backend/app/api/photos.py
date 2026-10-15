"""Bounded photo upload and scoped media reads; no external image URLs."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import Field, model_validator
from starlette.concurrency import run_in_threadpool

from app.api.business import Body, PersonalMeaning, units
from app.application.photos import MAX_ENCODED_LENGTH, PhotoService, decode_photo
from app.domain.pcl.entities import CommunicationBlock, HumanRole
from app.infrastructure.photos import normalize_photo

router = APIRouter(prefix="/api/v1/profiles/{profile_id}", tags=["Personal photos"])


class PhotoBody(Body):
    request_id: UUID
    actor_role: HumanRole
    photo_base64: str = Field(min_length=1, max_length=MAX_ENCODED_LENGTH)


class PhotoTouchBody(PhotoBody):
    label: str = Field(min_length=1, max_length=256)
    concept_id: UUID | None = None
    meaning: PersonalMeaning | None = None

    @model_validator(mode="after")
    def existing_meaning(self):
        if self.concept_id is not None and self.meaning is not None:
            raise ValueError("Choose an existing concept or a new personal meaning")
        return self


async def body(request: Request, model):
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        raise HTTPException(415, "JSON photo request required")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_ENCODED_LENGTH + 16_384:
            raise HTTPException(413, "Photo request too large")
        content.extend(chunk)
    return model.model_validate_json(content)


def schema(model):
    value = model.model_json_schema()
    definitions = value.pop("$defs", {})

    def inline(node):
        if isinstance(node, list):
            return [inline(item) for item in node]
        if isinstance(node, dict):
            if "$ref" in node:
                return inline(definitions[node["$ref"].rsplit("/", 1)[1]])
            return {key: inline(item) for key, item in node.items()}
        return node

    return {
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": inline(value)}},
        }
    }


@router.post(
    "/blocks/photo",
    status_code=201,
    response_model=CommunicationBlock,
    openapi_extra=schema(PhotoTouchBody),
)
async def create_photo_touch(request: Request, profile_id: UUID):
    value = await body(request, PhotoTouchBody)
    service = PhotoService(units(request))
    photo = await run_in_threadpool(normalize_photo, decode_photo(value.photo_base64))
    return await run_in_threadpool(
        service.create_touch,
        profile_id,
        value.request_id,
        value.label,
        photo,
        value.actor_role,
        value.concept_id,
        value.meaning,
    )


@router.put(
    "/blocks/{block_id}/photo", response_model=CommunicationBlock, openapi_extra=schema(PhotoBody)
)
async def replace_photo(request: Request, profile_id: UUID, block_id: UUID):
    value = await body(request, PhotoBody)
    service = PhotoService(units(request))
    photo = await run_in_threadpool(normalize_photo, decode_photo(value.photo_base64))
    return await run_in_threadpool(
        service.replace_photo, profile_id, block_id, value.request_id, photo, value.actor_role
    )


@router.get(
    "/representations/{representation_id}/photo",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
)
def read_photo(request: Request, profile_id: UUID, representation_id: UUID):
    photo = PhotoService(units(request)).read(profile_id, representation_id)
    return Response(
        photo.content,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": 'inline; filename="photo.jpg"',
        },
    )


@router.delete("/representations/{representation_id}/photo", status_code=204)
def remove_photo(
    request: Request, profile_id: UUID, representation_id: UUID, actor_role: HumanRole
):
    PhotoService(units(request)).remove(profile_id, representation_id, actor_role)
