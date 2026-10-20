export type CopyAttempt = { sourceId: string; requestId: string };
export const copyAttemptKey = (profileId: string) =>
  `pictoflow:sequence:copy:${profileId}`;

// The existing sequence/session cleanup also removes this prefix on account changes.
export function parseCopyAttempt(value: string | null): CopyAttempt | null {
  if (!value) return null;
  try {
    const item = JSON.parse(value);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      typeof item?.sourceId !== "string" ||
      typeof item?.requestId !== "string" ||
      !uuid.test(item.sourceId) ||
      !uuid.test(item.requestId) ||
      item.sourceId === item.requestId
    )
      return null;
    return { sourceId: item.sourceId, requestId: item.requestId };
  } catch {
    return null;
  }
}
