import type { Block, Position } from "./keyboard";
import { messageText, type Memory } from "./memory.ts";

// Count distinct accepted messages, never taps or unreviewed proposals.
export function keyboardUsage(
  profileId: string,
  memory: Memory,
  blocks: Block[],
  positions: Position[],
) {
  const accepted = new Map(
    memory.interpretations
      .filter(
        (item) =>
          item.profile_id === profileId && messageText(item, true)?.trim(),
      )
      .map((item) => [item.sequence_id, item]),
  );
  const eligible = blocks.filter(
    (block) =>
      block.profile_id === profileId &&
      block.status === "validated" &&
      block.stability !== "stable" &&
      !positions.some(
        (p) =>
          p.profile_id === profileId &&
          p.block_id === block.id &&
          (p.locked || p.zone === "stable"),
      ),
  );
  return eligible
    .map((block) => {
      const sequences = new Map(
        memory.sequences
          .filter(
            (sequence) =>
              sequence.profile_id === profileId &&
              sequence.status === "completed" &&
              accepted.has(sequence.id) &&
              sequence.block_ids.includes(block.id),
          )
          .map((sequence) => [sequence.id, sequence]),
      );
      return {
        block,
        count: sequences.size,
        examples: [...sequences.values()]
          .slice(-2)
          .map((sequence) => messageText(accepted.get(sequence.id)!, true)!),
      };
    })
    .filter((item) => item.count >= 2)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.block.label.localeCompare(b.block.label, "fr") ||
        a.block.id.localeCompare(b.block.id),
    )
    .slice(0, 5);
}
