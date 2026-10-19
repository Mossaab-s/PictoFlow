"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import { canProfile } from "@/lib/access";
import {
  blockRepresentation,
  type Block,
  type HumanRole,
  type Interpretation,
  type Representation,
  type Sequence,
} from "@/lib/keyboard";
import { memoryMatches, type MemoryMessage } from "@/lib/memory";
import { reviewGroups } from "@/lib/phrase-review";
import { useAuthentication } from "./authentication";
import { ProfileNavigation, HumanRoleSelector } from "./profile-navigation";
import MemoryEvidence, { memoryDate } from "./memory-evidence";
import { TouchContent } from "./pictogram";
import { useLocalSpeech } from "./use-local-speech";

type Bundle = {
  candidates: MemoryMessage[];
  sequences: Sequence[];
  blocks: Block[];
  visuals: Representation[];
};
type ReviewAction = "confirm" | "correct" | "reject";

export default function PhraseReview({ profileId }: { profileId: string }) {
  const session = useAuthentication();
  const canReview = canProfile(session, profileId, "review_meanings");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [role, setRole] = useState<HumanRole>("caregiver");
  const request = useRef<AbortController | null>(null);
  const gate = useRef(false);
  const alive = useRef(true);
  const status = useRef<HTMLParagraphElement>(null);
  const speech = useLocalSpeech(profileId);
  const base = `profiles/${profileId}`;
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const [candidates, sequences, blocks, visuals] = await Promise.all([
        api<MemoryMessage[]>(`${base}/interpretations`, {
          signal: controller.signal,
        }),
        api<Sequence[]>(`${base}/sequences`, { signal: controller.signal }),
        api<Block[]>(`${base}/blocks`, { signal: controller.signal }),
        api<Representation[]>(`${base}/representations`, {
          signal: controller.signal,
        }),
      ]);
      if (controller.signal.aborted || !alive.current) return false;
      setBundle({
        candidates: candidates.filter((item) => item.profile_id === profileId),
        sequences: sequences.filter((item) => item.profile_id === profileId),
        blocks: blocks.filter((item) => item.profile_id === profileId),
        visuals: visuals.filter((item) => item.profile_id === profileId),
      });
      setBlocked(false);
      return true;
    } catch {
      if (!controller.signal.aborted && alive.current) {
        setBlocked(true);
        setError(
          "La liste ne peut pas être vérifiée. Actualisez les phrases avant de prendre une décision.",
        );
      }
      return false;
    } finally {
      if (!controller.signal.aborted && alive.current) setLoading(false);
    }
  }, [base, profileId]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, [load]);
  async function decide(
    candidate: MemoryMessage,
    action: ReviewAction,
    correction?: string,
  ) {
    if (
      gate.current ||
      loading ||
      blocked ||
      !canReview ||
      candidate.status !== "proposed"
    )
      return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    speech.stop();
    try {
      const result = await api<Interpretation>(
        `${base}/interpretations/${candidate.id}/feedback`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            actor_role: role,
            expected_status: "proposed",
            ...(action === "correct"
              ? { corrected_value: correction?.trim() }
              : {}),
          }),
        },
      );
      if (result.profile_id !== profileId || result.id !== candidate.id)
        throw new Error("Phrase indisponible.");
      const fresh = await load();
      if (alive.current)
        setNotice(
          fresh
            ? action === "reject"
              ? "Phrase refusée. Elle n’entre pas dans les phrases acceptées."
              : action === "correct"
                ? "Votre correction est enregistrée dans la mémoire du profil."
                : "Phrase confirmée dans la mémoire du profil."
            : "La décision a été enregistrée. Actualisez pour relire la liste.",
        );
    } catch (cause) {
      // Reconcile an uncertain response, but never resend a human decision automatically.
      const fresh = await load();
      if (fresh && alive.current)
        setError(
          cause instanceof APIError && cause.status === 409
            ? "Ce message a déjà été traité ou une autre phrase a été retenue. Relisez la liste actualisée avant de décider."
            : "La réponse n’a pas pu être confirmée. Relisez l’état actualisé avant une nouvelle action ; aucune décision n’a été renvoyée automatiquement.",
        );
    } finally {
      gate.current = false;
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (alive.current && document.activeElement === document.body)
            status.current?.focus();
        });
      }
    }
  }
  const all = bundle
    ? reviewGroups(profileId, bundle.sequences, bundle.candidates, pending)
    : [];
  const filtered = all.filter((group) =>
    memoryMatches(
      group.candidates
        .map((item) => item.corrected_text ?? item.text)
        .join(" "),
      query,
    ),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 10) - 1);
  const currentPage = Math.min(page, lastPage);
  const disabled = busy || loading || blocked;
  return (
    <>
      <ProfileNavigation profileId={profileId} section="review" />
      <section
        className="page phrase-review-page"
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && speech.speaking) {
            event.preventDefault();
            speech.stop();
          }
        }}
      >
        <div className="eyebrow">ACCOMPAGNER LE CHOIX DE LA PERSONNE</div>
        <h1>Phrases à vérifier</h1>
        <p>
          Reprenez les touches avec la personne et choisissez la phrase qui
          exprime ce qu’elle souhaite dire. Lire ou consulter une proposition ne
          la valide pas.
        </p>
        <div className="actions">
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              setNotice("");
              void load();
            }}
          >
            Actualiser les phrases
          </button>
          <Link href={`/accompagnement/personnes/${profileId}/phrases`}>
            Consulter la mémoire du profil
          </Link>
          {speech.speaking && (
            <button className="secondary" onClick={speech.stop}>
              Arrêter la lecture
            </button>
          )}
        </div>
        {speech.error && <p role="alert">{speech.error}</p>}
        <div className="tabs" role="group" aria-label="Phrases à afficher">
          <button
            aria-pressed={pending}
            disabled={busy}
            onClick={() => {
              setPending(true);
              setPage(0);
            }}
          >
            À vérifier
          </button>
          <button
            aria-pressed={!pending}
            disabled={busy}
            onClick={() => {
              setPending(false);
              setPage(0);
            }}
          >
            Décisions enregistrées
          </button>
        </div>
        <label className="review-search">
          Rechercher une phrase
          <input
            type="search"
            value={query}
            maxLength={100}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        {pending && canReview && (
          <HumanRoleSelector
            value={role}
            onChange={setRole}
            disabled={disabled}
            label="Je prends la décision en tant que"
          />
        )}
        <p
          ref={status}
          tabIndex={-1}
          role={error ? "alert" : "status"}
          className={error ? "error" : notice ? "notice" : "helper"}
        >
          {error ||
            notice ||
            (loading
              ? "Chargement des phrases…"
              : `${all.length} message(s) ${pending ? "à vérifier" : "avec une décision enregistrée"}.`)}
        </p>
        {bundle && (
          <div aria-busy={loading || busy} className="review-message-list">
            {filtered
              .slice(currentPage * 10, currentPage * 10 + 10)
              .map((group, index) => (
                <section
                  key={group.sequence.id}
                  className="panel review-message"
                  aria-label={`Message ${currentPage * 10 + index + 1}`}
                >
                  <h2>Touches à l’origine du message</h2>
                  <p className="helper">
                    Dessins et mots actuels, dans l’ordre choisi. Les
                    répétitions sont conservées.
                  </p>
                  <ol className="memory-touches">
                    {group.sequence.block_ids.map((id, position) => {
                      const block = bundle.blocks.find(
                        (item) => item.id === id,
                      );
                      return (
                        <li key={position}>
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
                      );
                    })}
                  </ol>
                  {pending && group.candidates.length > 1 && (
                    <p>
                      Plusieurs hypothèses pour ce message. Une seule phrase
                      peut être retenue ; les autres ne sont pas validées
                      automatiquement.
                    </p>
                  )}
                  {group.candidates.map((candidate) => (
                    <ReviewCard
                      key={candidate.id}
                      candidate={candidate}
                      canReview={canReview && pending}
                      disabled={disabled}
                      decide={(action, correction) =>
                        decide(candidate, action, correction)
                      }
                      read={speech.available ? speech.read : undefined}
                    />
                  ))}
                </section>
              ))}
            {!filtered.length && !loading && !blocked && (
              <div className="empty">
                <h2>
                  {query
                    ? "Aucune phrase ne correspond"
                    : pending
                      ? "Aucune phrase en attente"
                      : "Aucune décision pour le moment"}
                </h2>
                <p>
                  {query
                    ? "Essayez un autre mot ou effacez votre recherche."
                    : pending
                      ? "Les prochaines propositions de ce profil apparaîtront ici après leur création dans la communication."
                      : "Les confirmations, corrections et refus apparaîtront ici après une décision explicite."}
                </p>
              </div>
            )}
          </div>
        )}
        {filtered.length > 10 && (
          <nav className="actions" aria-label="Pages des messages à vérifier">
            <button
              className="secondary"
              disabled={disabled || currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Précédent
            </button>
            <span>
              Page {currentPage + 1} sur {lastPage + 1}
            </span>
            <button
              className="secondary"
              disabled={disabled || currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              Suivant
            </button>
          </nav>
        )}
      </section>
    </>
  );
}

