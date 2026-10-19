import type { Block, Position, Zone } from "./keyboard";

// The existing numeric placement control accepts one-based places 1..1000.
export const placementLimit = 1000;

export function placementWindow(
  profileId: string,
  blockId: string,
  blocks: Block[],
  positions: Position[],
  zone: Zone,
  groupId: string | null,
  selected: number,
  range: number | null = null,
  size = 12,
) {
  const length = [4, 6, 12].includes(size) ? size : 12;
  const validSelection =
    Number.isInteger(selected) && selected >= 1 && selected <= placementLimit;
  const selectedRange = validSelection
    ? Math.floor((selected - 1) / length)
    : 0;
  const pages = Math.ceil(placementLimit / length);
  const page = Math.max(
    0,
    Math.min(
      pages - 1,
      Number.isFinite(range) && range !== null
        ? Math.trunc(range)
        : selectedRange,
    ),
  );
  const offset = page * length;
  const known = new Map(
    blocks
      .filter((b) => b.profile_id === profileId && b.status === "validated")
      .map((b) => [b.id, b]),
  );
  const destination = zone === "stable" ? null : groupId;
  const places = new Map(
    positions
      .filter(
        (p) =>
          p.profile_id === profileId &&
          p.zone === zone &&
          (p.group_id ?? null) === destination,
      )
      .map((p) => [p.position, p]),
  );
  const slots = Array.from(
    { length: Math.min(length, placementLimit - offset) },
    (_, index) => {
      const position = offset + index;
      const placement = places.get(position);
      const current =
        !!placement && placement.block_id === blockId && known.has(blockId);
      return {
        position,
        occupant: placement ? known.get(placement.block_id) : undefined,
        occupied: !!placement && !current,
        current,
        selected: validSelection && position === selected - 1,
      };
    },
  );
  const chosen = validSelection ? places.get(selected - 1) : undefined;
  return {
    page,
    pages,
    offset,
    slots,
    validSelection,
    selectedVisible: slots.some((slot) => slot.selected),
    selectedOccupied:
      !!chosen && (chosen.block_id !== blockId || !known.has(blockId)),
  };
}
