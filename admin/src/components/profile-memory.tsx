"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  blockRepresentation,
  type Block,
  type Concept,
  type Representation,
  type HumanRole,
} from "@/lib/keyboard";
import {
  memoryMatches,
  messageText,
  messageTouches,
  relationWords,
  scopedMemory,
  type Memory,
} from "@/lib/memory";
import { ProfileNavigation, HumanRoleSelector } from "./profile-navigation";
import PhraseShortcut from "./phrase-shortcut";
import { useAuthentication } from "./authentication";
import { canPrepare, canProfile, profileToolPath } from "@/lib/access";
import { TouchContent } from "./pictogram";
import MemoryEvidence, { memoryDate } from "./memory-evidence";

type Bundle = {
  memory: Memory;
  blocks: Block[];
  concepts: Concept[];
  visuals: Representation[];
};
type Category = "all" | "messages" | "blocks" | "relations";
const pageSize = 10;

export default function ProfileMemory({ profileId }: { profileId: string }) {
  const session = useAuthentication();
  const canEdit = canPrepare(session, profileId);
  const canHistory = canProfile(session, profileId, "view_history");
  const canCommunicate = canProfile(session, profileId, "communicate");
  const [validated, setValidated] = useState(true);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [role, setRole] = useState<HumanRole>("user");
  const [pages, setPages] = useState({ messages: 0, blocks: 0, relations: 0 });
  const pending = useRef<AbortController | null>(null);
  const base = `profiles/${profileId}`;
  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setBundle(null);
    setError("");
    try {
      const [memory, blocks, concepts, visuals] = await Promise.all([
        api<Memory>(`${base}/memory?validated=${validated}`, {
          signal: controller.signal,
        }),
        api<Block[]>(`${base}/blocks`, { signal: controller.signal }),
        api<Concept[]>(`${base}/concepts`, { signal: controller.signal }),
        api<Representation[]>(`${base}/representations`, {
          signal: controller.signal,
        }),
      ]);
      if (!controller.signal.aborted) {
        setBundle({
          memory: scopedMemory(profileId, memory, validated),
          blocks: blocks.filter((v) => v.profile_id === profileId),
          concepts: concepts.filter((v) => v.profile_id === profileId),
          visuals: visuals.filter((v) => v.profile_id === profileId),
        });
        setPages({ messages: 0, blocks: 0, relations: 0 });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error ? error.message : "Mémoire indisponible.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [base, profileId, validated]);
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, [load]);
  function partition(value: boolean) {
    if (validated === value) return;
    pending.current?.abort();
    setBundle(null);
    setLoading(true);
    setValidated(value);
  }
  function resetPages() {
    setPages({ messages: 0, blocks: 0, relations: 0 });
  }
  const memory = bundle?.memory;
  const messages =
    memory?.interpretations
      .filter((item) =>
        memoryMatches(
          [
            messageText(item, validated) ?? "",
            item.status === "corrected" ? item.text : "",
            ...(
              messageTouches(
                profileId,
                item,
                memory.sequences,
                bundle?.blocks ?? [],
              ) ?? []
            ).map((b) => b?.label ?? ""),
          ].join(" "),
          query,
        ),
      )
      .sort(
        (a, b) =>
          Date.parse(b.created_at) - Date.parse(a.created_at) ||
          a.id.localeCompare(b.id),
      ) ?? [];
  const blocks =
    memory?.blocks.filter((item) =>
      memoryMatches(item.label + " " + (item.canonical_intent ?? ""), query),
    ) ?? [];
  const relations =
    memory?.relations.filter((item) =>
      memoryMatches(
        (relationWords(profileId, item, bundle?.concepts ?? []) ?? []).join(
          " ",
        ),
        query,
      ),
    ) ?? [];
  const total = messages.length + blocks.length + relations.length;
  function pagination(
    kind: "messages" | "blocks" | "relations",
    count: number,
  ) {
    const last = Math.max(0, Math.ceil(count / pageSize) - 1);
    const page = Math.min(pages[kind], last);
    return (
      count > pageSize && (
        <nav
          className="memory-pagination"
          aria-label={`Pagination ${kind === "messages" ? "des messages" : kind === "blocks" ? "des touches" : "des relations"}`}
        >
          <button
            className="secondary"
            disabled={page === 0}
            onClick={() => setPages((v) => ({ ...v, [kind]: page - 1 }))}
          >
            Précédent
          </button>
          <span role="status">
            Page {page + 1} sur {last + 1}
          </span>
          <button
            className="secondary"
            disabled={page === last}
            onClick={() => setPages((v) => ({ ...v, [kind]: page + 1 }))}
          >
            Suivant
          </button>
        </nav>
      )
    );
  }
  function shown<T>(values: T[], page: number) {
    const start =
      Math.min(page, Math.max(0, Math.ceil(values.length / pageSize) - 1)) *
      pageSize;
    return values.slice(start, start + pageSize);
  }
  return (
    <>
      <ProfileNavigation profileId={profileId} section="memory" />
      <section className="page memory-page">
        <div className="eyebrow">LES MOTS ET LES SENS DE CE PROFIL</div>
        <h1>Ma mémoire de communication</h1>
        <p>
          Retrouvez les messages acceptés, les touches et les liens personnels
          conservés dans le PCL.
        </p>
        <div
          className="tabs"
          role="group"
          aria-label="Choisir la mémoire affichée"
        >
          <button
            aria-pressed={validated}
            className={validated ? "" : "secondary"}
            onClick={() => partition(true)}
          >
            Mémoire validée
          </button>
          <button
            aria-pressed={!validated}
            className={validated ? "secondary" : ""}
            onClick={() => partition(false)}
          >
            Propositions à vérifier
          </button>
        </div>
        <p className="notice">
          {validated
            ? "Les messages affichés ont été acceptés ou corrigés. La phrase retenue respecte la correction humaine."
            : "Ces éléments restent des propositions. Cette lecture ne les valide pas."}{" "}
          {canHistory && (
            <>
              Les refus restent consultables dans{" "}
              <Link href={profileToolPath(session, profileId, "audit")}>
                l’historique
              </Link>
              .
            </>
          )}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}{" "}
            <button className="secondary" onClick={() => void load()}>
              Réessayer
            </button>
          </p>
        )}
        {loading ? (
          <p role="status">Chargement de la mémoire…</p>
        ) : (
          bundle && (
            <>
              <div className="memory-counts">
                <span>{memory?.interpretations.length ?? 0} messages</span>
                <span>{memory?.blocks.length ?? 0} touches</span>
                <span>{memory?.relations.length ?? 0} relations</span>
              </div>
              <div className="memory-filters">
                <label>
                  Rechercher dans cette mémoire
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      resetPages();
                    }}
                    placeholder="Un mot, une phrase ou un lien"
                  />
                </label>
                <label>
                  Afficher
                  <select
                    value={category}
                    onChange={(event) => {
                      setCategory(event.target.value as Category);
                      resetPages();
                    }}
                  >
                    <option value="all">Tout</option>
                    <option value="messages">Messages</option>
                    <option value="blocks">Touches</option>
                    <option value="relations">Relations</option>
                  </select>
                </label>
                <button className="secondary" onClick={() => void load()}>
                  Actualiser
                </button>
              </div>
              {(category === "all" || category === "messages") && (
                <section className="memory-section" aria-label="Messages">
                  <h2>
                    {validated ? "Messages acceptés" : "Messages proposés"}{" "}
                    <span className="tag">{messages.length}</span>
                  </h2>
                  {validated && (
                    <>
                      <p>
                        Choisissez les phrases à retrouver facilement dans
                        l’espace de communication. Ce choix ne crée pas une
                        nouvelle validation.
                      </p>
                      <HumanRoleSelector
                        value={role}
                        onChange={setRole}
                        label="Je choisis mes raccourcis en tant que"
                      />
                    </>
                  )}
                  {shown(messages, pages.messages).map((item) => {
                    const touches = messageTouches(
                      profileId,
                      item,
                      memory?.sequences ?? [],
                      bundle.blocks,
                    );
                    return (
                      <article className="panel memory-card" key={item.id}>
                        <div className="memory-card-heading">
                          <span className="tag">
                            {item.status === "corrected"
                              ? "Corrigé"
                              : validated
                                ? "Confirmé"
                                : "À vérifier"}
                          </span>
                          <span>Proposé le {memoryDate(item.created_at)}</span>
                        </div>
                        <h3 className="memory-phrase">
                          {messageText(item, validated)}
                        </h3>
                        {item.status === "corrected" && (
                          <details className="memory-original">
                            <summary>Voir la proposition d’origine</summary>
                            <p>{item.text}</p>
                          </details>
                        )}
                        <p className="muted">
                          {item.source === "pcl"
                            ? "Formulation issue du PCL"
                            : "Formulation initiale enregistrée"}
                        </p>
                        <p className="memory-touch-caption">
                          Touches liées, avec l’affichage actuel du clavier :
                        </p>
                        {touches ? (
                          <ol className="memory-touches">
                            {touches.map((block, index) => (
                              <li key={index}>
                                {block ? (
                                  <TouchContent
                                    label={block.label}
                                    representation={blockRepresentation(
                                      profileId,
                                      block,
                                      bundle.visuals,
                                    )}
                                  />
                                ) : (
                                  <span>Touche indisponible</span>
                                )}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p>Séquence indisponible pour ce message.</p>
                        )}
                        <MemoryEvidence
                          profileId={profileId}
                          type="interpretation"
                          targetId={item.id}
                        />
                        {validated && (
                          <div className="actions">
                            {canCommunicate && (
                              <Link
                                className="button-link"
                                href={`/communication/${profileId}?phrase=${item.id}`}
                              >
                                Utiliser ce message
                              </Link>
                            )}
                            <PhraseShortcut
                              profileId={profileId}
                              item={item}
                              role={role}
                              onChange={(changed) =>
                                setBundle((previous) =>
                                  previous
                                    ? {
                                        ...previous,
                                        memory: {
                                          ...previous.memory,
                                          interpretations:
                                            previous.memory.interpretations.map(
                                              (v) =>
                                                v.id === changed.id
                                                  ? { ...v, ...changed }
                                                  : v,
                                            ),
                                        },
                                      }
                                    : null,
                                )
                              }
                            />
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {!messages.length && (
                    <p>
                      {query
                        ? "Aucun message ne correspond à cette recherche."
                        : validated
                          ? "Aucun message accepté pour le moment. Une confirmation ou une correction en communication l’ajoutera ici."
                          : "Aucun message en attente de validation."}
                    </p>
                  )}
                  {pagination("messages", messages.length)}
                </section>
              )}
              {(category === "all" || category === "blocks") && (
                <section className="memory-section" aria-label="Touches">
                  <h2>
                    {validated ? "Touches validées" : "Touches proposées"}{" "}
                    <span className="tag">{blocks.length}</span>
                  </h2>
                  <div className="memory-blocks">
                    {shown(blocks, pages.blocks).map((block) => (
                      <article className="panel memory-card" key={block.id}>
                        <div className="memory-block-visual">
                          <TouchContent
                            label={block.label}
                            representation={blockRepresentation(
                              profileId,
                              block,
                              bundle.visuals,
                              !validated,
                            )}
                          />
                        </div>
                        <p>
                          {block.canonical_intent
                            ? `Intention : ${block.canonical_intent}`
                            : `Sens : ${bundle.concepts.find((c) => c.id === block.concept_id)?.label ?? "Concept indisponible"}`}
                        </p>
                        <span className="tag">
                          {validated ? "Validée" : "À vérifier"}
                          {block.stability === "stable"
                            ? " · Repère stable"
                            : ""}
                        </span>
                        <MemoryEvidence
                          profileId={profileId}
                          type="communication_block"
                          targetId={block.id}
                        />
                      </article>
                    ))}
                  </div>
                  {!blocks.length && (
                    <p>
                      {query
                        ? "Aucune touche ne correspond à cette recherche."
                        : "Aucune touche dans cette partie de la mémoire."}
                    </p>
                  )}
                  {pagination("blocks", blocks.length)}
                  {canEdit && (
                    <Link
                      className="button-link secondary"
                      href={profileToolPath(session, profileId, "keyboard")}
                    >
                      Préparer le clavier
                    </Link>
                  )}
                </section>
              )}
              {(category === "all" || category === "relations") && (
                <section className="memory-section" aria-label="Relations">
                  <h2>
                    {validated
                      ? "Relations personnelles validées"
                      : "Relations proposées"}{" "}
                    <span className="tag">{relations.length}</span>
                  </h2>
                  {shown(relations, pages.relations).map((relation) => {
                    const words = relationWords(
                      profileId,
                      relation,
                      bundle.concepts,
                    );
                    return (
                      <article className="panel memory-card" key={relation.id}>
                        <h3 className="memory-relation">
                          <strong>{words?.[0]}</strong>{" "}
                          <span>{words?.[1]}</span>{" "}
                          <strong>{words?.[2]}</strong>
                        </h3>
                        <p>
                          {relation.validation_count} confirmations ·{" "}
                          {relation.rejection_count} refus enregistrés
                        </p>
                        <span className="tag">
                          {validated ? "Validée" : "À vérifier"}
                        </span>
                        <MemoryEvidence
                          profileId={profileId}
                          type="semantic_relation"
                          targetId={relation.id}
                        />
                      </article>
                    );
                  })}
                  {!relations.length && (
                    <p>
                      {query
                        ? "Aucune relation ne correspond à cette recherche."
                        : "Aucune relation dans cette partie de la mémoire. Communiquer ne crée pas automatiquement une relation validée."}
                    </p>
                  )}
                  {pagination("relations", relations.length)}
                </section>
              )}
              {!total && query && (
                <button className="secondary" onClick={() => setQuery("")}>
                  Effacer la recherche
                </button>
              )}
            </>
          )
        )}
      </section>
    </>
  );
}
