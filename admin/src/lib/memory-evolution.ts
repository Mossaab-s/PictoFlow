import type { Interpretation } from "./keyboard";
import { messageText } from "./memory.ts";

export type HistoryEvent = {
  id: string;
  profile_id: string;
  target_type: string;
  target_id: string;
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
  source: string;
  created_at: string;
};
type PhraseSnapshot = Pick<
  Interpretation,
  "id" | "profile_id" | "sequence_id" | "status" | "text" | "corrected_text"
>;
export type MemoryChange = {
  event: HistoryEvent;
  action: "confirm" | "correct" | "withdraw";
  before: PhraseSnapshot;
  after: PhraseSnapshot;
  previousText: string | null;
  acceptedText: string | null;
};

function phraseSnapshot(
  raw: string | null,
  event: HistoryEvent,
): PhraseSnapshot | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.profile_id !== event.profile_id ||
      value.id !== event.target_id ||
      typeof value.sequence_id !== "string" ||
      typeof value.text !== "string" ||
      !(
        value.corrected_text === null ||
        typeof value.corrected_text === "string"
      ) ||
      ![
        "proposed",
        "confirmed",
        "corrected",
        "rejected",
        "not_understood",
      ].includes(value.status)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

// Historical display only. The live interpretation remains the authority for today's state.
export function memoryChange(
  profileId: string,
  event: HistoryEvent,
): MemoryChange | null {
  if (
    event.profile_id !== profileId ||
    event.target_type !== "interpretation" ||
    !Number.isFinite(Date.parse(event.created_at))
  )
    return null;
  const before = phraseSnapshot(event.previous_state, event);
  const after = phraseSnapshot(event.new_state, event);
  if (!before || !after || before.sequence_id !== after.sequence_id)
    return null;
  const acceptedText = messageText(after, true);
  const previousText = messageText(before, true);
  const action =
    event.event_type === "interpretation_confirm" &&
    after.status === "confirmed" &&
    acceptedText
      ? "confirm"
      : event.event_type === "interpretation_correct" &&
          after.status === "corrected" &&
          acceptedText
        ? "correct"
        : event.event_type === "interpretation_reject" &&
            after.status === "rejected" &&
            previousText
          ? "withdraw"
          : null;
  return action
    ? { event, action, before, after, previousText, acceptedText }
    : null;
}

export function evolutionPage(
  profileId: string,
  events: HistoryEvent[],
  limit: number,
) {
  const scoped = events.filter((event) => event.profile_id === profileId);
  const items = scoped
    .slice(0, limit)
    .map((event) => memoryChange(profileId, event))
    .filter((item): item is MemoryChange => item !== null);
  return {
    items,
    unreadable: Math.min(limit, scoped.length) - items.length,
    next_cursor: scoped.length > limit ? scoped[limit - 1].id : null,
  };
}
