"""Administrative provider settings and synthetic probes, outside personal PCL state."""

from typing import Literal
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.ai.contracts import InterpretationRequest, SelectedBlock
from app.ai.errors import (
    ProviderDisabledError,
    ProviderFixtureNotFound,
    ProviderPayloadError,
    ProviderUnavailableError,
    ProviderUnsupportedCapability,
)
from app.ai.manager import create_provider
from app.config import Settings


class ConfigurationConflict(Exception):
    pass


class ProviderOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    provider: Literal["disabled", "fake", "openai-compatible", "prism"]
    base_url: str | None = Field(default=None, max_length=2048)
    model: str | None = Field(default=None, max_length=128)
    response_format: Literal["json_object", "json_schema"] = "json_object"
    timeout_seconds: float = Field(default=30, gt=0, le=120, allow_inf_nan=False)
    temperature: float | None = Field(default=0.2, ge=0, le=2, allow_inf_nan=False)

    @field_validator("model", mode="before")
    @classmethod
    def trimmed_model(cls, value):
        return value.strip() or None if isinstance(value, str) else value

    @field_validator("base_url")
    @classmethod
    def normalized_url(cls, value):
        if not value:
            return None
        value = value.strip()
        try:
            url = urlsplit(value)
            if (
                url.scheme not in ("http", "https")
                or not url.hostname
                or url.username is not None
                or url.password is not None
                or url.query
                or url.fragment
                or any(ord(character) < 33 for character in value)
                or url.port == 0
            ):
                raise ValueError
            host = url.hostname.encode("idna").decode().lower()
            if ":" in host:
                host = f"[{host}]"
            port = url.port
            if port and port != (443 if url.scheme == "https" else 80):
                host += f":{port}"
            return urlunsplit((url.scheme, host, url.path.rstrip("/"), "", ""))
        except (ValueError, UnicodeError):
            raise ValueError("Invalid provider URL") from None

    @model_validator(mode="after")
    def external_configuration(self):
        if self.provider in ("openai-compatible", "prism") and not self.base_url:
            raise ValueError("An external provider URL is required")
        if self.provider == "openai-compatible" and not self.model:
            raise ValueError("A model is required")
        return self

    @classmethod
    def from_settings(cls, settings: Settings):
        return cls(
            provider=settings.ai_provider,
            base_url=settings.provider_base_url,
            model=settings.provider_model,
            response_format=settings.provider_response_format,
            timeout_seconds=settings.provider_timeout_seconds,
            temperature=settings.provider_temperature,
        )

    def settings(self, base: Settings, key: SecretStr | None):
        return Settings.model_validate(
            {
                **base.model_dump(),
                "ai_provider": self.provider,
                "provider_base_url": self.base_url,
                "provider_model": self.model,
                "provider_response_format": self.response_format,
                "provider_timeout_seconds": self.timeout_seconds,
                "provider_temperature": self.temperature,
                "provider_api_key": key,
            }
        )


class ConfigurationView(ProviderOptions):
    version: int
    source: Literal["environment", "admin"]
    api_key_configured: bool


class ConfigurationChange(ProviderOptions):
    expected_version: int = Field(ge=0, strict=True)
    key_action: Literal["keep", "replace", "clear"] = "keep"
    api_key: SecretStr | None = Field(default=None, min_length=1, max_length=4096, exclude=True)

    @model_validator(mode="after")
    def deliberate_key(self):
        if (self.key_action == "replace") != (self.api_key is not None):
            raise ValueError("Supply a new key only when replacing it")
        if self.api_key and any(ord(c) < 33 for c in self.api_key.get_secret_value()):
            raise ValueError("Invalid API key")
        return self

    def options(self):
        return ProviderOptions.model_validate(
            self.model_dump(exclude={"expected_version", "key_action"})
        )


class ProbeResult(BaseModel):
    connection: str
    generation: Literal[
        "proposal",
        "model_refusal",
        "invalid_payload",
        "unavailable",
        "disabled",
        "unsupported",
        "no_fixture",
    ]
    candidates: tuple[str, ...] = ()


def resolve_change(change, current_options, current_key, version):
    if change.expected_version != version:
        raise ConfigurationConflict
    options = change.options()
    if change.key_action == "keep":
        if current_key and (options.provider, options.base_url) != (
            current_options.provider,
            current_options.base_url,
        ):
            raise ValueError("Choose a new key or explicitly clear it for a different endpoint")
        key = current_key
    else:
        key = change.api_key if change.key_action == "replace" else None
    return options, key


async def probe_provider(settings: Settings, *, factory=create_provider):
    """No repository, profile identifier, real message or acceptance enters this probe."""
    provider = factory(settings)
    try:
        health = await provider.health()
        try:
            proposal = await provider.interpret(
                InterpretationRequest(
                    blocks=tuple(
                        SelectedBlock(block_id=UUID(int=index), label=word, meaning=word)
                        for index, word in enumerate(("Moi", "Boire", "Eau"), start=1)
                    )
                )
            )
            key = (
                settings.provider_api_key.get_secret_value() if settings.provider_api_key else None
            )
            texts = tuple(
                candidate.text.replace(key, "[clé masquée]") if key else candidate.text
                for candidate in proposal.candidates
            )
            return ProbeResult(
                connection=health.status,
                generation="model_refusal" if proposal.status == "not_understood" else "proposal",
                candidates=texts,
            )
        except ProviderDisabledError:
            generation = "disabled"
        except ProviderFixtureNotFound:
            generation = "no_fixture"
        except ProviderPayloadError:
            generation = "invalid_payload"
        except ProviderUnavailableError:
            generation = "unavailable"
        except ProviderUnsupportedCapability:
            generation = "unsupported"
        return ProbeResult(connection=health.status, generation=generation)
    finally:
        await provider.aclose()
