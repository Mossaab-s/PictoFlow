"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  blockRepresentation,
  type Block,
  type HumanRole,
  type Interpretation,
  type Representation,
} from "@/lib/keyboard";
import {
  messageText,
  messageTouches,
  scopedMemory,
  type Memory,
} from "@/lib/memory";
import { acceptedPhrase, phraseList, type ReusablePhrase } from "@/lib/phrases";
import { HumanRoleSelector } from "./profile-navigation";
import PhraseShortcut, { phraseError } from "./phrase-shortcut";
import { TouchContent } from "./pictogram";

type Speech = {
  available: boolean;
  read: (text: string) => void;
  stop: () => void;
};

export default function PhraseLibrary({
  profileId,
  blocks,
  visuals,
  speech,
  disabled,
  initialPhraseId = null,
  choiceRevision = 0,
  revision,
}: {
  profileId: string;
  blocks: Block[];
  visuals: Representation[];
  speech: Speech;
  disabled: boolean;
  initialPhraseId?: string | null;
  choiceRevision?: number;
  revision: unknown;
}) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [shortcuts, setShortcuts] = useState(true);
  const [page, setPage] = useState(0);
  const [role, setRole] = useState<HumanRole>("user");
  const [chosen, setChosen] = useState<ReusablePhrase | null>(null);
  const controller = useRef<AbortController | null>(null);
  const chosenRequest = useRef<AbortController | null>(null);
  const gate = useRef(false);
  const phraseHeading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (chosen) phraseHeading.current?.focus();
  }, [chosen?.interpretation.id]);
  const base = `profiles/${profileId}`;
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError("");
    setMemory(null);
    try {
      const value = await api<Memory>(`${base}/memory?validated=true`, {
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        setMemory(scopedMemory(profileId, value, true));
        setPage(0);
      }
    } catch (error) {
      if (!request.signal.aborted) setError(phraseError(error));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [base, profileId]);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load, revision]);
  // Links carry an identity only; the accepted text always comes from a fresh scoped read.
  useEffect(() => {
    const request = new AbortController();
    chosenRequest.current = request;
    setChosen(null);
    setNotice("");
    if (initialPhraseId) {
      setBusy(true);
      void api<ReusablePhrase>(`${base}/phrases/${initialPhraseId}`, {
        signal: request.signal,
      })
        .then((value) => {
          if (!request.signal.aborted) {
            const accepted = acceptedPhrase(profileId, value);
            if (!accepted) throw new Error("Phrase indisponible.");
            setChosen(accepted);
          }
        })
        .catch((error) => {
          if (!request.signal.aborted) setError(phraseError(error));
        })
        .finally(() => {
          if (!request.signal.aborted) setBusy(false);
        });
    } else setBusy(false);
    return () => {
      request.abort();
      chosenRequest.current?.abort();
    };
  }, [base, profileId, initialPhraseId, choiceRevision]);
  function changed(item: Interpretation) {
    setMemory((previous) =>
      previous
        ? {
            ...previous,
            interpretations: previous.interpretations.map((v) =>
              v.id === item.id ? { ...v, ...item } : v,
            ),
          }
        : null,
    );
    setChosen((previous) =>
      previous?.interpretation.id === item.id
        ? {
            ...previous,
            interpretation: { ...previous.interpretation, ...item },
          }
        : previous,
    );
  }
  async function choose(id: string, read = false) {
    if (gate.current || busy || disabled) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    speech.stop();
    chosenRequest.current?.abort();
    const request = new AbortController();
    chosenRequest.current = request;
    try {
      const value = acceptedPhrase(
        profileId,
        await api<ReusablePhrase>(`${base}/phrases/${id}`, {
          signal: request.signal,
        }),
      );
      if (request.signal.aborted) return;
      if (!value) throw new Error("Phrase indisponible.");
      const text = messageText(value.interpretation, true)!;
      setChosen(value);
      if (
        read &&
        chosen?.interpretation.id === id &&
        messageText(chosen.interpretation, true) === text
      )
        speech.read(text);
      else if (read)
        setNotice(
          "Cette phrase a été corrigée. Vérifiez le nouveau texte avant de le lire.",
        );
    } catch (error) {
      if (!request.signal.aborted) {
        setChosen(null);
        setError(phraseError(error));
      }
    } finally {
      gate.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  const matches = phraseList(
    profileId,
    memory?.interpretations ?? [],
    memory?.sequences ?? [],
    query,
    shortcuts,
  );
  const last = Math.max(0, Math.ceil(matches.length / 6) - 1);
  const currentPage = Math.min(page, last);
  const pending = disabled || busy;
  const touches = chosen
    ? messageTouches(
        profileId,
        chosen.interpretation,
        [chosen.sequence],
        blocks,
      )
    : null;
  return (
    <section className="phrase-library" aria-label="Phrases habituelles">
      {chosen && (
        <section
          className="message-panel phrase-chosen"
          aria-label="Phrase choisie"
        >
          <h2 ref={phraseHeading} tabIndex={-1}>
            Ma phrase choisie
          </h2>
          <p className="memory-phrase">
            {messageText(chosen.interpretation, true)}
          </p>
          <p className="helper">
            Message déjà accepté. Votre composition en cours est conservée
            ci-dessous.
          </p>
          {touches && (
            <ol className="memory-touches">
              {touches.map((block, index) => (
                <li key={index}>
                  {block ? (
                    <TouchContent
                      label={block.label}
                      representation={blockRepresentation(
                        profileId,
                        block,
                        visuals,
                      )}
                    />
                  ) : (
                    <span>Touche indisponible</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="helper">
            Touches d’origine avec leur affichage actuel ; la phrase retenue
            respecte la correction humaine.
          </p>
          <div className="actions">
            <button
              disabled={pending || !speech.available}
              onClick={() => void choose(chosen.interpretation.id, true)}
            >
              Lire cette phrase
            </button>
            <button
              className="secondary"
              disabled={pending}
              onClick={() => {
                speech.stop();
                setChosen(null);
                setNotice("");
              }}
            >
              Masquer cette phrase
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {busy && <p role="status">Chargement de la phrase…</p>}
      <details
        className="panel phrase-picker"
        open={initialPhraseId ? true : undefined}
      >
        <summary>Mes phrases habituelles et raccourcis</summary>
        <p>
          Retrouvez une phrase acceptée, puis choisissez de l’afficher ou de la
          lire.
        </p>
        <div
          className="tabs"
          role="group"
          aria-label="Choisir les phrases affichées"
        >
          <button
            aria-pressed={shortcuts}
            className={shortcuts ? "" : "secondary"}
            disabled={pending}
            onClick={() => {
              setShortcuts(true);
              setPage(0);
            }}
          >
            Mes raccourcis
          </button>
          <button
            aria-pressed={!shortcuts}
            className={shortcuts ? "secondary" : ""}
            disabled={pending}
            onClick={() => {
              setShortcuts(false);
              setPage(0);
            }}
          >
            Toutes mes phrases acceptées
          </button>
        </div>
        <div className="memory-filters">
          <label>
            Rechercher une phrase
            <input
              type="search"
              value={query}
              disabled={pending}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={pending || loading}
            onClick={() => {
              speech.stop();
              setChosen(null);
              setNotice("");
              void load();
            }}
          >
            Actualiser les phrases
          </button>
        </div>
        <HumanRoleSelector
          value={role}
          onChange={setRole}
          disabled={pending}
          label="Je choisis mes raccourcis en tant que"
        />
        {loading ? (
          <p role="status">Chargement des phrases…</p>
        ) : (
          <>
            <p>
              {matches.length} phrases{shortcuts ? " choisies" : " acceptées"}
            </p>
            <div className="phrase-cards">
              {matches
                .slice(currentPage * 6, (currentPage + 1) * 6)
                .map((item) => (
                  <article className="panel memory-card" key={item.id}>
                    <h3>{messageText(item, true)}</h3>
                    <span className="tag">
                      {item.status === "corrected" ? "Corrigé" : "Confirmé"}
                      {item.shortcut ? " · Raccourci choisi" : ""}
                    </span>
                    <div className="actions">
                      <button
                        disabled={pending}
                        onClick={() => void choose(item.id)}
                      >
                        Utiliser cette phrase
                      </button>
                      <PhraseShortcut
                        profileId={profileId}
                        item={item}
                        role={role}
                        disabled={pending}
                        onChange={changed}
                      />
                    </div>
                  </article>
                ))}
            </div>
            {!matches.length && (
              <p>
                {query
                  ? "Aucune phrase ne correspond à cette recherche."
                  : shortcuts
                    ? "Aucun raccourci choisi. Ouvrez toutes vos phrases acceptées pour en ajouter."
                    : "Aucune phrase acceptée pour le moment. Confirmez ou corrigez un message pour le retrouver ici."}
              </p>
            )}
            {last > 0 && (
              <nav
                className="memory-pagination"
                aria-label="Pagination des phrases"
              >
                <button
                  className="secondary"
                  disabled={pending || currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Précédent
                </button>
                <span role="status">
                  Page {currentPage + 1} sur {last + 1}
                </span>
                <button
                  className="secondary"
                  disabled={pending || currentPage === last}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Suivant
                </button>
              </nav>
            )}
          </>
        )}
      </details>
    </section>
  );
}
