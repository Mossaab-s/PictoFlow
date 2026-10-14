import type {
  Block,
  HumanRole,
  KeyboardGroup,
  Position,
  Representation,
  Sequence,
} from "./keyboard";

export type OfflineSnapshot = {
  profile_id: string;
  revision: string;
  captured_at: string;
  blocks: Block[];
  positions: Position[];
  representations: Representation[];
  groups: KeyboardGroup[];
  photos: Record<string, string>;
};
export type OfflineSubmission = {
  request_id: string;
  expected_revision: string;
  block_ids: string[];
  actor_role: HumanRole;
  confirm: true;
};
export type OfflineRecord = {
  version: 1;
  profile_id: string;
  serial: number;
  snapshot: OfflineSnapshot | null;
  block_ids: string[];
  submission: OfflineSubmission | null;
  imported: Sequence | null;
  conflict: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
export function emptyOffline(profileId: string): OfflineRecord {
  return {
    version: 1,
    profile_id: profileId,
    serial: 0,
    snapshot: null,
    block_ids: [],
    submission: null,
    imported: null,
    conflict: false,
  };
}
export function checkedSnapshot(
  profileId: string,
  value: unknown,
): OfflineSnapshot | null {
  try {
    const s = value as OfflineSnapshot;
    if (
      !s ||
      s.profile_id !== profileId ||
      !hash.test(s.revision) ||
      !Number.isFinite(Date.parse(s.captured_at)) ||
      ![s.blocks, s.positions, s.representations, s.groups].every(
        Array.isArray,
      ) ||
      typeof s.photos !== "object" ||
      !s.photos
    )
      return null;
    if (
      s.blocks.length > 10000 ||
      s.positions.length !== s.blocks.length ||
      s.representations.length > 10000 ||
      s.groups.length > 10000 ||
      JSON.stringify(s).length > 30 * 1024 * 1024
    )
      return null;
    for (const records of [s.blocks, s.representations, s.groups])
      if (
        records.some((r) => r.profile_id !== profileId || !uuid.test(r.id)) ||
        new Set(records.map((r) => r.id)).size !== records.length
      )
        return null;
    if (
      s.blocks.some(
        (b) =>
          b.status !== "validated" ||
          typeof b.label !== "string" ||
          !b.label ||
          b.label.length > 256,
      )
    )
      return null;
    if (
      s.representations.some((v) => v.status !== "validated") ||
      s.groups.some((g) => g.status !== "active" || typeof g.label !== "string")
    )
      return null;
    const ids = new Set(s.blocks.map((b) => b.id));
    const pages = new Set(s.groups.map((g) => g.id));
    if (
      s.positions.some(
        (p) =>
          p.profile_id !== profileId ||
          !ids.has(p.block_id) ||
          !["personal", "stable", "adaptive"].includes(p.zone) ||
          !Number.isSafeInteger(p.position) ||
          p.position < 0 ||
          p.position > 2147483647 ||
          typeof p.locked !== "boolean" ||
          (p.group_id && !pages.has(p.group_id)) ||
          (p.zone === "stable" && p.group_id),
      )
    )
      return null;
    if (
      new Set(s.positions.map((p) => p.block_id)).size !== ids.size ||
      new Set(
        s.positions.map((p) => `${p.group_id ?? ""}:${p.zone}:${p.position}`),
      ).size !== s.positions.length
    )
      return null;
    const visuals = new Set(
      s.representations
        .filter(
          (v) =>
            v.type === "photo" &&
            v.source === "personal-photo" &&
            v.asset_reference === `photo:${v.id}`,
        )
        .map((v) => v.id),
    );
    if (Object.keys(s.photos).length !== visuals.size) return null;
    if (
      Object.entries(s.photos).some(
        ([id, photo]) =>
          !visuals.has(id) ||
          typeof photo !== "string" ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo),
      )
    )
      return null;
    return s;
  } catch {
    return null;
  }
}
export function checkedOffline(
  profileId: string,
  value: unknown,
): OfflineRecord | null {
  try {
    const r = value as OfflineRecord;
    if (
      !r ||
      r.version !== 1 ||
      r.profile_id !== profileId ||
      !Number.isSafeInteger(r.serial) ||
      r.serial < 0 ||
      !Array.isArray(r.block_ids) ||
      r.block_ids.length > 32 ||
      typeof r.conflict !== "boolean"
    )
      return null;
    const s =
      r.snapshot === null ? null : checkedSnapshot(profileId, r.snapshot);
    if (r.snapshot !== null && !s) return null;
    const ids = new Set(s?.blocks.map((b) => b.id));
    if (r.block_ids.some((id) => !uuid.test(id) || !ids.has(id))) return null;
    if (
      r.submission &&
      (!s ||
        !uuid.test(r.submission.request_id) ||
        r.submission.expected_revision !== s.revision ||
        r.submission.confirm !== true ||
        !["user", "caregiver", "professional"].includes(
          r.submission.actor_role,
        ) ||
        JSON.stringify(r.submission.block_ids) !== JSON.stringify(r.block_ids))
    )
      return null;
    if (
      r.imported &&
      (!r.submission ||
        r.imported.id !== r.submission.request_id ||
        r.imported.profile_id !== profileId ||
        r.imported.status !== "completed" ||
        JSON.stringify(r.imported.block_ids) !== JSON.stringify(r.block_ids))
    )
      return null;
    return { ...r, snapshot: s };
  } catch {
    return null;
  }
}
export function offlineWords(record: OfflineRecord) {
  return record.block_ids
    .map(
      (id) =>
        record.snapshot?.blocks.find((b) => b.id === id)?.label ??
        "Touche indisponible",
    )
    .join(" ");
}
export function editOffline(
  record: OfflineRecord,
  action: "append" | "undo" | "clear",
  blockId?: string,
): OfflineRecord {
  if (record.submission && !record.conflict && !record.imported)
    throw new Error("Vérifiez l’envoi avant de modifier ce brouillon.");
  if (record.imported && action !== "clear")
    throw new Error("Commencez un nouveau brouillon local.");
  let ids = [...record.block_ids];
  if (action === "append") {
    if (
      record.conflict ||
      ids.length >= 32 ||
      !record.snapshot?.blocks.some((b) => b.id === blockId)
    )
      throw new Error("Cette touche ne peut pas être ajoutée.");
    ids.push(blockId!);
  } else if (action === "undo") {
    if (record.conflict)
      throw new Error("Effacez ce brouillon avant de recommencer.");
    ids.pop();
  } else ids = [];
  return {
    ...record,
    block_ids: ids,
    submission: null,
    imported: null,
    conflict: false,
  };
}
