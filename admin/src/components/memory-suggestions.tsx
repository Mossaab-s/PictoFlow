"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { newIdentity, type HumanRole, type Sequence } from "@/lib/keyboard";
import {
  joinMemoryWords,
  wordKey,
  type SuggestionMode,
  type MemoryProposalBody,
  type MemoryReference,
  type MemorySuggestionPage,
  type SuggestedWord,
} from "@/lib/memory-suggestions";
import { HumanRoleSelector } from "./profile-navigation";
import { TouchContent } from "./pictogram";

export default function MemorySuggestions({
  profileId,
  sequence,
  mode,
  onModeChange,
  temporary,
  disabled,
  revision,
  onPropose,
}: {
  profileId: string;
  sequence: Sequence | null;
  mode: SuggestionMode;
  onModeChange: (mode: SuggestionMode) => void;
  temporary: boolean;
  disabled: boolean;
  revision: unknown;
  onPropose: (body: MemoryProposalBody) => Promise<boolean>;
}) {
  const [page, setPage] = useState<MemorySuggestionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [words, setWords] = useState<SuggestedWord[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [role, setRole] = useState<HumanRole>("user");
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const identity = useRef<{ fingerprint: string; id: string } | null>(null);
  const sequenceId = sequence?.id;
  const completed = sequence?.status === "completed";
  const lastSequence = useRef(sequenceId);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPage(null);
    setError("");
    if (mode === "off" || !completed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const value = await api<MemorySuggestionPage>(
        `profiles/${profileId}/memory-suggestions?mode=${mode}&q=${encodeURIComponent(query)}&offset=${offset}&limit=12`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        if (value.profile_id !== profileId || value.mode !== mode)
          throw new Error(
            "Ces suggestions ne sont pas disponibles pour ce profil.",
          );
        setPage(value);
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Suggestions indisponibles.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [profileId, mode, completed, query, offset]);
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load, revision]);
  useEffect(() => {
    if (lastSequence.current !== sequenceId) {
      setWords([]);
      setHidden([]);
      identity.current = null;
    }
    lastSequence.current = sequenceId;
  }, [sequenceId]);
  function changeMode(value: SuggestionMode) {
    setExpanded(false);
    setWords([]);
    setHidden([]);
    setQuery("");
    setOffset(0);
    identity.current = null;
    onModeChange(value);
  }
  function dismiss(key: string) {
    const origin = document.activeElement;
    setHidden((old) => [...old, key]);
    requestAnimationFrame(() => {
      if (
        origin &&
        !origin.isConnected &&
        document.activeElement === document.body
      )
        heading.current?.focus();
    });
  }
  async function propose(references: MemoryReference[]) {
    if (disabled || !completed || !references.length) return;
    const fingerprint = JSON.stringify({ sequenceId, references, role });
    if (identity.current?.fingerprint !== fingerprint)
      identity.current = { fingerprint, id: newIdentity() };
    if (
      await onPropose({
        request_id: identity.current.id,
        references,
        actor_role: role,
      })
    )
      setWords([]);
  }
  const pending = disabled || loading;
  const phrase = joinMemoryWords(words);
  const visibleWords =
    page?.words.filter(
      (word) => !hidden.includes("word:" + wordKey(word.text)),
    ) ?? [];
  const visiblePhrases =
    page?.phrases.filter(
      (item) => !hidden.includes("phrase:" + item.reference.interpretation_id),
    ) ?? [];
  const showAll = expanded || !!query.trim();
  const more = (mode === "words" ? visibleWords : visiblePhrases).length > 3;
  return (
    <section
      className="panel memory-suggestions"
      aria-label="Suggestions de ma mémoire"
      id="communication-suggestions"
    >
      <h2 ref={heading} tabIndex={-1}>
        Suggestions de ma mémoire
      </h2>
      <p className="helper">
        Uniquement les phrases acceptées de ce profil et leurs mots. Aucune
        nouvelle formulation par l’IA.
      </p>
      <div className="tabs" role="group" aria-label="Mode de suggestions">
        {(
          [
            ["off", "Désactivées"],
            ["words", "Mots"],
            ["phrases", "Phrases"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={mode === value ? "" : "secondary"}
            aria-pressed={mode === value}
            disabled={disabled}
            onClick={() => changeMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {temporary && (
        <p className="helper">
          Ce réglage reste temporaire dans ce navigateur.
        </p>
      )}
      {mode !== "off" && (
        <>
          {!completed ? (
            <p>
              Composez avec vos touches et terminez le message pour choisir une
              proposition dans votre mémoire.
            </p>
          ) : (
            <>
              <p>
                Choisissez une proposition, puis validez-la ou écartez-la dans «
                Vérifier ce que je veux dire ». Écarter une suggestion ici ne
                retire pas sa phrase d’origine.
              </p>
              <div className="memory-filters">
                <label>
                  Rechercher dans mes suggestions
                  <input
                    type="search"
                    maxLength={100}
                    value={query}
                    disabled={disabled}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={pending}
                  onClick={() => void load()}
                >
                  Actualiser les suggestions
                </button>
              </div>
              <details>
                <summary>Qui propose ce message ?</summary>
                <HumanRoleSelector
                  value={role}
                  onChange={setRole}
                  disabled={disabled}
                  label="Je propose en tant que"
                />
              </details>
              {mode === "words" && (
                <div
                  className="memory-word-draft"
                  role="region"
                  aria-label="Ma proposition avec mes mots"
                >
                  <h3>Ma proposition avec mes mots</h3>
                  <p className="memory-phrase" role="status">
                    {phrase || "Ajoutez les mots que vous souhaitez utiliser."}
                  </p>
                  <p>{words.length} / 32 mots</p>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={disabled || !words.length}
                      onClick={() => setWords((old) => old.slice(0, -1))}
                    >
                      Annuler le dernier mot
                    </button>
                    <button
                      className="secondary"
                      disabled={disabled || !words.length}
                      onClick={() => setWords([])}
                    >
                      Effacer ma proposition
                    </button>
                    <button
                      disabled={
                        pending ||
                        !page ||
                        !!error ||
                        !words.length ||
                        phrase.length > 4000
                      }
                      onClick={() =>
                        void propose(words.map((word) => word.reference))
                      }
                    >
                      Proposer cette phrase de mots
                    </button>
                  </div>
                </div>
              )}
              {loading && (
                <p role="status">Lecture de vos phrases acceptées…</p>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {page && (
                <>
                  {!page.total && (
                    <p>
                      {query
                        ? "Aucune suggestion ne correspond à cette recherche."
                        : "Aucune phrase acceptée pour le moment. Validez ou corrigez d’abord une phrase dans ce profil."}
                    </p>
                  )}
                  {!page.total && !query && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() => changeMode("off")}
                    >
                      Préparer une première formulation
                    </button>
                  )}
                  {mode === "words" && (
                    <div className="memory-word-cards">
                      {visibleWords
                        .slice(0, showAll ? undefined : 3)
                        .map((word) => (
                          <article
                            className="panel memory-suggestion-card"
                            key={wordKey(word.text)}
                          >
                            <div className="memory-word-visual">
                              <TouchContent
                                label={word.text}
                                representation={
                                  word.representation?.profile_id ===
                                    profileId &&
                                  word.representation.status === "validated"
                                    ? word.representation
                                    : undefined
                                }
                              />
                            </div>
                            {!word.representation && (
                              <p className="helper">Mot sans dessin associé</p>
                            )}
                            <details>
                              <summary>Phrase d’origine</summary>
                              <p>{word.source_text}</p>
                            </details>
                            <div className="actions">
                              <button
                                disabled={pending || words.length >= 32}
                                onClick={() =>
                                  setWords((old) => [...old, word])
                                }
                              >
                                Ajouter « {word.text} »
                              </button>
                              <button
                                className="secondary"
                                disabled={disabled}
                                onClick={() =>
                                  dismiss("word:" + wordKey(word.text))
                                }
                              >
                                Écarter « {word.text} »
                              </button>
                            </div>
                          </article>
                        ))}
                    </div>
                  )}
                  {mode === "phrases" && (
                    <div className="phrase-cards">
                      {visiblePhrases
                        .slice(0, showAll ? undefined : 3)
                        .map((item) => (
                          <article
                            className="panel memory-card"
                            key={item.reference.interpretation_id}
                          >
                            <p className="memory-phrase">{item.text}</p>
                            <span className="tag">
                              Phrase déjà acceptée dans ce profil
                            </span>
                            <div className="actions">
                              <button
                                disabled={pending}
                                onClick={() => void propose([item.reference])}
                              >
                                Proposer cette phrase
                              </button>
                              <button
                                className="secondary"
                                disabled={disabled}
                                onClick={() =>
                                  dismiss(
                                    "phrase:" +
                                      item.reference.interpretation_id,
                                  )
                                }
                              >
                                Écarter cette suggestion
                              </button>
                            </div>
                          </article>
                        ))}
                    </div>
                  )}
                  {more && !query.trim() && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setExpanded(!expanded);
                        if (expanded) heading.current?.focus();
                      }}
                    >
                      {expanded
                        ? "Réduire les suggestions"
                        : "Voir plus de suggestions"}
                    </button>
                  )}
                  {page.total > 12 && (
                    <nav className="actions" aria-label="Pages de suggestions">
                      <button
                        className="secondary"
                        disabled={pending || offset === 0}
                        onClick={() =>
                          setOffset((old) => Math.max(0, old - 12))
                        }
                      >
                        Suggestions précédentes
                      </button>
                      <span>
                        Page {Math.floor(offset / 12) + 1} /{" "}
                        {Math.ceil(page.total / 12)}
                      </span>
                      <button
                        className="secondary"
                        disabled={pending || offset + 12 >= page.total}
                        onClick={() => setOffset((old) => old + 12)}
                      >
                        Suggestions suivantes
                      </button>
                    </nav>
                  )}
                </>
              )}
              {hidden.length > 0 && (
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => setHidden([])}
                >
                  Réafficher les suggestions écartées
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
