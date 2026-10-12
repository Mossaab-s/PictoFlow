import inspect
import json
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.ai.contracts import (
    InterpretationCandidate,
    InterpretationProposal,
    InterpretationRequest,
    ProviderHealth,
    ProviderMetadata,
    RepresentationProposal,
    RepresentationRequest,
    SelectedBlock,
    SemanticHint,
    SimplificationProposal,
    SimplificationRequest,
)
from app.ai.protocol import AIProvider


@pytest.fixture
def candidate_payload():
    return {
        "intent": "LEAVE_DUE_TO_NOISE",
        "text": "Le bruit me gêne et je veux partir.",
        "confidence": 0.78,
    }


def test_interpretation_request_preserves_order_and_repeated_selections():
    noise = SelectedBlock(block_id=uuid4(), label="Bruit", meaning="NOISE")
    leave = SelectedBlock(block_id=uuid4(), label="Partir", meaning="LEAVE")
    request = InterpretationRequest(
        blocks=[noise, leave, noise],
        declared_context=["À la maison"],
        semantic_hints=[
            SemanticHint(
                source_meaning="NOISE",
                target_meaning="LEAVE",
                relation_type="associated_with",
                confidence=0.84,
            )
        ],
    )
    assert request.blocks == (noise, leave, noise)
    assert InterpretationRequest.model_validate_json(request.model_dump_json()) == request


def test_provider_payload_matches_architecture_example(candidate_payload):
    proposal = InterpretationProposal.model_validate_json(
        json.dumps(
            {
                "status": "proposal",
                "candidates": [candidate_payload],
            }
        )
    )
    assert proposal.status == "proposal"
    assert proposal.candidates[0].confidence == 0.78
    assert proposal.metadata is None


@pytest.mark.parametrize("confidence", [-0.01, 1.01, float("nan"), float("inf"), "0.8", True])
def test_invalid_confidence_is_rejected(candidate_payload, confidence):
    candidate_payload["confidence"] = confidence
    with pytest.raises(ValidationError):
        InterpretationCandidate.model_validate(candidate_payload)


@pytest.mark.parametrize("confidence", [0, 0.4, 0.65, 0.9, 1])
def test_confidence_boundaries_remain_unvalidated(candidate_payload, confidence):
    candidate_payload["confidence"] = confidence
    proposal = InterpretationProposal(candidates=[candidate_payload])
    assert proposal.status == "proposal"
    assert proposal.candidates[0].confidence == confidence


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"intent": "LEAVE", "text": "Partir"},
        {"intent": "", "text": "Partir", "confidence": 0.8},
        {"intent": "LEAVE", "text": "  ", "confidence": 0.8},
        {"intent": "LEAVE", "text": 123, "confidence": 0.8},
        {"intent": "LEAVE", "text": "Partir", "confidence": 0.8, "validated": True},
    ],
)
def test_malformed_candidates_fail_validation(payload):
    with pytest.raises(ValidationError):
        InterpretationCandidate.model_validate(payload)


@pytest.mark.parametrize(
    "status", ["validated", "confirmed", "corrected", "active", "confirmation_required"]
)
def test_provider_cannot_choose_pcl_validation_or_confidence_policy(candidate_payload, status):
    with pytest.raises(ValidationError):
        InterpretationProposal(status=status, candidates=[candidate_payload])


def test_refusal_cannot_carry_a_meaning(candidate_payload):
    assert InterpretationProposal(status="not_understood").candidates == ()
    with pytest.raises(ValidationError):
        InterpretationProposal(status="not_understood", candidates=[candidate_payload])
    with pytest.raises(ValidationError):
        InterpretationProposal()


def test_interpretation_candidate_count_is_bounded(candidate_payload):
    assert len(InterpretationProposal(candidates=[candidate_payload] * 3).candidates) == 3
    with pytest.raises(ValidationError):
        InterpretationProposal(candidates=[candidate_payload] * 4)


