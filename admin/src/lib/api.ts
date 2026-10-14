export class APIError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 503
        ? "Le service est indisponible."
        : status === 502
          ? "Le modèle IA n'a pas renvoyé de proposition exploitable. Vos mots sont conservés ; vous pouvez réessayer."
          : `La requête a échoué (${status}).`,
    );
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/pictoflow/${path}`, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) throw new APIError(response.status);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
  suggestions: "Suggestions",
  audit: "Historique",
  backup: "Sauvegarde",
} as const;
export type Section = keyof typeof sections;
