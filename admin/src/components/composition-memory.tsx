"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { compositionMemory } from "@/lib/learning";
import { messageText, scopedMemory, type Memory } from "@/lib/memory";
import type { Decision, Sequence } from "@/lib/keyboard";
import MemoryEvidence, { memoryDate } from "./memory-evidence";

export default function CompositionMemory({
  profileId,
  sequence,
  revision,
  decision,
  disabled,
  canReplay,
  onReplay,
  onChoose,
}: {
  profileId: string;
  sequence: Sequence;
  revision: unknown;
  decision: Decision | null;
  disabled: boolean;
  canReplay: boolean;
  onReplay: () => void;
  onChoose: (id: string) => void;
}) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setMemory(null);
    setError("");
    try {
      const result = await api<Memory>(
        `profiles/${profileId}/memory?validated=true`,
        { signal: request.signal },
      );
      if (!request.signal.aborted)
        setMemory(scopedMemory(profileId, result, true));
    } catch {
      if (!request.signal.aborted)
        setError(
          "La mémoire ne peut pas être vérifiée pour le moment. Votre choix n’est pas modifié. Réessayez pour voir ce qui est conservé.",
        );
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [profileId]);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load, revision]);
  const result = memory ? compositionMemory(profileId, sequence, memory) : null;
  const candidates = (decision?.candidates ?? []).filter(
    (item) => item.profile_id === profileId && item.sequence_id === sequence.id,
  );
  return (
    <section
      className="panel composition-memory"
      aria-label="Mon PCL et ce message"
    >
      <div className="zone-heading">
        <h2>Ce que mon PCL retient</h2>
        <button
          className="secondary"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          Vérifier la mémoire
        </button>
      </div>
      {loading ? (
        <p role="status">Vérification de votre mémoire…</p>
      ) : error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : result ? (
        <>
          {result.retained ? (
            <div className="composition-retained" role="status">
              <span className="tag">
                {result.retained.status === "corrected"
                  ? "Votre correction est conservée"
                  : "Votre phrase est conservée"}
              </span>
              <p className="memory-phrase">
                {messageText(result.retained, true)}
              </p>
              <p>
                Ce sens vient de votre choix et reste dans la mémoire de ce
                profil. Vous pourrez retrouver cette phrase sans nouvelle
                proposition IA.
              </p>
              <details>
                <summary>Ce que ce choix a changé</summary>
                <p>
                  {result.retained.status === "corrected"
                    ? "Votre correction remplace la formulation initiale dans la mémoire acceptée et dans les suggestions de mots et de phrases."
                    : "Votre confirmation rend cette phrase disponible dans la mémoire acceptée et dans les suggestions de mots et de phrases."}
                </p>
                {result.retained.status === "corrected" && (
                  <p>Formulation initiale : {result.retained.text}</p>
                )}
                <p>
                  Aucun sens de touche, dessin ou emplacement du clavier n’a été
                  changé. Ce choix ne crée pas de relation sémantique et
                  n’entraîne pas le modèle IA.
                </p>
              </details>
              <MemoryEvidence
                key={
                  result.retained.id +
                  result.retained.status +
                  result.retained.corrected_text
                }
                profileId={profileId}
                type="interpretation"
                targetId={result.retained.id}
              />
              <button disabled={disabled || !canReplay} onClick={onReplay}>
                Refaire un essai avec les mêmes touches
              </button>
              {!canReplay && (
                <p>
                  Une touche n’est plus disponible. Composez un nouveau message
                  avec le clavier actuel.
                </p>
              )}
            </div>
          ) : (
            <div>
              <p>
                Ce nouveau message n’a pas encore de sens validé. Une
                proposition seule n’entre pas dans votre mémoire validée.
              </p>
              {candidates.some((item) => item.status === "rejected") && (
                <p role="status">
                  Le refus est enregistré dans l’historique humain. La phrase
                  écartée n’alimente plus les souvenirs acceptés ni leurs mots.
                  Les autres souvenirs du profil sont conservés.
                </p>
              )}
              {candidates.some((item) => item.status === "proposed") && (
                <p>
                  La proposition attend votre choix. Elle n’ajoute encore aucun
                  mot à vos suggestions de mémoire.
                </p>
              )}
            </div>
          )}
          {result.previous.length ? (
            <div className="composition-recalled">
              <h3>Déjà dit avec ces touches</h3>
              <p>
                Le PCL retrouve vos choix précédents, avec les mêmes touches
                dans le même ordre, répétitions comprises. Le contexte peut être
                différent : c’est vous qui choisissez votre sens aujourd’hui.
              </p>
              {result.previous.map((item) => (
                <article key={item.id} className="panel memory-card">
                  <p className="memory-phrase">{messageText(item, true)}</p>
                  <span className="tag">
                    Souvenir validé · sans nouvel appel IA
                  </span>
                  <details>
                    <summary>Pourquoi ce souvenir revient</summary>
                    <p>
                      Message créé le {memoryDate(item.created_at)}, puis
                      accepté pour les mêmes touches, dans le même ordre, avec
                      les mêmes répétitions. Le contexte libre précisé pour une
                      demande de phrase peut être différent aujourd’hui.
                      {item.status === "corrected" &&
                        " Votre correction humaine est prioritaire sur la formulation initiale."}
                    </p>
                    <p>
                      Ce rapprochement retrouve un ancien choix ; le sens de ce
                      nouveau message reste à choisir.
                    </p>
                    <MemoryEvidence
                      profileId={profileId}
                      type="interpretation"
                      targetId={item.id}
                    />
                  </details>
                  <button disabled={disabled} onClick={() => onChoose(item.id)}>
                    Retrouver cette phrase
                  </button>
                </article>
              ))}
              <p className="helper">
                Retrouver une phrase conserve votre composition et ne valide pas
                ce nouveau message à votre place.
              </p>
            </div>
          ) : !result.retained ? (
            <p>
              Aucun message déjà accepté n’a été retrouvé pour cette
              composition. Vous pouvez lire vos mots ou demander une
              proposition, puis choisir ce que vous voulez dire.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