def test_simplification_contracts_are_provider_neutral():
    request = SimplificationRequest(
        text="Le bruit me gêne et je veux partir.", allowed_meanings=["NOISE", "LEAVE"]
    )
    proposal = SimplificationProposal(text="Je veux partir.")
    assert SimplificationRequest.model_validate_json(request.model_dump_json()) == request
    assert SimplificationProposal.model_validate_json(proposal.model_dump_json()) == proposal
    assert (
        proposal.status == "proposal" and proposal.confidence is None and proposal.metadata is None
    )


def test_representation_contracts_are_proposals_only():
    request = RepresentationRequest(
        meaning="Le bruit me gêne, je veux sortir.", constraints=["Fond simple"]
    )
    proposal = RepresentationProposal(
        label="Sortir",
        visual_description="Une porte ouverte.",
        spoken_text="Je veux sortir.",
        confidence=0.8,
    )
    assert RepresentationRequest.model_validate_json(request.model_dump_json()) == request
    assert RepresentationProposal.model_validate_json(proposal.model_dump_json()) == proposal
    assert proposal.status == "proposal" and proposal.metadata is None


@pytest.mark.parametrize(
    "model,payload",
    [
        (SimplificationProposal, {"text": "Partir", "status": "validated"}),
        (RepresentationProposal, {"label": "Partir", "activate": True}),
        (RepresentationProposal, {"label": "Partir", "validated": True}),
        (RepresentationRequest, {"meaning": "Partir", "approved": True}),
        (SimplificationRequest, {"text": "Partir", "memory": {"entire_profile": []}}),
        (InterpretationRequest, {"blocks": [], "repositories": {}}),
    ],
)
def test_unknown_fields_cannot_smuggle_authority_or_unbounded_state(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(
    "model,payload",
    [
        (InterpretationRequest, {"blocks": []}),
        (SimplificationRequest, {"text": "x" * 4001}),
        (SimplificationRequest, {"text": "Partir", "allowed_meanings": ["NOISE"] * 65}),
        (RepresentationRequest, {"meaning": "x" * 513}),
        (RepresentationRequest, {"meaning": "Partir", "constraints": ["Simple"] * 9}),
        (RepresentationProposal, {"label": "Partir", "visual_description": "x" * 2001}),
    ],
)
def test_request_and_output_sizes_are_bounded(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


def test_interpretation_context_and_selection_limits():
    block = SelectedBlock(block_id=uuid4(), label="Bruit", meaning="NOISE")
    hint = SemanticHint(
        source_meaning="NOISE",
        target_meaning="LEAVE",
        relation_type="associated_with",
        confidence=0.84,
    )
    for payload in (
        {"blocks": [block] * 33},
        {"blocks": [block], "declared_context": ["Maison"] * 9},
        {"blocks": [block], "semantic_hints": [hint] * 17},
    ):
        with pytest.raises(ValidationError):
            InterpretationRequest.model_validate(payload)


def test_metadata_is_optional_and_vendor_data_stays_in_extensions(candidate_payload):
    metadata = ProviderMetadata(
        trace_id="trace-1",
        routing_confidence=0.9,
        selected_model="local-model",
        extensions={"prism": {"domain": "communication", "refusal": False}},
    )
    proposal = InterpretationProposal(candidates=[candidate_payload], metadata=metadata)
    reloaded = InterpretationProposal.model_validate_json(proposal.model_dump_json())
    assert reloaded.metadata.extensions["prism"]["domain"] == "communication"
    assert reloaded.metadata.routing_confidence == 0.9
    assert reloaded.status == "proposal"
    assert ProviderMetadata().provider_id is None


@pytest.mark.parametrize(
    "payload",
    [
        {"routing_confidence": 1.1},
        {"latency_ms": -1},
        {"input_tokens": True},
        {"extensions": {"score": float("inf")}},
        {"extensions": {"raw": "x" * 16_384}},
        {"extensions": {str(index): index for index in range(33)}},
        {"prism_trace_id": "trace-1"},
    ],
)
def test_invalid_or_unbounded_metadata_is_rejected(payload):
    with pytest.raises(ValidationError):
        ProviderMetadata.model_validate(payload)


@pytest.mark.parametrize("status", ["available", "unavailable", "disabled"])
def test_health_does_not_require_vendor_metadata(status):
    health = ProviderHealth(provider_id="local", status=status, capabilities=["interpret"])
    assert health.metadata is None
    assert ProviderHealth.model_validate_json(health.model_dump_json()) == health


@pytest.mark.parametrize(
    "payload",
    [
        {"provider_id": "local", "status": "unknown"},
        {"provider_id": "local", "status": "available", "capabilities": ["interpret", "interpret"]},
        {"provider_id": "local", "status": "available", "capabilities": ["validate"]},
    ],
)
def test_invalid_health_or_capability_is_rejected(payload):
    with pytest.raises(ValidationError):
        ProviderHealth.model_validate(payload)


def test_proposal_cannot_be_mutated_into_validated_state(candidate_payload):
    proposal = InterpretationProposal(candidates=[candidate_payload])
    with pytest.raises(ValidationError):
        proposal.status = "validated"
    with pytest.raises(ValidationError):
        proposal.candidates[0].confidence = 1.5
    assert isinstance(proposal.candidates, tuple)


@pytest.mark.parametrize(
    "model,payload",
    [
        (SimplificationProposal, {"text": "Partir", "confidence": 1.1}),
        (RepresentationProposal, {"label": "Partir", "confidence": -0.1}),
        (
            SemanticHint,
            {
                "source_meaning": "NOISE",
                "target_meaning": "LEAVE",
                "relation_type": "associated_with",
                "confidence": True,
            },
        ),
    ],
)
def test_confidence_bounds_apply_to_every_operation(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


def test_nested_model_instances_are_revalidated(candidate_payload):
    candidate = InterpretationCandidate(**candidate_payload)
    forged = candidate.model_copy(update={"confidence": 1.5})
    with pytest.raises(ValidationError):
        InterpretationProposal(candidates=[forged])
    forged_proposal = InterpretationProposal.model_construct(
        status="validated",
        candidates=(candidate,),
        metadata=None,
    )
    with pytest.raises(ValidationError):
        InterpretationProposal.model_validate(forged_proposal)


def test_nested_metadata_changes_are_revalidated(candidate_payload):
    metadata = ProviderMetadata(extensions={"vendor": {"score": 0.5}})
    metadata.extensions["vendor"]["score"] = float("nan")
    with pytest.raises(ValidationError):
        InterpretationProposal(candidates=[candidate_payload], metadata=metadata)


def test_metadata_limit_counts_utf8_bytes():
    with pytest.raises(ValidationError):
        ProviderMetadata(extensions={"vendor": "é" * 9000})


@pytest.mark.parametrize(
    "model",
    [
        SelectedBlock,
        SemanticHint,
        InterpretationRequest,
        InterpretationCandidate,
        InterpretationProposal,
        SimplificationRequest,
        SimplificationProposal,
        RepresentationRequest,
        RepresentationProposal,
        ProviderMetadata,
        ProviderHealth,
    ],
)
def test_contracts_export_json_schemas_with_unknown_fields_forbidden(model):
    schema = json.loads(json.dumps(model.model_json_schema()))
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False


def test_validation_errors_do_not_include_raw_communication_text():
    with pytest.raises(ValidationError) as failure:
        SimplificationRequest(text="private-communication", unknown="private-communication")
    assert "private-communication" not in str(failure.value)


def test_provider_protocol_exposes_only_async_operations():
    methods = ("interpret", "simplify", "suggest_representation", "health")
    assert all(inspect.iscoroutinefunction(getattr(AIProvider, name)) for name in methods)
    assert isinstance(AIProvider.provider_id, property)
