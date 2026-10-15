"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { compositionMemory } from "@/lib/learning";
import { messageText, scopedMemory, type Memory } from "@/lib/memory";
import type { Sequence } from "@/lib/keyboard";

export default function CompositionMemory({
  profileId,
  sequence,
  revision,
  disabled,
  canReplay,
  onReplay,
  onChoose,
}: {
  profileId: string;
  sequence: Sequence;
  revision: unknown;
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
            <p>
              Ce nouveau message n’a pas encore de sens validé. Une proposition
              seule n’entre pas dans votre mémoire validée.
            </p>
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
