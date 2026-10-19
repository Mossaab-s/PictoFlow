"""Cookie authentication and server-side per-profile authorization."""

import hmac
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, SecretStr, StringConstraints

from app.application.access import (
    AccountView,
    ProfileCapability,
    ProfileRole,
    csrf_token,
    normalized_capabilities,
    permits,
    username,
)
from app.infrastructure.postgres.access import AccessConflict, Accounts

router = APIRouter(prefix="/api/v1/auth", tags=["Accounts"])


def accounts(request: Request):
    units = request.app.state.pcl_units
    if units is None:
        raise HTTPException(503, "Persistent storage unavailable")
    return Accounts(units.factory)


def cookie_name(request: Request):
    return (
        "__Host-pictoflow-session"
        if request.app.state.settings.auth_origin.startswith("https:")
        else "pictoflow-session"
    )


def origin_check(request: Request):
    if request.headers.get("origin") != request.app.state.settings.auth_origin:
        raise HTTPException(403, "Application origin required")


def authenticated(request: Request):
    account = accounts(request).current(request.cookies.get(cookie_name(request)))
    if account is None:
        raise HTTPException(401, "Authentication required")
    request.state.account = account
    unsafe = request.method not in ("GET", "HEAD", "OPTIONS")
    if unsafe:
        origin_check(request)
    # Existing browser tabs send their previous CSRF on reads too. Reject stale
    # credentials after cookie rotation, while normal image navigation stays possible.
    if unsafe or request.headers.get("x-csrf-token"):
        expected = csrf_token(request.cookies[cookie_name(request)])
        supplied = request.headers.get("x-csrf-token", "")
        if not re.fullmatch(r"[a-f0-9]{64}", supplied) or not hmac.compare_digest(
            supplied, expected
        ):
            raise HTTPException(403, "CSRF token required")
    return account


def require_access(request: Request):
    if not request.app.state.settings.auth_enabled:
        return
    route = request.scope["route"].path.removeprefix("/api/v1")
    if route == "/readiness" and request.method == "GET":
        return
    account = authenticated(request)
    if route == "/profiles" and request.method == "GET":
        return  # The endpoint filters the list by actual grants.
    profile_id = request.path_params.get("profile_id")
    if profile_id:
        try:
            profile_id = str(UUID(profile_id))
        except ValueError:
            raise HTTPException(404, "Profile not found") from None
    role = account.profile_access.get(str(profile_id)) if profile_id else None
    if profile_id and not role and not account.is_admin:
        raise HTTPException(404, "Profile not found")
    if not permits(
        account,
        role,
        request.method,
        route,
        capabilities=account.profile_capabilities.get(str(profile_id), ()),
    ):
        raise HTTPException(403, "Profile permission required")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        with accounts(request).factory.begin() as session:
            Accounts.event(
                session,
                "request_authorized",
                account.id,
                UUID(profile_id) if profile_id else None,
                ("accompanied: " if account.assisted_profile_id else "")
                + request.method
                + " "
                + route,
            )


def administrator(request: Request):
    if not request.app.state.settings.auth_enabled:
        raise HTTPException(404, "Account management is not enabled")
    account = authenticated(request)
    if not account.is_admin:
        raise HTTPException(403, "Administrator required")
    return account


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


LoginName = Annotated[str, Field(min_length=3, max_length=80), AfterValidator(username)]


class LoginBody(Body):
    username: LoginName
    password: SecretStr = Field(min_length=1, max_length=256)


class AccountBody(LoginBody):
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]
    password: SecretStr = Field(min_length=15, max_length=256)


class ActiveBody(Body):
    active: bool = Field(strict=True)
    expected_active: bool = Field(strict=True)


class PasswordBody(Body):
    password: SecretStr = Field(min_length=15, max_length=256)


class GrantBody(Body):
    role: ProfileRole | None
    expected_role: ProfileRole | None


CapabilitySelection = Annotated[
    tuple[ProfileCapability, ...],
    Field(min_length=1, max_length=6),
    AfterValidator(normalized_capabilities),
]


class CapabilityBody(Body):
    capabilities: CapabilitySelection | None
    expected_capabilities: CapabilitySelection | None


class AccompaniedBody(Body):
    profile_id: UUID


def session_cookie(request: Request, response: Response, token: str, seconds: int):
    response.set_cookie(
        cookie_name(request),
        token,
        max_age=seconds,
        path="/",
        secure=request.app.state.settings.auth_origin.startswith("https:"),
        httponly=True,
        samesite="strict",
    )


