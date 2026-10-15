"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Context = {
  personal_hypothesis: boolean;
  references: {
    interpretation_id: string;
    available: boolean;
    text: string | null;
  }[];
};

export default function AIContext({
  profileId,
  interpretationId,
}: {
  profileId: string;
  interpretationId: string;
}) {
  const [value, setValue] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function load() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setValue(null);
    try {
      const result = await api<Context>(
        `profiles/${profileId}/interpretations/${interpretationId}/ai-context`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setValue(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Références indisponibles.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>Sur quoi cette proposition s’appuie-t-elle ?</summary>
      <p>
        La phrase est une hypothèse à choisir, corriger ou refuser. Le score du
        modèle ne prouve pas votre intention.
      </p>
      {busy && <p role="status">Chargement des références…</p>}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Réessayer
          </button>
        </p>
      )}
      {value && (
        <>
          <p>
            {value.personal_hypothesis
              ? "Cette formulation plus souple est soutenue par une association acceptée de votre profil. Elle reste à vérifier pour ce message."
              : "La proposition a passé le contrôle des mots sélectionnés. Cela ne garantit pas que les rôles et le sens vous conviennent."}
          </p>
          {value.references.length ? (
            <>
              <p>
                {value.personal_hypothesis
                  ? "Association personnelle de référence :"
                  : "Références personnelles fournies pour cet essai :"}
              </p>
              <ul>
                {value.references.map((ref) => (
                  <li key={ref.interpretation_id}>
                    {ref.available
                      ? ref.text
                      : "Cette référence a été retirée ou modifiée ; son ancien texte n’est pas réutilisé ici."}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              Aucune référence personnelle enregistrée pour cette proposition.
            </p>
          )}
          <p>
            Votre correction validée deviendra une référence pour les prochains
            essais de ce profil.
          </p>
        </>
      )}
    </details>
  );
}
