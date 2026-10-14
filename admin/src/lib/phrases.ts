import type { Interpretation, Sequence } from "./keyboard";
import { memoryMatches, messageText, type MemoryMessage } from "./memory.ts";

export type ReusablePhrase = {
  interpretation: MemoryMessage;
  sequence: Sequence;
};

export function phraseId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export function acceptedPhrase(
  profileId: string,
  value: ReusablePhrase,
): ReusablePhrase | null {
  return value.interpretation.profile_id === profileId &&
    value.sequence.profile_id === profileId &&
    value.interpretation.sequence_id === value.sequence.id &&
    value.sequence.status === "completed" &&
    Boolean(messageText(value.interpretation, true)?.trim())
    ? value
    : null;
}

export function phraseList(
  profileId: string,
  items: MemoryMessage[],
  sequences: Sequence[],
  query: string,
  shortcuts: boolean,
) {
  const known = new Set(
    sequences
      .filter((s) => s.profile_id === profileId && s.status === "completed")
      .map((s) => s.id),
  );
  return items
    .filter(
      (item) =>
        item.profile_id === profileId &&
        known.has(item.sequence_id) &&
        messageText(item, true) !== null &&
        (!shortcuts || item.shortcut === true) &&
        memoryMatches(messageText(item, true) ?? "", query),
    )
    .sort(
      (a, b) =>
        Number(b.shortcut === true) - Number(a.shortcut === true) ||
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        a.id.localeCompare(b.id),
    );
}

export function shortcutChoice(item: Interpretation, selected: boolean) {
  const text = messageText(item, true);
  if (!text?.trim()) return null;
  return {
    selected,
    expected_selected: item.shortcut === true,
    expected_text: text,
  };
}
