import type { Block, Sequence } from "./keyboard";
import { messageText, type Memory, type MemoryMessage } from "./memory.ts";

// This is a history lookup, never an inference about today's intended meaning.
export function compositionMemory(
  profileId: string,
  sequence: Sequence,
  memory: Memory,
) {
  if (
    sequence.profile_id !== profileId ||
    sequence.status !== "completed" ||
    !sequence.block_ids.length
  )
    return { retained: null, previous: [] };
  const sources = new Map(
    memory.sequences
      .filter(
        (item) =>
          item.profile_id === profileId &&
          item.status === "completed" &&
          (item.context_id ?? null) === (sequence.context_id ?? null) &&
          item.block_ids.length === sequence.block_ids.length &&
          item.block_ids.every((id, index) => id === sequence.block_ids[index]),
      )
      .map((item) => [item.id, item]),
  );
  const accepted = memory.interpretations
    .filter(
      (item) =>
        item.profile_id === profileId &&
        sources.has(item.sequence_id) &&
        Boolean(messageText(item, true)?.trim()),
    )
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        a.id.localeCompare(b.id),
    );
  const retained =
    accepted.find((item) => item.sequence_id === sequence.id) ?? null;
  const texts = new Set<string>();
  const previous: MemoryMessage[] = [];
  for (const item of accepted) {
    if (item.sequence_id === sequence.id) continue;
    const text = messageText(item, true)!;
    if (texts.has(text)) continue;
    texts.add(text);
    previous.push(item);
    if (previous.length === 3) break;
  }
  return { retained, previous };
}

export function replayAvailable(
  profileId: string,
  sequence: Sequence,
  blocks: Block[],
) {
  const known = new Set(
    blocks
      .filter(
        (block) =>
          block.profile_id === profileId && block.status === "validated",
      )
      .map((block) => block.id),
  );
  return (
    sequence.profile_id === profileId &&
    sequence.status === "completed" &&
    sequence.block_ids.length > 0 &&
    sequence.block_ids.length <= 32 &&
    sequence.block_ids.every((id) => known.has(id))
  );
}
