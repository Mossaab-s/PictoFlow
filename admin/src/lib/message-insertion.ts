// A gap index is before that occurrence; length means after the last occurrence.
export function insertedMessage<T>(
  items: readonly T[],
  item: T,
  index: number,
): T[] | null {
  if (
    items.length < 1 ||
    items.length >= 32 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > items.length
  )
    return null;
  return [...items.slice(0, index), item, ...items.slice(index)];
}
