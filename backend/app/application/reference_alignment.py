"""A partial memory must not import the missing part of its source situation."""

from collections import Counter


def applicable_reference(current_ids, source_ids):
    """Require the whole source, including repeats, covering half the current message.

    Exact personal associations stay applicable even when their accepted text is
    implicit. Extra current touches may adapt an association, but two shared
    people cannot import a meal from a source that also required food/place keys.
    """
    current, source = Counter(current_ids), Counter(source_ids)
    return (
        bool(current and source)
        and not (source - current)
        and (sum(source.values()) * 2 >= sum(current.values()))
    )
