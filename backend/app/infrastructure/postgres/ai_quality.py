"""Aggregate persisted attempts and human decisions without returning personal text."""

from sqlalchemy import Integer, case, cast, func, or_, select

from app.application.ai_quality import FALLBACK_REASONS, QualitySummary
from app.infrastructure.postgres.models import AuditRow, InterpretationRow, ValidationRow


def quality_summary(units, profile_id) -> QualitySummary:
    with units() as store:
        store._scope(profile_id)
        session = store.session
        evidence = AuditRow.new_state["presentation"]["ai_quality"]
        attempts = (
            (AuditRow.profile_id == profile_id),
            (AuditRow.event_type == "interpretation_attempt"),
            (AuditRow.target_type == "communication_sequence"),
            (evidence["version"].astext == "1"),
            (func.jsonb_typeof(evidence["version"]) == "number"),
            or_(
                evidence["fallback_reason"].astext.is_(None),
                evidence["fallback_reason"].astext.in_(FALLBACK_REASONS),
            ),
        )
        reason = evidence["fallback_reason"].astext

        def bounded_count(name):
            value = evidence[name].astext
            return case((value.in_(("0", "1", "2", "3")), cast(value, Integer)), else_=0)

        # json values are internal, versioned receipts written atomically with proposals.
        reason_counts = dict(
            session.execute(select(reason, func.count()).where(*attempts).group_by(reason)).all()
        )
        totals = session.execute(
            select(
                func.count(),
                func.min(AuditRow.created_at),
                func.coalesce(func.sum(bounded_count("received_candidates")), 0),
                func.coalesce(func.sum(bounded_count("retained_candidates")), 0),
                func.count().filter(bounded_count("correction_examples") > 0),
            ).where(*attempts)
        ).one()
        states = dict(
            session.execute(
                select(InterpretationRow.status, func.count())
                .where(InterpretationRow.profile_id == profile_id)
                .group_by(InterpretationRow.status)
            ).all()
        )
        actions = dict(
            session.execute(
                select(ValidationRow.action, func.count())
                .where(
                    ValidationRow.profile_id == profile_id,
                    ValidationRow.target_type == "interpretation",
                )
                .group_by(ValidationRow.action)
            ).all()
        )
        return QualitySummary(
            recorded_attempts=totals[0],
            recording_started_at=totals[1],
            provider_proposals=reason_counts.get(None, 0),
            fallbacks={reason: reason_counts.get(reason, 0) for reason in FALLBACK_REASONS},
            received_candidates=totals[2],
            retained_candidates=totals[3],
            attempts_with_corrections=totals[4],
            interpretation_states={
                key: states.get(key, 0)
                for key in ("proposed", "confirmed", "corrected", "rejected", "not_understood")
            },
            human_actions={key: actions.get(key, 0) for key in ("confirm", "correct", "reject")},
        )