@router.post("/accompanied")
def accompanied(request: Request, response: Response, body: AccompaniedBody):
    if not request.app.state.settings.auth_enabled:
        raise HTTPException(404, "Authentication is not enabled")
    account = authenticated(request)
    if account.assisted_profile_id is not None:
        raise HTTPException(403, "Re-authentication required")
    granted = account.profile_capabilities.get(str(body.profile_id), ())
    if not account.is_admin and not granted:
        raise HTTPException(404, "Profile not found")
    if not account.is_admin and "communicate" not in granted:
        raise HTTPException(403, "Communication permission required")
    token, seconds = accounts(request).accompany(
        request.cookies[cookie_name(request)], body.profile_id
    )
    session_cookie(request, response, token, seconds)
    return {"account": accounts(request).current(token), "csrf_token": csrf_token(token)}


@router.get("/session")
def session(request: Request):
    enabled = request.app.state.settings.auth_enabled
    token = request.cookies.get(cookie_name(request))
    account = accounts(request).current(token) if enabled else None
    return {
        "enabled": enabled,
        "account": account,
        "csrf_token": csrf_token(token) if account else None,
    }


@router.post("/login")
def login(request: Request, response: Response, body: LoginBody):
    config = request.app.state.settings
    if not config.auth_enabled:
        raise HTTPException(404, "Authentication is not enabled")
    origin_check(request)
    token, state = accounts(request).login(
        body.username, body.password.get_secret_value(), config.auth_session_hours
    )
    if state == "limited":
        raise HTTPException(429, "Too many attempts; retry later", headers={"Retry-After": "900"})
    if state != "ok":
        raise HTTPException(401, "Invalid username or password")
    # Replace any prior browser session; supplied cookies never select the new token.
    previous = request.cookies.get(cookie_name(request))
    if previous:
        accounts(request).logout(previous)
    session_cookie(request, response, token, config.auth_session_hours * 3600)
    return {"account": accounts(request).current(token), "csrf_token": csrf_token(token)}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    if not request.app.state.settings.auth_enabled:
        raise HTTPException(404, "Authentication is not enabled")
    origin_check(request)
    token = request.cookies.get(cookie_name(request))
    account = accounts(request).current(token)
    if account:
        authenticated(request)
        if account.assisted_profile_id:
            with accounts(request).factory.begin() as db:
                Accounts.event(db, "accompanied_ended", account.id, account.assisted_profile_id)
    accounts(request).logout(token, account.id if account else None)
    response.delete_cookie(
        cookie_name(request),
        path="/",
        secure=request.app.state.settings.auth_origin.startswith("https:"),
        httponly=True,
        samesite="strict",
    )


@router.get("/users", response_model=tuple[AccountView, ...], dependencies=[Depends(administrator)])
def users(request: Request):
    return accounts(request).users()


@router.post(
    "/users", response_model=AccountView, status_code=201, dependencies=[Depends(administrator)]
)
def create_user(request: Request, body: AccountBody):
    try:
        return accounts(request).create(
            body.username,
            body.display_name,
            body.password.get_secret_value(),
            actor_id=request.state.account.id,
        )
    except AccessConflict:
        raise
    except ValueError:
        raise HTTPException(422, "Use a nonblank passphrase of 15 to 256 characters") from None


@router.patch(
    "/users/{user_id}/active", response_model=AccountView, dependencies=[Depends(administrator)]
)
def active_user(request: Request, user_id: UUID, body: ActiveBody):
    return accounts(request).change(
        user_id,
        actor_id=request.state.account.id,
        active=body.active,
        expected_active=body.expected_active,
    )


@router.post(
    "/users/{user_id}/password", response_model=AccountView, dependencies=[Depends(administrator)]
)
def reset_password(request: Request, user_id: UUID, body: PasswordBody):
    try:
        return accounts(request).change(
            user_id, actor_id=request.state.account.id, password=body.password.get_secret_value()
        )
    except AccessConflict:
        raise
    except ValueError:
        raise HTTPException(422, "Use a nonblank passphrase of 15 to 256 characters") from None


@router.put(
    "/users/{user_id}/profiles/{profile_id}", status_code=204, dependencies=[Depends(administrator)]
)
def profile_grant(request: Request, user_id: UUID, profile_id: UUID, body: GrantBody):
    accounts(request).grant(
        user_id, profile_id, body.role, body.expected_role, actor_id=request.state.account.id
    )


@router.put(
    "/users/{user_id}/profiles/{profile_id}/capabilities",
    status_code=204,
    dependencies=[Depends(administrator)],
)
def profile_capabilities(request: Request, user_id: UUID, profile_id: UUID, body: CapabilityBody):
    accounts(request).grant_capabilities(
        user_id,
        profile_id,
        body.capabilities,
        body.expected_capabilities,
        actor_id=request.state.account.id,
    )
