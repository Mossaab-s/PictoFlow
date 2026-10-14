export function contrastStorageKey(profileId: string) {
  return `pictoflow:contrast:${profileId}`;
}
export function parseContrast(value: string | null): boolean {
  try {
    const data = value ? JSON.parse(value) : null;
    return data?.version === 1 && data.enhanced === true;
  } catch {
    return false;
  }
}
export function serializeContrast(enhanced: boolean) {
  return JSON.stringify({ version: 1, enhanced });
}
