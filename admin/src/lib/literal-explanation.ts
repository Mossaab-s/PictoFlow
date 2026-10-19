const explanations = {
  disabled: "Lors de cet essai, l’aide IA était désactivée.",
  model_refusal: "L’IA n’a pas proposé de formulation pour cet essai.",
  unfaithful_words:
    "Les formulations reçues n’ont pas passé la vérification de vos mots.",
  low_confidence:
    "Le niveau de confiance annoncé par l’IA était trop faible pour proposer une phrase.",
  unavailable: "L’aide IA était indisponible lors de cet essai.",
  invalid_payload:
    "La réponse de l’IA n’a pas pu être utilisée pour proposer une phrase.",
} as const;

export function literalExplanation(reason: unknown): string {
  return typeof reason === "string" && Object.hasOwn(explanations, reason)
    ? explanations[reason as keyof typeof explanations]
    : "La raison de ce retour aux mots n’a pas été enregistrée.";
}
