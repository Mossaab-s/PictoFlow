import type { Sequence } from "./keyboard";
import { memoryMatches, messageText, type MemoryMessage } from "./memory.ts";

export type VocabularyNeed = {
  id: string;
  profile_id: string;
  validated_intent: string;
  occurrence_count: number;
  validated_count: number;
  created_at: string;
  status: "proposed" | "approved" | "rejected" | "resolved";
};
export type NeedEvidence = {
  profile_id: string;
  gap_id: string;
  minimum_occurrences: number;
  minimum_validated: number;
  occurrence_count: number;
  validated_count: number;
  eligible: boolean;
  existing_block_match: boolean;
  examples: { sequence: Sequence; interpretation: MemoryMessage }[];
};
export function visibleNeeds(
  profileId: string,
  items: VocabularyNeed[],
  pending: boolean,
  query: string,
) {
  return items
    .filter(
      (item) =>
        item.profile_id === profileId &&
        (pending
          ? item.status === "proposed"
          : ["approved", "rejected", "resolved"].includes(item.status)) &&
        memoryMatches(item.validated_intent, query),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) ||
        a.id.localeCompare(b.id),
    );
}
export function needExamples(
  profileId: string,
  need: VocabularyNeed,
  evidence: NeedEvidence,
) {
  if (
    need.profile_id !== profileId ||
    evidence.profile_id !== profileId ||
    evidence.gap_id !== need.id
  )
    throw new Error("Les exemples de ce besoin ne peuvent pas être vérifiés.");
  const examples = evidence.examples.filter(
    ({ sequence, interpretation }) =>
      sequence.profile_id === profileId &&
      interpretation.profile_id === profileId &&
      sequence.status === "completed" &&
      sequence.id === interpretation.sequence_id &&
      messageText(interpretation, true) === need.validated_intent,
  );
  if (evidence.eligible && !examples.length)
    throw new Error(
      "Les exemples acceptés de ce besoin ne sont pas disponibles. Actualisez avant de décider.",
    );
  return examples;
}
