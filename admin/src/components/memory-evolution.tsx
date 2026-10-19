"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { canProfile, profileToolPath } from "@/lib/access";
import {
  blockRepresentation,
  type Block,
  type Representation,
  type Sequence,
} from "@/lib/keyboard";
import { humanRoles, messageText, type MemoryMessage } from "@/lib/memory";
import {
  evolutionPage,
  type HistoryEvent,
  type MemoryChange,
} from "@/lib/memory-evolution";
import { useAuthentication } from "./authentication";
import { ProfileNavigation } from "./profile-navigation";
import MemoryEvidence, { memoryDate } from "./memory-evidence";
import { TouchContent } from "./pictogram";

type Context = {
  revision: number;
  sequences: Sequence[];
  candidates: MemoryMessage[];
  blocks: Block[];
  visuals: Representation[];
};
const titles = {
  confirm: "Phrase confirmée",
  correct: "Phrase corrigée",
  withdraw: "Phrase retirée de la mémoire",
};

export default function MemoryEvolution({
  profileId,
  compact = false,
}: {
  profileId: string;
  compact?: boolean;
}) {
  const session = useAuthentication();
  const [items, setItems] = useState<MemoryChange[]>([]);
  const [context, setContext] = useState<Context | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const gate = useRef(false);
  const revision = useRef(0);
  const base = `profiles/${profileId}`;
  const limit = compact ? 3 : 20;
  const load = useCallback(
    async (before: string | null = null) => {
      if (gate.current) return;
      gate.current = true;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({
          newest_first: "true",
          meaning_changes_only: "true",
          limit: String(limit + 1),
          ...(before ? { before } : {}),
        });
        const events = await api<HistoryEvent[]>(`${base}/audit?${query}`, {
          signal: controller.signal,
        });
        // Today's state must not predate a displayed decision.
        const [sequences, candidates, blocks, visuals] = await Promise.all([
          api<Sequence[]>(`${base}/sequences`, { signal: controller.signal }),
          api<MemoryMessage[]>(`${base}/interpretations`, {
            signal: controller.signal,
          }),
          api<Block[]>(`${base}/blocks`, { signal: controller.signal }),
          api<Representation[]>(`${base}/representations`, {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted) return;
        const page = evolutionPage(profileId, events, limit);
        setItems((previous) => [
          ...new Map(
            [...(before ? previous : []), ...page.items].map((item) => [
              item.event.id,
              item,
            ]),
          ).values(),
        ]);
        setCursor(page.next_cursor);
        setContext({
          revision: ++revision.current,
          sequences: sequences.filter((item) => item.profile_id === profileId),
          candidates: candidates.filter(
            (item) => item.profile_id === profileId,
          ),
          blocks: blocks.filter((item) => item.profile_id === profileId),
          visuals: visuals.filter((item) => item.profile_id === profileId),
        });
      } catch {
        if (!controller.signal.aborted)
          setError(
            "L’évolution de la mémoire ne peut pas être vérifiée. Actualisez pour retrouver les décisions et leur état actuel.",
          );
      } finally {
        gate.current = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [base, profileId, limit],
  );
  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      gate.current = false;
    };
  }, [load]);
  return (
    <>
      {!compact && <ProfileNavigation profileId={profileId} section="audit" />}
      <section
        className={compact ? "panel memory-evolution" : "page memory-evolution"}
        aria-label="Évolution de la mémoire"
      >
        {compact ? (
          <h2>Évolution de la mémoire</h2>
        ) : (
          <>
            <div className="eyebrow">SUIVRE CETTE PERSONNE</div>
            <h1>Ce que la mémoire a retenu</h1>
          </>
        )}
        <p>
          Retrouvez les phrases retenues, leurs corrections et leurs retraits,
          après une décision humaine.
        </p>
        <p className="helper">
          L’état actuel correspond à la dernière actualisation de cet écran.
        </p>
        <div className="actions">
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            Actualiser l’évolution
          </button>
          {compact ? (
            <Link
              className="text-link"
              href={`/accompagnement/personnes/${profileId}/historique`}
            >
              Voir toute l’évolution
            </Link>
          ) : (
            <>
              <Link
                className="text-link"
                href={profileToolPath(session, profileId, "memory")}
              >
                Consulter les phrases et la mémoire
              </Link>
              {canProfile(session, profileId, "review_meanings") && (
                <Link
                  className="text-link"
                  href={`/accompagnement/personnes/${profileId}/a-verifier`}
                >
                  Vérifier les phrases en attente
                </Link>
              )}
            </>
          )}
        </div>
        {loading && <p role="status">Chargement des décisions…</p>}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          context && (
            <>
              <ol className="memory-evolution-list">
                {items.map((item) => (
                  <Change
                    key={item.event.id}
                    profileId={profileId}
                    item={item}
                    context={context}
                    compact={compact}
                  />
                ))}
              </ol>
              {!items.length && !loading && (
                <div className="empty">
                  <h2>Aucune phrase retenue pour le moment</h2>
                  <p>
                    Les phrases apparaîtront ici après leur confirmation ou leur
                    correction dans ce profil.
                  </p>
                </div>
              )}
              {!compact && cursor && (
                <button
                  className="secondary"
                  disabled={loading}
                  onClick={() => void load(cursor)}
                >
                  Voir les décisions plus anciennes
                </button>
              )}
            </>
          )
        )}
      </section>
    </>
  );
}

