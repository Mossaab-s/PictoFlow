import type { Block, KeyboardGroup, Position } from "./keyboard";

export type TouchMove = { block: Block; before: Position; after: Position };
export type KeyboardChangePreview = {
  profile_id: string;
  preview_token: string;
  source_page: KeyboardGroup | null;
  destination_page: KeyboardGroup | null;
  moves: TouchMove[];
};

export function orderedGroups(profileId: string, groups: KeyboardGroup[]) {
  return groups
    .filter((g) => g.profile_id === profileId && g.status !== "archived")
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.created_at && b.created_at
          ? Date.parse(a.created_at) - Date.parse(b.created_at) ||
            a.id.localeCompare(b.id)
          : 0),
    );
}
export function shiftedPages(
  profileId: string,
  groups: KeyboardGroup[],
  id: string,
  step: -1 | 1,
) {
  const ids = orderedGroups(profileId, groups).map((g) => g.id);
  const index = ids.indexOf(id);
  if (index < 0 || index + step < 0 || index + step >= ids.length) return null;
  const result = [...ids];
  [result[index], result[index + step]] = [result[index + step], result[index]];
  return { group_ids: result, expected_group_ids: ids };
}
export function scopedPreview(
  profileId: string,
  preview: KeyboardChangePreview,
) {
  return preview.profile_id === profileId &&
    /^[a-f0-9]{64}$/.test(preview.preview_token) &&
    [preview.source_page, preview.destination_page].every(
      (p) =>
        p === null || (p.profile_id === profileId && p.status !== "archived"),
    ) &&
    preview.moves.every(
      (m) =>
        m.block.profile_id === profileId &&
        m.before.profile_id === profileId &&
        m.after.profile_id === profileId &&
        m.before.block_id === m.block.id &&
        m.after.block_id === m.block.id &&
        !m.before.locked &&
        !m.after.locked &&
        m.before.zone !== "stable" &&
        m.after.zone === m.before.zone &&
        (m.before.group_id ?? null) === (preview.source_page?.id ?? null) &&
        (m.after.group_id ?? null) === (preview.destination_page?.id ?? null),
    )
    ? preview
    : null;
}
