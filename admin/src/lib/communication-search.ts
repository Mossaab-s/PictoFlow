import {
  blockRepresentation,
  type KeyboardGroup,
  type Tile,
} from "./keyboard.ts";

// Lookup is a view of the loaded personal keyboard, never a vocabulary source.
export function findCommunicationTouches(
  profileId: string,
  tiles: Tile[],
  groups: KeyboardGroup[],
  query: string,
): Tile[] {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll("œ", "oe");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const pages = new Set(
    groups
      .filter((g) => g.profile_id === profileId && g.status !== "archived")
      .map((g) => g.id),
  );
  const seen = new Set<string>();
  return tiles
    .filter((tile) => {
      const group = tile.group_id ?? null;
      const available =
        tile.profile_id === profileId &&
        tile.block.profile_id === profileId &&
        tile.block_id === tile.block.id &&
        tile.block.status === "validated" &&
        Number.isInteger(tile.position) &&
        tile.position >= 0 &&
        ["stable", "personal", "adaptive"].includes(tile.zone) &&
        (tile.zone === "stable"
          ? group === null
          : group === null || pages.has(group));
      if (
        !available ||
        seen.has(tile.block_id) ||
        !terms.every((term) => normalize(tile.block.label).includes(term))
      )
        return false;
      seen.add(tile.block_id);
      return true;
    })
    .map((tile) => ({
      ...tile,
      representation: blockRepresentation(
        profileId,
        tile.block,
        tile.representation ? [tile.representation] : [],
      ),
    }));
}
