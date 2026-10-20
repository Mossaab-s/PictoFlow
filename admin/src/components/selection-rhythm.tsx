"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Report = {
  intervals: {
    interval_ms: number;
    blocked_ms: number;
    available_ms: number;
    input_method: string;
  }[];
  median_available_ms: number | null;
  partial: boolean;
};
const seconds = (value: number) =>
  `${(value / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} s`;
export default function SelectionRhythm({
  profileId,
  sequenceId,
  enabled,
  onChange,
  disabled,
}: {
  profileId: string;
  sequenceId: string | null;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled: boolean;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load() {
    if (!sequenceId || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await api<Report>(
        `profiles/${profileId}/sequences/${sequenceId}/rhythm`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setReport(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Observation indisponible.",
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="panel rhythm-panel">
      <h2>Observer mon rythme, facultatif</h2>
      <label className="rhythm-choice">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />{" "}
        Enregistrer les intervalles entre mes prochaines touches
      </label>
      <p className="helper">
        Ce choix vaut pour cet écran ouvert. Les observations restent dans ce
        profil ; elles ne sont pas envoyées à l’IA et ne lui attribuent aucune
        émotion.
      </p>
      <p className="helper">
        Les pauses et les délais pendant lesquels le clavier attend
        l’enregistrement sont distingués. Ces durées ne mesurent pas à elles
        seules votre intention ou votre état d’esprit.
      </p>
      {sequenceId && (
        <details
          onToggle={(e) => {
            if (e.currentTarget.open) void load();
          }}
        >
          <summary>Voir le rythme observé de ce message</summary>
          <button
            className="secondary"
            disabled={busy || disabled}
            onClick={() => void load()}
          >
            Actualiser les observations
          </button>
          {busy && <p role="status">Chargement des observations…</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {report && (
            <>
              {!report.intervals.length ? (
                <p>
                  Aucun intervalle enregistré. Deux sélections observées
                  consécutives dans cet écran sont nécessaires.
                </p>
              ) : (
                <>
                  <p>
                    {report.intervals.length} intervalle(s) observé(s). Durée
                    médiane hors attente d’enregistrement :{" "}
                    {seconds(report.median_available_ms!)}.
                  </p>
                  <ol>
                    {report.intervals.map((item, index) => (
                      <li key={index}>
                        Entre deux touches : {seconds(item.interval_ms)}, dont{" "}
                        {seconds(item.blocked_ms)} d’attente d’enregistrement.{" "}
                        {item.input_method === "keyboard"
                          ? "Clavier"
                          : item.input_method === "pointer"
                            ? "Souris ou pointeur"
                            : "Mode non renseigné"}
                        .
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <p>
                Les gestes observés restent visibles même si une touche a
                ensuite été annulée ou retirée. Ils ne constituent pas un sens
                validé.
              </p>
              {report.partial && (
                <p>Historique partiel : la limite de lecture a été atteinte.</p>
              )}
            </>
          )}
        </details>
      )}
    </section>
  );
}
