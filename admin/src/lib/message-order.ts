// Destination is the final zero-based index, after taking out one occurrence.
export function movedMessage<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] | null {
  if (
    items.length < 2 ||
    items.length > 32 ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  )
    return null;
  const result = [...items];
  const [selected] = result.splice(from, 1);
  result.splice(to, 0, selected);
  return result;
}
