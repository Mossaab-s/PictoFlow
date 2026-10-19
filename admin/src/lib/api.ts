import { accessEpoch } from "./access-transition.ts";

let csrfToken: string | null = null;
export function setCSRFToken(value: string | null) {
  csrfToken = value;
}

export class APIError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 401
        ? "Reconnectez-vous pour continuer."
        : status === 403
          ? "Cet accès ne permet pas cette action."
          : status === 429
            ? "Trop de tentatives. Réessayez dans quinze minutes."
            : status === 503
              ? "Le service est indisponible."
              : status === 502
                ? "Le modèle IA n'a pas renvoyé de proposition exploitable. Vos mots sont conservés ; vous pouvez réessayer."
                : `La requête a échoué (${status}).`,
    );
    this.status = status;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const requestedToken = csrfToken;
  const requestedEpoch = accessEpoch();
  const response = await fetch(`/api/pictoflow/${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...options?.headers,
    },
  });
  if (requestedToken !== csrfToken || requestedEpoch !== accessEpoch())
    throw new Error("Votre accès a changé. Rechargez cet écran.");
  if (!response.ok) {
    if (
      [403, 404].includes(response.status) &&
      csrfToken &&
      !path.startsWith("auth/") &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("pictoflow:access-changed"));
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("pictoflow:session-expired"));
    throw new APIError(response.status);
  }
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T;
  if (requestedToken !== csrfToken || requestedEpoch !== accessEpoch())
    throw new Error("Votre accès a changé. Rechargez cet écran.");
  return result;
}

export type Profile = {
  id: string;
  version: number;
  created_at: string;
  display_name?: string | null;
};
export type Row = Record<string, unknown>;
export const sections = {
  concepts: "Concepts",
  representations: "Représentations",
  "semantic-space": "Espace sémantique",
  keyboard: "Clavier",
  communication: "Communiquer",
  memory: "Mémoire",
  "ai-quality": "Qualité IA",
  suggestions: "Suggestions",
  audit: "Historique",
  backup: "Sauvegarde",
} as const;
export type Section = keyof typeof sections;
