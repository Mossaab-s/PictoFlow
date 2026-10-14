"""Minimal human-feedback transition; persistence and learning are separate use cases."""

from dataclasses import replace

from app.domain.pcl.entities import (
    Interpretation,
    InterpretationStatus,
    TargetType,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.invariants import DomainInvariantError


def apply_interpretation_feedback(
    proposal: Interpretation,
    event: ValidationEvent,
) -> Interpretation:
    if (
        event.profile_id != proposal.profile_id
        or event.target_type != TargetType.INTERPRETATION
        or event.target_id != proposal.id
    ):
        raise DomainInvariantError("Validation event does not target this profile's interpretation")
    if event.created_at < proposal.created_at:
        raise DomainInvariantError("Feedback must not precede the interpretation")
    if proposal.status == InterpretationStatus.NOT_UNDERSTOOD:
        raise DomainInvariantError("A refusal is final; create a new proposal before validation")
    if event.action == ValidationAction.REJECT:
        return replace(proposal, status=InterpretationStatus.REJECTED, shortcut=False)
    if event.action == ValidationAction.CORRECT:
        return replace(
            proposal,
            status=InterpretationStatus.CORRECTED,
            corrected_text=event.corrected_value,
            shortcut=proposal.shortcut and proposal.validated_text == event.corrected_value,
        )
    # Later confirmation must not restore the model's text over a human correction.
    status = (
        InterpretationStatus.CORRECTED
        if proposal.corrected_text is not None
        else (InterpretationStatus.CONFIRMED)
    )
    return replace(proposal, status=status)
