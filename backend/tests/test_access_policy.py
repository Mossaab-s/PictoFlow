from uuid import uuid4

import pytest

from app.application.access import AccountView, normalized_capabilities, permits


@pytest.fixture
def account():
    return AccountView(uuid4(), "sample", "Fictif", False, True, {})


@pytest.mark.parametrize(
    "capability",
    [
        "communicate",
        "review_meanings",
        "prepare_keyboard",
        "manage_meanings",
        "view_history",
        "export_profile",
    ],
)
def test_need_evidence_is_an_explicit_narrow_read_permission(account, capability):
    assert permits(
        account,
        None,
        "GET",
        "/profiles/{profile_id}/suggestions/{gap_id}/evidence",
        capabilities=(capability,),
    ) == (capability in {"prepare_keyboard", "manage_meanings", "view_history"})


@pytest.mark.parametrize(
    "capability,allowed,denied",
    [
        (
            "communicate",
            ("POST", "/profiles/{profile_id}/sequences"),
            ("POST", "/profiles/{profile_id}/interpretations/{interpretation_id}/feedback"),
        ),
        (
            "review_meanings",
            ("POST", "/profiles/{profile_id}/interpretations/{interpretation_id}/feedback"),
            ("POST", "/profiles/{profile_id}/sequences"),
        ),
        (
            "prepare_keyboard",
            ("PUT", "/profiles/{profile_id}/keyboard/{block_id}"),
            ("PATCH", "/profiles/{profile_id}/concepts/{concept_id}"),
        ),
        (
            "manage_meanings",
            ("PATCH", "/profiles/{profile_id}/concepts/{concept_id}"),
            ("PUT", "/profiles/{profile_id}/keyboard/{block_id}"),
        ),
        (
            "view_history",
            ("GET", "/profiles/{profile_id}/audit"),
            ("POST", "/profiles/{profile_id}/relations"),
        ),
        (
            "export_profile",
            ("GET", "/profiles/{profile_id}/backup"),
            ("GET", "/profiles/{profile_id}/sequences"),
        ),
    ],
)
def test_capabilities_do_not_imply_other_mutation_powers(account, capability, allowed, denied):
    assert permits(account, "editor", *allowed, capabilities=(capability,))
    assert not permits(account, "editor", *denied, capabilities=(capability,))


@pytest.mark.parametrize(
    "capabilities",
    [
        (),
        ("communicate",),
        ("unknown",),
        (
            "communicate",
            "review_meanings",
            "prepare_keyboard",
            "manage_meanings",
            "view_history",
            "export_profile",
        ),
    ],
)
def test_no_profile_grant_can_erase_memory_or_read_technical_quality(account, capabilities):
    assert not permits(
        account, "editor", "DELETE", "/profiles/{profile_id}/memory", capabilities=capabilities
    )
    assert not permits(
        account, "editor", "GET", "/profiles/{profile_id}/ai-quality", capabilities=capabilities
    )
    assert not permits(
        account, "editor", "POST", "/profiles/{profile_id}/unknown", capabilities=capabilities
    )


@pytest.mark.parametrize(
    "values", [[], ["communicate", "communicate"], ["admin"], "communicate", [None], [True]]
)
def test_invalid_capability_sets_are_not_silently_widened(values):
    with pytest.raises(ValueError):
        normalized_capabilities(values)


def test_missing_explicit_capabilities_do_not_inherit_an_editor_role(account):
    assert not permits(
        account, "editor", "PUT", "/profiles/{profile_id}/keyboard/{block_id}", capabilities=()
    )