function ReviewCard({
  candidate,
  canReview,
  disabled,
  decide,
  read,
}: {
  candidate: MemoryMessage;
  canReview: boolean;
  disabled: boolean;
  decide: (action: ReviewAction, correction?: string) => Promise<void>;
  read?: (text: string) => void;
}) {
  const [correction, setCorrection] = useState(candidate.text);
  const text = candidate.corrected_text ?? candidate.text;
  return (
    <article className="panel review-phrase" aria-label={text}>
      <span className="tag">
        {candidate.status === "proposed"
          ? "Proposition à vérifier"
          : candidate.status === "rejected"
            ? "Phrase refusée"
            : candidate.status === "corrected"
              ? "Correction acceptée"
              : "Phrase confirmée"}
      </span>
      <p className="memory-phrase">{text}</p>
      <time dateTime={candidate.created_at}>
        Proposition du {memoryDate(candidate.created_at)}
      </time>
      <p className="helper">
        {candidate.source === "pcl-memory"
          ? "Issue des phrases acceptées de ce profil."
          : candidate.source === "pcl"
            ? "Mots présentés tels quels."
            : "Formulation proposée, à vérifier avec la personne."}
      </p>
      {read && (
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => read(text)}
        >
          Lire cette phrase
        </button>
      )}
      {canReview && candidate.status === "proposed" && (
        <>
          <div className="actions">
            <button disabled={disabled} onClick={() => void decide("confirm")}>
              Confirmer cette phrase
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void decide("reject")}
            >
              Refuser cette phrase
            </button>
          </div>
          <details className="correction-editor">
            <summary>Corriger cette phrase</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (correction.trim()) void decide("correct", correction);
              }}
            >
              <label htmlFor={`review-correction-${candidate.id}`}>
                Phrase corrigée
              </label>
              <textarea
                id={`review-correction-${candidate.id}`}
                required
                rows={3}
                maxLength={4000}
                disabled={disabled}
                value={correction}
                onChange={(event) => setCorrection(event.target.value)}
              />
              <button disabled={disabled || !correction.trim()}>
                Enregistrer la correction
              </button>
            </form>
          </details>
        </>
      )}
      <MemoryEvidence
        key={candidate.id + candidate.status + candidate.corrected_text}
        profileId={candidate.profile_id}
        type="interpretation"
        targetId={candidate.id}
      />
    </article>
  );
}
