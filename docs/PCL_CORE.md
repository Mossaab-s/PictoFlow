# PCL core (PCL-001)

The core lives in `backend/app/domain/pcl` and uses only the Python standard
library. Its immutable dataclasses model profiles, concepts, representations,
communication blocks, directed relations, ordered sequences, interpretations and
human validation events. They do not hold database, provider or HTTP handles.

`PCLSnapshot` holds one profile's state. It checks ownership, unique identity,
canonical keys, reference existence and chronological feedback. A block's
representation must preserve its concept identity. Validated or rejected objects
require matching human evidence; accepted interpretations additionally require
a completed sequence. An AI provider cannot be a validation actor.

## Proposal lifecycle

An interpretation starts as `proposed` or `not_understood`. Confidence is a
bounded finite number, independent of validation. `validated_text` stays absent
until an explicit confirmation or correction. A correction preserves the original
proposal and takes precedence over it, including after a later confirmation.
Rejection removes the interpretation from accepted meaning while retaining the
proposal and any correction. A refusal contains no semantic text and cannot be
validated into knowledge.

```python
from app.domain.pcl.examples import noise_scenario
from app.domain.pcl.entities import TargetType, ValidationAction, ValidationEvent

state = noise_scenario()
proposal = state.interpretations[0]
assert proposal.validated_text is None

confirmed = state.record_interpretation_feedback(ValidationEvent(
    profile_id=state.profile.id,
    target_type=TargetType.INTERPRETATION,
    target_id=proposal.id,
    action=ValidationAction.CONFIRM,
))
assert confirmed.interpretations[0].validated_text == proposal.text
assert state.interpretations[0].validated_text is None
```

The example seeds validated NOISE → DISCOMFORT and NOISE → LEAVE associations,
with human feedback facts, and the ordered NOISE → STOP → LEAVE sequence.
It contains a synthetic unvalidated interpretation and invokes no AI provider.

## Scope

PCL-001 supplies domain contracts, invariants and pure interpretation feedback.
Personal memory, sequence orchestration, interpretation validation and confidence
handling are documented in [COMMUNICATION_MEMORY.md](COMMUNICATION_MEMORY.md).
Semantic gaps, keyboard projection and the full end-to-end scenario are documented
in [ADAPTIVE_WORKFLOW.md](ADAPTIVE_WORKFLOW.md). The semantic service and its
PostgreSQL transactions are described
in [SEMANTIC_SPACE.md](SEMANTIC_SPACE.md).

Domain tests cover ownership, references, feedback evidence, correction priority,
refusal, stable blocks, sequence order and invalid values. A fresh Python process
with site packages disabled imports every domain module and executes the example
with confirmation, proving independence from the installed framework packages.
