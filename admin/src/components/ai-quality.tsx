"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ProfileNavigation } from "./profile-navigation";

type Summary = {
  recorded_attempts: number;
  provider_proposals: number;
  fallbacks: Record<string, number>;
  received_candidates: number;
  retained_candidates: number;
  attempts_with_corrections: number;
  recording_started_at: string | null;
  interpretation_states: Record<string, number>;
  human_actions: Record<string, number>;
};

const reasons: Record<string, string> = {
  disabled: "IA désactivée",
  model_refusal: "Le modèle n’a pas proposé de phrase",
  unfaithful_words: "Mots ajoutés, oubliés ou négation modifiée",
  low_confidence: "Confiance sous le seuil configuré",
  unavailable: "Provider indisponible",
  invalid_payload: "Réponse au format inexploitable",
};
const states: Record<string, string> = {
  proposed: "À valider",
  confirmed: "Confirmées",
  corrected: "Corrigées",
  rejected: "Rejetées",
  not_understood: "Sans interprétation",
};
const actions: Record<string, string> = {
  confirm: "Confirmations",
  correct: "Corrections",
  reject: "Rejets",
};

function Counts({
  labels,
  values,
}: {
  labels: Record<string, string>;
  values: Record<string, number>;
}) {
  return (
    <dl className="quality-counts">
      {Object.entries(labels).map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{values[key] ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AIQuality({ profileId }: { profileId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSummary(null);
    setError("");
    api<Summary>(`profiles/${profileId}/ai-quality`)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : "Lecture impossible.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, refresh]);
  return (
    <>
      <ProfileNavigation profileId={profileId} section="ai-quality" />
      <section className="page quality-page">
        <h1>Qualité des propositions IA</h1>
        <p>
          Ce bilan concerne uniquement ce profil. Il aide à repérer les refus et
          les corrections ; il ne mesure pas si une phrase exprime le sens voulu
          par la personne.
        </p>
        <button
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Actualiser le bilan
        </button>
        {loading && <p role="status">Chargement du bilan…</p>}
        {error && <p role="alert">{error}</p>}
        {summary && (
          <div className="quality-sections">
            <section className="quality-panel" aria-labelledby="attempts-title">
              <h2 id="attempts-title">Tentatives enregistrées</h2>
              <p>
                {summary.recording_started_at
                  ? `Depuis le ${new Date(summary.recording_started_at).toLocaleString("fr-FR")}.`
                  : "Aucune tentative enregistrée avec ce suivi pour le moment."}{" "}
                Les causes des anciens essais ne sont pas reconstituées. Chaque
                nouvelle demande compte une fois, même si elle fournit plusieurs
                phrases.
              </p>
              <Counts
                labels={{
                  recorded_attempts: "Demandes",
                  provider_proposals:
                    "Demandes avec une proposition du provider",
                  received_candidates: "Phrases reçues du provider",
                  retained_candidates: "Phrases retenues après les contrôles",
                  attempts_with_corrections:
                    "Demandes guidées par une correction humaine",
                }}
                values={{
                  recorded_attempts: summary.recorded_attempts,
                  provider_proposals: summary.provider_proposals,
                  received_candidates: summary.received_candidates,
                  retained_candidates: summary.retained_candidates,
                  attempts_with_corrections: summary.attempts_with_corrections,
                }}
              />
              <h3>Retour aux mots choisis</h3>
              <p>
                Lorsqu’aucune proposition n’est retenue, les mots restent
                disponibles dans leur ordre. Une IA désactivée n’est pas un
                échec du modèle.
              </p>
              <Counts labels={reasons} values={summary.fallbacks} />
            </section>
            <section
              className="quality-panel"
              aria-labelledby="decisions-title"
            >
              <h2 id="decisions-title">Décisions humaines</h2>
              <p>
                État actuel de toutes les phrases du profil, y compris les
                anciennes et les formulations littérales.
              </p>
              <Counts labels={states} values={summary.interpretation_states} />
              <h3>Historique des actions</h3>
              <p>
                Une même phrase peut avoir été corrigée puis rejetée. Ces
                nombres comptent les actions, pas des phrases distinctes.
              </p>
              <Counts labels={actions} values={summary.human_actions} />
              <Link href={`/admin/profiles/${profileId}/memory`}>
                Consulter les messages et leurs décisions
              </Link>
            </section>
            <section className="quality-panel" aria-labelledby="examples-title">
              <h2 id="examples-title">Réutilisation des corrections</h2>
              <p>
                Au plus trois corrections récentes, courtes et toujours
                acceptées peuvent guider la formulation de la même suite de
                touches, dans le même ordre et avec les mêmes répétitions. Une
                modification de leurs mots ou de leur sens les écarte ; le
                contexte ajouté pour un essai écarte aussi les anciens exemples.
              </p>
              <p>
                Les contrôles de mots et de négation restent actifs. Chaque
                nouvelle proposition demande un choix humain. Les dessins,
                photos et autres messages du profil ne sont pas envoyés au
                modèle comme exemples.
              </p>
            </section>
          </div>
        )}
      </section>
    </>
  );
}
