"""Environment configuration for the API adapter, outside the PCL domain."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Load prefixed environment variables and the repository's optional .env."""

    model_config = SettingsConfigDict(
        env_prefix="PICTOFLOW_",
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    app_name: str = Field(default="PictoFlow", min_length=1)
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    observability_enabled: bool = False
    database_url: SecretStr | None = None
    redis_url: SecretStr | None = None
    redis_timeout_seconds: float = Field(default=0.5, gt=0, le=10)
    auth_enabled: bool = False
    auth_origin: str = "http://127.0.0.1:3000"
    auth_session_hours: int = Field(default=8, ge=1, le=24)
    ai_provider: Literal["disabled", "fake", "openai-compatible", "prism"] = "disabled"
    fake_provider_fixtures: Path | None = None
    provider_base_url: str | None = None
    provider_api_key: SecretStr | None = None
    provider_model: str | None = None
    provider_response_format: Literal["json_object", "json_schema"] = "json_object"
    provider_timeout_seconds: float = Field(default=30.0, gt=0, le=120, allow_inf_nan=False)
    provider_temperature: float | None = Field(default=0.2, ge=0, le=2, allow_inf_nan=False)
    prism_capabilities: tuple[Literal["interpret", "simplify", "suggest_representation"], ...] = (
        "interpret",
        "simplify",
    )
    confidence_refusal: float = Field(default=0.40, ge=0, le=1, allow_inf_nan=False)
    confidence_confirmation: float = Field(default=0.65, ge=0, le=1, allow_inf_nan=False)
    confidence_direct: float = Field(default=0.90, ge=0, le=1, allow_inf_nan=False)
    gap_minimum_occurrences: int = Field(default=5, ge=1)
    gap_minimum_validated: int = Field(default=4, ge=1)

    @model_validator(mode="after")
    def consistent_policies(self):
        origin = urlsplit(self.auth_origin)
        if (
            origin.scheme not in ("http", "https")
            or not origin.hostname
            or origin.username is not None
            or origin.password is not None
            or origin.path not in ("", "/")
            or origin.query
            or origin.fragment
        ):
            raise ValueError("Authentication requires a single application origin")
        host = origin.hostname.encode("idna").decode().lower()
        if ":" in host:
            host = f"[{host}]"
        try:
            port = origin.port
        except ValueError:
            raise ValueError("Application origin port is invalid") from None
        if port == 0:
            raise ValueError("Application origin port is invalid")
        suffix = f":{port}" if port and port != (443 if origin.scheme == "https" else 80) else ""
        self.auth_origin = f"{origin.scheme}://{host}{suffix}"
        if self.auth_enabled and self.debug:
            raise ValueError("Disable debug responses when authentication is enabled")
        if self.auth_enabled and origin.scheme != "https":
            if self.environment == "production" or origin.hostname not in (
                "127.0.0.1",
                "localhost",
                "::1",
            ):
                raise ValueError("Authentication requires HTTPS outside local development")
        if not self.confidence_refusal < self.confidence_confirmation < self.confidence_direct:
            raise ValueError("Confidence thresholds must increase")
        if self.gap_minimum_validated > self.gap_minimum_occurrences:
            raise ValueError("Validated gap threshold exceeds occurrence threshold")
        return self

    @field_validator("database_url", "redis_url", mode="before")
    @classmethod
    def empty_optional_url(cls, value):
        return None if value == "" else value

    @field_validator("provider_temperature", mode="before")
    @classmethod
    def empty_temperature(cls, value):
        return None if value == "" else value
