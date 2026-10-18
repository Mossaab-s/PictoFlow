import type { Sequence } from "./keyboard";
import type { MemoryMessage } from "./memory";
import { messageText } from "./memory.ts";

export type ReviewGroup = { sequence: Sequence; candidates: MemoryMessage[] };

export function reviewGroups(
  profileId: string,
  sequences: Sequence[],
  candidates: MemoryMessage[],
  pending: boolean,
): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  for (const sequence of sequences) {
    if (sequence.profile_id !== profileId || sequence.status !== "completed")
      continue;
    const own = candidates.filter(
      (item) =>
        item.profile_id === profileId && item.sequence_id === sequence.id,
    );
    // An accepted alternative resolves the message; no sibling is silently rejected.
    const resolved = own.some((item) => messageText(item, true) !== null);
    const visible = own.filter((item) =>
      pending
        ? !resolved && item.status === "proposed"
        : messageText(item, true) !== null || item.status === "rejected",
    );
    if (visible.length) groups.push({ sequence, candidates: visible });
  }
  const date = (group: ReviewGroup) =>
    Math.max(
      ...group.candidates.map((item) => Date.parse(item.created_at) || 0),
    );
  return groups.sort(
    (a, b) => date(b) - date(a) || a.sequence.id.localeCompare(b.sequence.id),
  );
}
