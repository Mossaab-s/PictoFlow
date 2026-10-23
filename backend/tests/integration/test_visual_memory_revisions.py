"""Visual edits preserve accepted alignment; semantic and unknown edits do not."""

from dataclasses import replace
from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image

from app.application.blocks import BlockService
from app.application.memory_vocabulary import MemoryReference, resolve, revision
from app.application.photos import PhotoService
from app.domain.pcl.entities import CommunicationBlock, HumanRole, ValidationAction, utc_now
from app.infrastructure.photos import normalize_photo
from app.infrastructure.postgres.models import AuditRow
from app.infrastructure.postgres.pcl_repository import snapshot
from tests.integration.test_ai_quality import correction, interpreter
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event
from tests.integration.test_interpretation_reuse import run, setup

pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("visual", ["pictogram", "photo", "reference"])
def test_visual_edit_keeps_examples_exact_reuse_and_pending_provenance(communication, visual):
    service, profile, foreign, blocks = communication
    accepted, _ = correction(service, profile, blocks)
    reuse = setup(service)
    pending = run(reuse, profile, completed(service, profile, blocks)).candidates[0]
    assert pending.source == "pcl-memory"
    block_service = BlockService(service.units)
    if visual == "pictogram":
        block_service.select_pictogram(profile, blocks[0].id, "music", actor_role=HumanRole.USER)
    elif visual == "photo":
        content = BytesIO()
        Image.new("RGB", (12, 12), "blue").save(content, format="PNG")
        PhotoService(service.units).replace_photo(
            profile, blocks[0].id, uuid4(), normalize_photo(content.getvalue()), HumanRole.USER
        )
    else:
        block_service.replace_visual(profile, blocks[0].id, "pictoflow:pictogram:v1:music")
    target = completed(service, profile, blocks)
    request = interpreter(service).request(profile, target.id)
    assert request.correction_examples == (accepted.validated_text,)
    assert [example.reference_id for example in request.memory_examples] == [accepted.id]
    remembered = run(reuse, profile, target).candidates[0]
    assert remembered.source == "pcl-memory" and remembered.text == accepted.validated_text
    assert reuse.interpreter.provider.interpret.await_count == 0
    assert service.validate(event(profile, pending, ValidationAction.CONFIRM)).validated_text
    with service.units() as store:
        reference = MemoryReference(accepted.id, revision(accepted.validated_text))
        assert (
            resolve(store, profile, reference, require_association=True) == accepted.validated_text
        )
    with service.units() as store:
        assert not store.accepted_traces(
            foreign, block_ids=target.block_ids, exclude_sequence_id=uuid4()
        )


@pytest.mark.parametrize("field,value", [("label", "Different"), ("spoken_text", "Different")])
def test_visual_event_name_cannot_hide_semantic_edits_or_their_reversal(
    communication, field, value
):
    service, profile, _, blocks = communication
    correction(service, profile, blocks)
    with service.units() as store:
        before = store.get(profile, CommunicationBlock, blocks[0].id)
        changed = replace(before, **{field: value}, updated_at=utc_now())
        store.save(profile, changed)
        store.audit(profile, "block_representation_changed", before, changed, "human:user")
        restored = replace(before, updated_at=utc_now())
        store.save(profile, restored)
        store.audit(profile, "block_representation_changed", changed, restored, "human:user")
    request = interpreter(service).request(profile, completed(service, profile, blocks).id)
    assert request.memory_examples == request.correction_examples == ()


@pytest.mark.parametrize(
    "damage", ["missing_before", "missing_field", "unknown_event", "wrong_id", "scalar", "array"]
)
def test_incomplete_or_unknown_visual_history_does_not_authorize_reuse(communication, damage):
    service, profile, _, blocks = communication
    correction(service, profile, blocks)
    with service.units() as store:
        before = store.get(profile, CommunicationBlock, blocks[0].id)
        after = replace(before, visual_reference="changed", updated_at=utc_now())
        store.save(profile, after)
        entry = AuditRow(
            id=uuid4(),
            profile_id=profile,
            target_id=before.id,
            target_type="communication_block",
            communication_block_id=before.id,
            event_type="block_visual_changed",
            previous_state=snapshot(before),
            new_state=snapshot(after),
            source="human:user",
            created_at=utc_now(),
        )
        if damage == "missing_before":
            entry.previous_state = None
        elif damage == "scalar":
            entry.previous_state = "incomplete legacy snapshot"
        elif damage == "array":
            entry.new_state = []
        elif damage == "missing_field":
            entry.previous_state = {
                key: value for key, value in entry.previous_state.items() if key != "spoken_text"
            }
        elif damage == "wrong_id":
            entry.previous_state = {**entry.previous_state, "id": str(uuid4())}
        else:
            entry.event_type = "unknown_visual_edit"
        store.session.add(entry)
    request = interpreter(service).request(profile, completed(service, profile, blocks).id)
    assert request.memory_examples == request.correction_examples == ()
