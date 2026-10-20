export type ProviderOptions = {
  provider: "disabled" | "fake" | "openai-compatible" | "prism";
  base_url: string | null;
  model: string | null;
  response_format: "json_object" | "json_schema";
  timeout_seconds: number;
  temperature: number | null;
};
export type ProviderConfiguration = ProviderOptions & {
  version: number;
  source: "environment" | "admin";
  api_key_configured: boolean;
};
export type ProviderProbe = {
  connection: string;
  generation:
    | "proposal"
    | "model_refusal"
    | "invalid_payload"
    | "unavailable"
    | "disabled"
    | "unsupported";
  candidates: string[];
};
export function sameProviderEndpoint(
  current: ProviderOptions,
  draft: ProviderOptions,
) {
  function normalize(value: string | null) {
    if (!value) return null;
    try {
      return new URL(value.trim()).href.replace(/\/+$/, "");
    } catch {
      return value.trim();
    }
  }
  return (
    current.provider === draft.provider &&
    normalize(current.base_url) === normalize(draft.base_url)
  );
}
export const probeLabels: Record<ProviderProbe["generation"], string> = {
  proposal: "Une proposition structurée a été reçue.",
  model_refusal: "Le modèle n’a proposé aucune phrase pour cet exemple fictif.",
  invalid_payload:
    "La réponse ne respecte pas le format attendu par PictoFlow.",
  unavailable:
    "La génération a échoué : vérifiez l’adresse, le modèle, la clé et les limites du fournisseur.",
  disabled: "L’assistance IA est désactivée.",
  unsupported: "Ce fournisseur ne prend pas en charge la formulation.",
};
