import type { Zone } from "./keyboard";

export type DisplaySize = "standard" | "large" | "extra-large";
export const displays = {
  standard: { label: "Classique", size: 12, columns: 4 },
  large: { label: "Grandes touches", size: 6, columns: 3 },
  "extra-large": { label: "Très grandes touches", size: 4, columns: 2 },
} as const;

export function zoneDisplay(zone: Zone, size: DisplaySize) {
  // Stable anchors retain their existing pagination and grid in every mode.
  return displays[zone === "stable" ? "standard" : size];
}

export function displayStorageKey(profileId: string) {
  return `pictoflow:display:${profileId}`;
}

export function parseDisplay(value: string | null): DisplaySize {
  try {
    const data = value ? JSON.parse(value) : null;
    if (
      data?.version === 1 &&
      typeof data.size === "string" &&
      Object.hasOwn(displays, data.size)
    )
      return data.size as DisplaySize;
  } catch {
    // A stale or damaged setting cannot prevent communication.
  }
  return "standard";
}

export function serializeDisplay(size: DisplaySize) {
  return JSON.stringify({ version: 1, size });
}
