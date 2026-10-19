import type { Block, Concept, Interpretation, Sequence } from "./keyboard";

export type MemoryMessage = Interpretation & { created_at: string };
export type MemoryRelation = {
  id: string;
  profile_id: string;
  source_concept_id: string;
  target_concept_id: string;
  relation_type: string;
  status: "proposed" | "validated" | "rejected";
  validation_count: number;
  rejection_count: number;
};
export type Memory = {
  interpretations: MemoryMessage[];
  sequences: Sequence[];
  blocks: Block[];
  relations: MemoryRelation[];
};
export type EvidenceTarget =
  "interpretation" | "communication_block" | "semantic_relation";
export type Evidence = {
  id: string;
  profile_id: string;
  target_type: EvidenceTarget;
  target_id: string;
  action: "confirm" | "correct" | "reject";
  corrected_value: string | null;
  actor_role: "user" | "caregiver" | "professional" | null;
  created_at: string;
};
export type EvidencePage = { items: Evidence[]; next_cursor: string | null };

export function messageText(
  item: Pick<Interpretation, "status" | "text" | "corrected_text">,
  validated: boolean,
): string | null {
  if (!validated) return item.status === "proposed" ? item.text : null;
  if (item.status === "corrected")
    return item.corrected_text?.trim() ? item.corrected_text : null;
  return item.status === "confirmed" ? item.text : null;
}
export function scopedMemory(
  profileId: string,
  memory: Memory,
  validated: boolean,
): Memory {
  return {
    interpretations: memory.interpretations.filter(
      (v) => v.profile_id === profileId && messageText(v, validated) !== null,
    ),
    sequences: memory.sequences.filter(
      (v) => v.profile_id === profileId && v.status === "completed",
    ),
    blocks: memory.blocks.filter(
      (v) =>
        v.profile_id === profileId &&
        v.status === (validated ? "validated" : "proposed"),
    ),
    relations: memory.relations.filter(
      (v) =>
        v.profile_id === profileId &&
        v.status === (validated ? "validated" : "proposed"),
    ),
  };
}
export function messageTouches(
  profileId: string,
  item: Interpretation,
  sequences: Sequence[],
  blocks: Block[],
) {
  if (item.profile_id !== profileId) return null;
  const sequence = sequences.find(
    (s) =>
      s.profile_id === profileId &&
      s.id === item.sequence_id &&
      s.status === "completed",
  );
  if (!sequence) return null;
  const scoped = new Map(
    blocks.filter((b) => b.profile_id === profileId).map((b) => [b.id, b]),
  );
  return sequence.block_ids.map((id) => scoped.get(id) ?? null);
}
const relationLabels: Record<string, string> = {
  associated_with: "est associé à",
  often_followed_by: "est souvent suivi de",
  often_preceded_by: "est souvent précédé de",
  contextually_related_to: "est lié, dans ce contexte, à",
  shortcut_for: "est un raccourci vers",
};
export function relationWords(
  profileId: string,
  relation: MemoryRelation,
  concepts: Concept[],
) {
  const label = (id: string) =>
    concepts.find((c) => c.profile_id === profileId && c.id === id)?.label ??
    "Concept indisponible";
  if (relation.profile_id !== profileId) return null;
  return [
    label(relation.source_concept_id),
    relationLabels[relation.relation_type] ?? "a une relation avec",
    label(relation.target_concept_id),
  ];
}
export function memoryMatches(text: string, query: string) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr");
  const normalized = normalize(text);
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((term) => normalized.includes(term));
}
export function evidenceItems(
  profileId: string,
  type: EvidenceTarget,
  targetId: string,
  items: Evidence[],
) {
  return items.filter(
    (v) =>
      v.profile_id === profileId &&
      v.target_type === type &&
      v.target_id === targetId,
  );
}
export const humanRoles = {
  user: "Personne utilisatrice",
  caregiver: "Aidant ou proche",
  professional: "Professionnel",
};
export const decisionLabels = {
  confirm: "Confirmation",
  correct: "Correction",
  reject: "Refus",
};
