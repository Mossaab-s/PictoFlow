"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import { canProfile, profileToolPath } from "@/lib/access";
import {
  blockRepresentation,
  type Block,
  type Representation,
  type HumanRole,
} from "@/lib/keyboard";
import {
  visibleNeeds,
  needExamples,
  type VocabularyNeed,
  type NeedEvidence,
} from "@/lib/vocabulary-needs";
import { useAuthentication } from "./authentication";
import { ProfileNavigation, HumanRoleSelector } from "./profile-navigation";
import { memoryDate } from "./memory-evidence";
import { TouchContent } from "./pictogram";

type Bundle = {
  needs: VocabularyNeed[];
  blocks: Block[];
  visuals: Representation[];
  revision: number;
};
const statusLabels = {
  proposed: "Besoin à examiner",
  approved: "Besoin accepté",
  rejected: "Besoin refusé",
  resolved: "Besoin pris en compte",
};

export default function VocabularyNeeds({ profileId }: { profileId: string }) {
  const session = useAuthentication();
  const canDecide = canProfile(session, profileId, "manage_meanings");
  const canPrepare = canProfile(session, profileId, "prepare_keyboard");
  const canDetect = canDecide || canPrepare;
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [role, setRole] = useState<HumanRole>("caregiver");
  const gate = useRef(false);
  const alive = useRef(true);
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const base = `profiles/${profileId}`;
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const [needs, blocks, visuals] = await Promise.all([
        api<VocabularyNeed[]>(`${base}/suggestions`, {
          signal: controller.signal,
        }),
        api<Block[]>(`${base}/blocks`, { signal: controller.signal }),
        api<Representation[]>(`${base}/representations`, {
          signal: controller.signal,
        }),
      ]);
      if (!controller.signal.aborted && alive.current) {
        setBundle({
          needs: needs.filter((item) => item.profile_id === profileId),
          blocks: blocks.filter((item) => item.profile_id === profileId),
          visuals: visuals.filter((item) => item.profile_id === profileId),
          revision: ++revision.current,
        });
        setBlocked(false);
        return true;
      }
    } catch {
      if (!controller.signal.aborted && alive.current) {
        setBlocked(true);
        setError(
          "Les besoins de vocabulaire ne peuvent pas être vérifiés. Actualisez avant de décider.",
        );
      }
    } finally {
      if (!controller.signal.aborted && alive.current) setLoading(false);
    }
    return false;
  }, [base, profileId]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, [load]);
  async function perform(task: () => Promise<unknown>, success: string) {
    if (gate.current || loading || blocked) return;
    gate.current = true;
    const origin = document.activeElement;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      const fresh = await load();
      if (alive.current)
        setNotice(
          fresh
            ? success
            : "L’action a été enregistrée. Actualisez pour vérifier le suivi.",
        );
    } catch (cause) {
      const fresh = await load();
      if (fresh && alive.current)
        setError(
          cause instanceof APIError && cause.status === 409
            ? "Ce besoin a déjà été traité. Consultez le suivi actualisé avant une nouvelle décision."
            : "L’action n’a pas pu être confirmée. Consultez l’état actualisé ; aucune action n’a été renvoyée automatiquement.",
        );
    } finally {
      gate.current = false;
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (
            origin &&
            !origin.isConnected &&
            document.activeElement === document.body
          )
            status.current?.focus();
        });
      }
    }
  }
  const filtered = visibleNeeds(profileId, bundle?.needs ?? [], pending, query);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 10) - 1),
  );
  const disabled = busy || loading || blocked;
  return (
    <>
      <ProfileNavigation profileId={profileId} section="suggestions" />
      <section className="page vocabulary-needs-page">
        <div className="eyebrow">ACCOMPAGNER LE VOCABULAIRE</div>
        <h1>Besoins de vocabulaire</h1>
        <p>
          Le PCL repère les mêmes suites de touches associées à une phrase déjà
          acceptée plusieurs fois. Vous choisissez si cette expression mérite
          une touche dédiée.
        </p>
        <div className="actions">
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              void load();
            }}
          >
            Actualiser les besoins
          </button>
          {canDetect && (
            <button
              disabled={disabled}
              onClick={() =>
                void perform(
                  () => api(`${base}/suggestions/detect`, { method: "POST" }),
                  "Recherche terminée. Les besoins repérés sont affichés sans décision automatique.",
                )
              }
            >
              Rechercher les expressions répétées
            </button>
          )}
        </div>
        <div className="actions" role="group" aria-label="Afficher les besoins">
          <button
            aria-pressed={pending}
            disabled={busy}
            onClick={() => {
              setPending(true);
              setPage(0);
            }}
          >
            À examiner
          </button>
          <button
            aria-pressed={!pending}
            disabled={busy}
            onClick={() => {
              setPending(false);
              setPage(0);
            }}
          >
            Suivi des décisions
          </button>
        </div>
        <label className="review-search">
          Rechercher une expression
          <input
            type="search"
            value={query}
            maxLength={256}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        {canDecide && (
          <HumanRoleSelector
            label="Je prends la décision en tant que"
            value={role}
            onChange={setRole}
            disabled={disabled}
          />
        )}
        {!canDecide && (
          <p>
            Vous pouvez consulter les besoins et leurs exemples. Leur
            acceptation ou leur refus demande une autorisation de gestion des
            sens.
          </p>
        )}
        {notice && (
          <p className="notice" role="status" tabIndex={-1} ref={status}>
            {notice}
          </p>
        )}
        {error && (
          <p className="error" role="alert" tabIndex={-1} ref={status}>
            {error}
          </p>
        )}
        {loading && <p role="status">Chargement des besoins…</p>}
        {!blocked && bundle && (
          <>
            <div className="need-list" aria-busy={disabled}>
              {filtered
                .slice(currentPage * 10, currentPage * 10 + 10)
                .map((need) => (
                  <NeedCard
                    key={`${need.id}:${bundle.revision}`}
                    profileId={profileId}
                    need={need}
                    bundle={bundle}
                    disabled={disabled}
                    canDecide={canDecide}
                    canPrepare={canPrepare}
                    decide={(approve) =>
                      void perform(
                        () =>
                          api(`${base}/suggestions/${need.id}/decision`, {
                            method: "POST",
                            body: JSON.stringify({
                              approve,
                              actor_role: role,
                              expected_status: "proposed",
                            }),
                          }),
                        approve
                          ? "Besoin accepté. Retrouvez-le dans le suivi pour préparer une touche."
                          : "Besoin refusé. La décision reste dans le suivi.",
                      )
                    }
                  />
                ))}
            </div>
            {!filtered.length && !loading && (
              <div className="empty">
                <h2>
                  {query
                    ? "Aucune expression ne correspond"
                    : pending
                      ? "Aucun besoin à examiner"
                      : "Aucune décision pour le moment"}
                </h2>
                <p>
                  {pending
                    ? "Les expressions répétées et déjà acceptées pourront apparaître ici après une recherche explicite."
                    : "Les besoins acceptés, refusés ou pris en compte apparaîtront ici après leur examen."}
                </p>
              </div>
            )}
            {filtered.length > 10 && (
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={disabled || currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Précédent
                </button>
                <span>
                  Page {currentPage + 1} sur {Math.ceil(filtered.length / 10)}
                </span>
                <button
                  className="secondary"
                  disabled={
                    disabled || (currentPage + 1) * 10 >= filtered.length
                  }
                  onClick={() => setPage(currentPage + 1)}
                >
                  Suivant
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function NeedCard({
  profileId,
  need,
  bundle,
  disabled,
  canDecide,
  canPrepare,
  decide,
}: {
  profileId: string;
  need: VocabularyNeed;
  bundle: Bundle;
  disabled: boolean;
  canDecide: boolean;
  canPrepare: boolean;
  decide: (approve: boolean) => void;
}) {
  const session = useAuthentication();
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState<NeedEvidence | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const gate = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function loadEvidence() {
    if (gate.current || disabled) return;
    gate.current = true;
    setLoading(true);
    setError("");
    setEvidence(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await api<NeedEvidence>(
        `profiles/${profileId}/suggestions/${need.id}/evidence`,
        { signal: controller.signal },
      );
      needExamples(profileId, need, value);
      if (!controller.signal.aborted) setEvidence(value);
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Les exemples actuels ne peuvent pas être vérifiés. Rechargez-les avant de décider.",
        );
    } finally {
      gate.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const examples = evidence ? needExamples(profileId, need, evidence) : [];
  const sequence = examples[0]?.sequence;
  return (
    <article
      className="panel vocabulary-need"
      aria-label={need.validated_intent}
    >
      <span className="tag">{statusLabels[need.status]}</span>
      <h2>{need.validated_intent}</h2>
      <p className="helper">
        Repéré le {memoryDate(need.created_at)} · {need.occurrence_count}{" "}
        répétitions et {need.validated_count} phrases acceptées lors du
        repérage.
      </p>
      <details
        onToggle={(event) => {
          const next = event.currentTarget.open;
          setOpen(next);
          if (next && !evidence && !gate.current) void loadEvidence();
        }}
      >
        <summary>Comprendre ce besoin et voir les exemples</summary>
        {open && (
          <>
            <button
              className="secondary"
              disabled={disabled || loading}
              onClick={() => void loadEvidence()}
            >
              Recharger les exemples
            </button>
            {loading && <p role="status">Vérification des exemples…</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {evidence && (
              <>
                <p>
                  Actuellement : {evidence.occurrence_count} répétitions de ces
                  touches, dont {evidence.validated_count} avec cette phrase
                  acceptée.
                </p>
                <p>
                  Le repérage demande au moins {evidence.minimum_occurrences}{" "}
                  répétitions et {evidence.minimum_validated} phrases acceptées.
                </p>
                {sequence && (
                  <ol className="memory-touches" aria-label="Touches répétées">
                    {sequence.block_ids.map((id, index) => {
                      const block = bundle.blocks.find(
                        (item) => item.id === id,
                      );
                      return (
                        <li key={index}>
                          <TouchContent
                            label={block?.label ?? "Touche indisponible"}
                            representation={
                              block
                                ? blockRepresentation(
                                    profileId,
                                    block,
                                    bundle.visuals,
                                  )
                                : undefined
                            }
                          />
                        </li>
                      );
                    })}
                  </ol>
                )}
                <h3>Exemples déjà acceptés</h3>
                <p className="helper">
                  Jusqu’à cinq messages, avec leurs mots dans l’ordre choisi.
                </p>
                <ul className="need-examples">
                  {examples.map((example) => (
                    <li key={example.sequence.id}>
                      <p>{need.validated_intent}</p>
                      <time dateTime={example.interpretation.created_at}>
                        Proposition du{" "}
                        {memoryDate(example.interpretation.created_at)}
                      </time>
                    </li>
                  ))}
                </ul>
                {!examples.length && (
                  <p>
                    Aucun exemple accepté correspondant n’est disponible
                    actuellement.
                  </p>
                )}
                {evidence.existing_block_match ? (
                  <p>Une touche active représente déjà cette expression.</p>
                ) : (
                  !evidence.eligible && (
                    <p>
                      Les phrases actuellement acceptées ne suffisent plus à
                      proposer ce besoin.
                    </p>
                  )
                )}
                {need.status === "proposed" && canDecide && (
                  <div className="actions">
                    <button
                      disabled={
                        disabled ||
                        loading ||
                        !evidence.eligible ||
                        evidence.existing_block_match
                      }
                      onClick={() => decide(true)}
                    >
                      Accepter ce besoin
                    </button>
                    <button
                      className="secondary"
                      disabled={
                        disabled || loading || evidence.existing_block_match
                      }
                      onClick={() => decide(false)}
                    >
                      Refuser ce besoin
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </details>
      {need.status === "approved" && (
        <>
          <p>
            L’acceptation conserve ce besoin dans le suivi. La préparation du
            dessin et du mot, puis la validation de la touche, se font dans
            l’éditeur de clavier.
          </p>
          {canPrepare && (
            <Link
              className="button-link"
              href={profileToolPath(session, profileId, "keyboard")}
            >
              Ouvrir la préparation du clavier
            </Link>
          )}
        </>
      )}
      {need.status === "resolved" && (
        <p>Ce besoin a déjà été pris en compte par une touche validée.</p>
      )}
    </article>
  );
}
