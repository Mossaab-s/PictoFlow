export type HumanRole = "user" | "caregiver" | "professional";
export type Zone = "stable" | "personal" | "adaptive";
export type Concept = {
  id: string;
  profile_id: string;
  label: string;
  canonical_key: string;
};
export type Block = {
  id: string;
  profile_id: string;
  concept_id: string | null;
  representation_id?: string | null;
  canonical_intent: string | null;
  label: string;
  status: "proposed" | "validated" | "rejected" | "archived";
  origin: string;
  stability: string;
};
export type Position = {
  profile_id: string;
  block_id: string;
  zone: Zone;
  position: number;
  locked: boolean;
  group_id?: string | null;
};
export type KeyboardGroup = {
  id: string;
  profile_id: string;
  label: string;
  sort_order?: number;
  status?: "active" | "archived";
  created_at?: string;
  updated_at?: string;
};
export type Representation = {
  id: string;
  profile_id: string;
  concept_id: string;
  type: string;
  source: string;
  asset_reference: string | null;
  status: "proposed" | "validated" | "rejected" | "archived";
};
export type Tile = Position & { block: Block; representation?: Representation };

export function blockRepresentation(
  profileId: string,
  block: Block,
  representations: Representation[],
  proposed = false,
) {
  if (block.profile_id !== profileId) return undefined;
  return representations.find(
    (visual) =>
      visual.id === block.representation_id &&
      visual.profile_id === profileId &&
      visual.concept_id === block.concept_id &&
      (visual.status === "validated" ||
        (proposed && visual.status === "proposed")),
  );
}
export type Sequence = {
  id: string;
  profile_id: string;
  context_id?: string | null;
  block_ids: string[];
  status: "in_progress" | "completed" | "cancelled";
};
export type Interpretation = {
  shortcut?: boolean;
  source: string;
  id: string;
  profile_id: string;
  sequence_id: string;
  text: string;
  corrected_text: string | null;
  status:
    "proposed" | "confirmed" | "corrected" | "rejected" | "not_understood";
};
export type Decision = {
  state:
    | "proposal"
    | "confirmation_required"
    | "multiple_hypotheses"
    | "not_understood";
  candidates: Interpretation[];
};
export type DraftReference = {
  sequence_id: string;
  decision?: { state: Decision["state"]; candidate_ids: string[] };
};

export const zones: Record<Zone, string> = {
  stable: "Repères stables",
  personal: "Mes touches",
  adaptive: "Touches proposées et validées",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// getRandomValues also works on the deployed HTTP LAN origin, unlike randomUUID.
export function newIdentity(
  source: Pick<Crypto, "getRandomValues"> = globalThis.crypto,
): string {
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function joinKeyboard(
  profileId: string,
  blocks: Block[],
  positions: Position[],
  representations: Representation[] = [],
): Tile[] {
  const known = new Map(
    blocks
      .filter(
        (block) =>
          block.profile_id === profileId && block.status === "validated",
      )
      .map((block) => [block.id, block]),
  );
  return positions
    .filter(
      (position) =>
        position.profile_id === profileId && known.has(position.block_id),
    )
    .map((position) => {
      const block = known.get(position.block_id)!;
      const representation = blockRepresentation(
        profileId,
        block,
        representations,
      );
      return {
        ...position,
        block,
        ...(representation ? { representation } : {}),
      };
    });
}

export function keyboardPage(
  tiles: Tile[],
  page: number,
  size = 12,
): { slots: (Tile | null)[]; page: number; pages: number; offset: number } {
  const highest = Math.max(-1, ...tiles.map((tile) => tile.position));
  const pages = Math.max(1, Math.floor(highest / size) + 1);
  const current = Math.max(0, Math.min(Math.trunc(page), pages - 1));
  const offset = current * size;
  const count = Math.max(0, Math.min(size, highest - offset + 1));
  const positions = new Map(tiles.map((tile) => [tile.position, tile]));
  return {
    slots: Array.from(
      { length: count },
      (_, index) => positions.get(offset + index) ?? null,
    ),
    page: current,
    pages,
    offset,
  };
}

export function occupied(
  positions: Position[],
  blockId: string,
  zone: Zone,
  position: number,
  groupId: string | null = null,
) {
  return positions.some(
    (slot) =>
      slot.block_id !== blockId &&
      slot.zone === zone &&
      (slot.group_id ?? null) === groupId &&
      slot.position === position,
  );
}

export function pageTiles(tiles: Tile[], groupId: string | null): Tile[] {
  return tiles.filter(
    (tile) => tile.zone === "stable" || (tile.group_id ?? null) === groupId,
  );
}

// Browser storage retains identifiers only; the API always reloads authoritative state.
export function draftReference(
  sequence: Sequence,
  decision: Decision | null,
): DraftReference {
  return {
    sequence_id: sequence.id,
    ...(decision
      ? {
          decision: {
            state: decision.state,
            candidate_ids: decision.candidates.map((item) => item.id),
          },
        }
      : {}),
  };
}

export function parseDraft(value: string | null): DraftReference | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value);
    if (!uuid.test(data?.sequence_id)) return null;
    if (
      data.decision &&
      (![
        "proposal",
        "confirmation_required",
        "multiple_hypotheses",
        "not_understood",
      ].includes(data.decision.state) ||
        !Array.isArray(data.decision.candidate_ids) ||
        data.decision.candidate_ids.length > 3 ||
        data.decision.candidate_ids.some(
          (id: unknown) => typeof id !== "string" || !uuid.test(id),
        ))
    )
      return null;
    return {
      sequence_id: data.sequence_id,
      ...(data.decision
        ? {
            decision: {
              state: data.decision.state,
              candidate_ids: data.decision.candidate_ids,
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}
