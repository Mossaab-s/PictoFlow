"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { keyboardUsage } from "@/lib/keyboard-usage";
import { scopedMemory, type Memory } from "@/lib/memory";
import {
  blockRepresentation,
  type Block,
  type Position,
  type Representation,
} from "@/lib/keyboard";
import { TouchContent } from "./pictogram";

export default function KeyboardUsage({
  profileId,
  blocks,
  positions,
  visuals,
}: {
  profileId: string;
  blocks: Block[];
  positions: Position[];
  visuals: Representation[];
}) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  async function load() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setMemory(null);
    setError("");
    setBusy(true);
    try {
      const value = await api<Memory>(
        `profiles/${profileId}/memory?validated=true`,
        { signal: request.signal },
      );
      if (!request.signal.aborted)
        setMemory(scopedMemory(profileId, value, true));
    } catch {
      if (!request.signal.aborted)
        setError(
          "Les usages acceptés ne peuvent pas être vérifiés. Réessayez.",
        );
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => () => controller.current?.abort(), []);
  const items = memory
    ? keyboardUsage(profileId, memory, blocks, positions)
    : [];
  return (
    <section className="panel" aria-label="Touches souvent choisies">
      <h2>Mes touches souvent choisies</h2>
      <p>
        Retrouvez jusqu’à cinq touches choisies dans au moins deux messages
        acceptés. Vous pouvez revoir leur place avec votre aidant. Les repères
        stables restent à leur place.
      </p>
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        Examiner mes usages acceptés
      </button>
      {busy && <p role="status">Lecture des messages acceptés…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {memory && !items.length && (
        <p>
          Aucune touche à proposer pour le moment : il faut au moins deux
          messages acceptés utilisant la même touche disponible.
        </p>
      )}
      <div className="block-list">
        {items.map((item) => (
          <article key={item.block.id} className="panel">
            <div className="touch-sample">
              <TouchContent
                label={item.block.label}
                representation={blockRepresentation(
                  profileId,
                  item.block,
                  visuals,
                )}
              />
            </div>
            <p>Choisie dans {item.count} messages acceptés de ce profil.</p>
            <details>
              <summary>Pourquoi cette touche apparaît</summary>
              <p>
                Chaque message compte une fois, même si la touche y est répétée.
                Ce calcul décrit vos choix de touches ; il ne déduit pas un
                nouveau sens.
              </p>
              <ul>
                {item.examples.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </details>
            <a
              className="button-link secondary"
              href={`#touch-${item.block.id}`}
            >
              Choisir la place de « {item.block.label} »
            </a>
          </article>
        ))}
      </div>
      {items.length > 0 && (
        <p className="helper">
          Le lien ouvre les réglages de la touche. Le déplacement demande votre
          choix d’une page et d’une place, puis un aperçu et une validation
          explicite. Examiner les usages ne déplace rien.
        </p>
      )}
    </section>
  );
}
