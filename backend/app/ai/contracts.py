"""Bounded, provider-neutral transport contracts; never PCL validation commands."""

import json
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    model_validator,
)


def nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("Text must not be blank")
    return value


type Key = Annotated[
    str, Field(strict=True, min_length=1, max_length=128), AfterValidator(nonblank)
]
type ShortText = Annotated[
    str, Field(strict=True, min_length=1, max_length=256), AfterValidator(nonblank)
]
type Meaning = Annotated[
    str, Field(strict=True, min_length=1, max_length=512), AfterValidator(nonblank)
]
type MessageText = Annotated[
    str, Field(strict=True, min_length=1, max_length=4000), AfterValidator(nonblank)
]
type Description = Annotated[
    str, Field(strict=True, min_length=1, max_length=2000), AfterValidator(nonblank)
]
type Language = Annotated[
    str, Field(strict=True, min_length=2, max_length=35), AfterValidator(nonblank)
]
type Confidence = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
type NonnegativeNumber = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
type TokenCount = Annotated[int, Field(strict=True, ge=0)]
type Capability = Literal["interpret", "simplify", "suggest_representation"]


class Contract(BaseModel):
    """Reject unknown fields and forbid ordinary mutation of validated contracts."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        validate_default=True,
        revalidate_instances="always",
        allow_inf_nan=False,
        hide_input_in_errors=True,
    )


class ProviderMetadata(Contract):
    """Optional technical provenance, never semantic authority.

    Unrecognised vendor data belongs under extensions, not in a core proposal.
    """

    provider_id: Key | None = None
    trace_id: Key | None = None
    selected_model: Key | None = None
    selected_provider: Key | None = None
    routing_confidence: Confidence | None = None
    latency_ms: NonnegativeNumber | None = None
    input_tokens: TokenCount | None = None
    output_tokens: TokenCount | None = None
    cost: NonnegativeNumber | None = None
    extensions: Annotated[dict[Key, JsonValue], Field(max_length=32)] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded_metadata(self) -> Self:
        # Includes nested vendor data. Reject non-finite numbers even in extensions.
        try:
            encoded = json.dumps(self.model_dump(mode="json"), ensure_ascii=False, allow_nan=False)
        except (ValueError, TypeError, RecursionError):
            raise ValueError("Provider metadata must be finite JSON") from None
        if len(encoded.encode("utf-8")) > 16_384:
            raise ValueError("Provider metadata exceeds 16 KiB")
        return self


class SelectedBlock(Contract):
    """One selected block and its meaning supplied by the application."""

    block_id: UUID
    label: ShortText
    meaning: Meaning


class SemanticHint(Contract):
    """A bounded relation explicitly selected from validated PCL state by the caller."""

    source_meaning: Meaning
    target_meaning: Meaning
    relation_type: Literal[
        "associated_with",
        "often_followed_by",
        "often_preceded_by",
        "contextually_related_to",
        "shortcut_for",
    ]
    confidence: Confidence


class InterpretationRequest(Contract):
    """Ordered selected blocks; no repositories, complete profile or provider credentials."""

    blocks: Annotated[tuple[SelectedBlock, ...], Field(min_length=1, max_length=32)]
    declared_context: Annotated[tuple[ShortText, ...], Field(max_length=8)] = ()
    semantic_hints: Annotated[tuple[SemanticHint, ...], Field(max_length=16)] = ()
    language: Language = "fr"


class InterpretationCandidate(Contract):
    intent: Key
    text: MessageText
    confidence: Confidence


class InterpretationProposal(Contract):
    """Provider evidence only; a high score never marks anything validated."""

    status: Literal["proposal", "not_understood"] = "proposal"
    candidates: Annotated[tuple[InterpretationCandidate, ...], Field(max_length=3)] = ()
    metadata: ProviderMetadata | None = None

    @model_validator(mode="after")
    def consistent_result(self) -> Self:
        if self.status == "proposal" and not self.candidates:
            raise ValueError("A proposal requires at least one candidate")
        if self.status == "not_understood" and self.candidates:
            raise ValueError("A refusal must not include interpretation candidates")
        return self


class SimplificationRequest(Contract):
    text: MessageText
    allowed_meanings: Annotated[tuple[Meaning, ...], Field(max_length=64)] = ()
    language: Language = "fr"


class SimplificationProposal(Contract):
    status: Literal["proposal"] = "proposal"
    text: MessageText
    confidence: Confidence | None = None
    metadata: ProviderMetadata | None = None


class RepresentationRequest(Contract):
    """The caller must supply meaning already approved through the human workflow."""

    meaning: Meaning
    label: ShortText | None = None
    constraints: Annotated[tuple[ShortText, ...], Field(max_length=8)] = ()
    language: Language = "fr"


class RepresentationProposal(Contract):
    """Label/description suggestions, with no activation or validation capability."""

    status: Literal["proposal"] = "proposal"
    label: ShortText
    visual_description: Description | None = None
    spoken_text: MessageText | None = None
    confidence: Confidence | None = None
    metadata: ProviderMetadata | None = None


class ProviderHealth(Contract):
    provider_id: Key
    status: Literal["available", "unavailable", "disabled"]
    capabilities: Annotated[tuple[Capability, ...], Field(max_length=3)] = ()
    error_code: Key | None = None
    metadata: ProviderMetadata | None = None

    @model_validator(mode="after")
    def unique_capabilities(self) -> Self:
        if len(set(self.capabilities)) != len(self.capabilities):
            raise ValueError("Provider capabilities must not contain duplicates")
        return self