function Change({
  profileId,
  item,
  context,
  compact,
}: {
  profileId: string;
  item: MemoryChange;
  context: Context;
  compact: boolean;
}) {
  const sequence = context.sequences.find(
    (value) =>
      value.id === item.after.sequence_id && value.status === "completed",
  );
  const current = context.candidates.find(
    (value) =>
      value.id === item.event.target_id &&
      value.sequence_id === item.after.sequence_id,
  );
  const accepted = current ? messageText(current, true) : null;
  const role = item.event.source.startsWith("human:")
    ? item.event.source.slice(6)
    : "";
  const Heading = compact ? "h3" : "h2";
  return (
    <li>
      <article
        className="panel memory-change"
        aria-label={titles[item.action]}
        data-event-id={item.event.id}
      >
        <header>
          <Heading>{titles[item.action]}</Heading>
          <time dateTime={item.event.created_at}>
            {memoryDate(item.event.created_at)}
          </time>
        </header>
        <p>
          {Object.hasOwn(humanRoles, role)
            ? humanRoles[role as keyof typeof humanRoles]
            : "Rôle non renseigné"}
        </p>
        {sequence ? (
          <>
            <p className="helper">
              Touches d’origine, dans l’ordre choisi. Dessins et mots actuels.
            </p>
            <ol className="memory-touches" aria-label="Pictogrammes du message">
              {sequence.block_ids.map((id, index) => {
                const block = context.blocks.find((value) => value.id === id);
                return (
                  <li key={index}>
                    <TouchContent
                      label={block?.label ?? "Touche indisponible"}
                      representation={
                        block
                          ? blockRepresentation(
                              profileId,
                              block,
                              context.visuals,
                            )
                          : undefined
                      }
                    />
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p>Touches d’origine indisponibles.</p>
        )}
        {item.action === "correct" && (
          <>
            <h4>
              {item.previousText
                ? "Phrase retenue auparavant"
                : "Proposition de départ"}
            </h4>
            <p className="memory-change-text">
              {item.previousText ?? item.before.text}
            </p>
          </>
        )}
        <h4>
          {item.action === "withdraw"
            ? "Phrase retirée à cette date"
            : "Phrase retenue à cette date"}
        </h4>
        <p className="memory-change-text">
          {item.acceptedText ?? item.previousText}
        </p>
        <div className="memory-change-current">
          <strong>
            {accepted
              ? "Aujourd’hui : phrase retenue"
              : current?.status === "rejected"
                ? "Aujourd’hui : phrase refusée ou retirée"
                : "État actuel non confirmé"}
          </strong>
          {accepted && <p>{accepted}</p>}
        </div>
        {!compact && (
          <MemoryEvidence
            key={`${item.event.id}:${context.revision}`}
            profileId={profileId}
            type="interpretation"
            targetId={item.event.target_id}
          />
        )}
      </article>
    </li>
  );
}
