// A browser-wide fence for late responses and protected offline entry.
export const accessEpochKey = "pictoflow:access-epoch";
export const accompaniedKey = "pictoflow:accompanied";

export function accessEpoch(): string | null {
  try {
    const values = [
      localStorage.getItem(accessEpochKey),
      localStorage.getItem(accompaniedKey),
      localStorage.getItem("pictoflow:explicit-logout"),
    ];
    return values.some((value) => value !== null)
      ? JSON.stringify(values)
      : null;
  } catch {
    return null;
  }
}

export function accompaniedMarker(): string | null {
  try {
    return localStorage.getItem(accompaniedKey);
  } catch {
    return "locked";
  }
}

export function markAccompanied(value: string): void {
  localStorage.setItem(accompaniedKey, value);
  if (localStorage.getItem(accompaniedKey) !== value)
    throw new Error(
      "Ce navigateur ne permet pas de protéger le passage de relais.",
    );
}

export function publishAccessChange(): void {
  try {
    localStorage.setItem(accessEpochKey, crypto.randomUUID());
  } catch {
    /* Cookie revocation still applies. */
  }
  window.dispatchEvent(new Event("pictoflow:access-changed"));
}
