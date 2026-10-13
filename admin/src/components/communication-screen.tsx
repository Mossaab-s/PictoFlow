"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import {
  draftReference,
  joinKeyboard,
  blockRepresentation,
  newIdentity,
  parseDraft,
  type Decision,
  type HumanRole,
  type Interpretation,
  type Sequence,
  type Tile,
} from "@/lib/keyboard";
import KeyboardGrid from "./keyboard-grid";
import { HumanRoleSelector, ProfileNavigation } from "./profile-navigation";
import { useProfileKeyboard } from "./use-profile-keyboard";
import { TouchContent } from "./pictogram";
import ProfileIdentity from "./profile-identity";
import { useLocalSpeech } from "./use-local-speech";
import DisplaySettings from "./display-settings";
import { useDisplaySettings } from "./use-display-settings";

export default function CommunicationScreen({
  profileId,
  standalone = false,
}: {
  profileId: string;
  standalone?: boolean;
}) {
  const data = useProfileKeyboard(profileId);
  const display = useDisplaySettings(profileId);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [context, setContext] = useState("");
  const [role, setRole] = useState<HumanRole>("user");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const current = useRef<Sequence | null>(null);
  const gate = useRef(false);
  const alive = useRef(true);
  const speech = useLocalSpeech();
  const base = `profiles/${profileId}`;
  const storageKey = `pictoflow:sequence:${profileId}`;
  function remember(value: Sequence | null, result: Decision | null) {
    current.current = value;
    setSequence(value);
    setDecision(result);
    try {
      if (value)
        sessionStorage.setItem(
          storageKey,
          JSON.stringify(draftReference(value, result)),
        );
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage is optional; PostgreSQL still owns the sequence. */
    }
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    async function restore() {
      try {
        let cached = null;
        try {
          cached = parseDraft(sessionStorage.getItem(storageKey));
        } catch {
          /* Restricted browser storage. */
        }
        if (!cached) return;
        const restored = await api<Sequence>(
          `${base}/sequences/${cached.sequence_id}`,
          { signal: controller.signal },
        );
        if (restored.status === "cancelled") {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* Optional storage. */
          }
          return;
        }
        if (restored.profile_id !== profileId)
          throw new Error("Le message enregistré n’est plus disponible.");
        const candidates = cached.decision
          ? await Promise.all(
              cached.decision.candidate_ids.map((id) =>
                api<Interpretation>(`${base}/interpretations/${id}`, {
                  signal: controller.signal,
                }),
              ),
            )
          : [];
        if (
          candidates.some(
            (item) =>
              item.profile_id !== profileId || item.sequence_id !== restored.id,
          )
        )
          throw new Error("Le message enregistré n’est plus disponible.");
        if (!controller.signal.aborted) {
          current.current = restored;
          setSequence(restored);
          setDecision(
            cached.decision
              ? { state: cached.decision.state, candidates }
              : null,
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          if (error instanceof APIError && error.status === 404) {
            try {
              sessionStorage.removeItem(storageKey);
            } catch {
              /* Optional storage. */
            }
          } else {
            setRestoreFailed(true);
            data.setError(
              "Le message en cours ne peut pas être rechargé. Réessayez en actualisant la page.",
            );
          }
        }
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    }
    void restore();
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [base, profileId, storageKey, data.setError]);

  async function perform(task: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    data.setError("");
    setNotice("");
    try {
      await task();
    } catch (error) {
      if (alive.current) {
        data.setError(
          error instanceof Error ? error.message : "Action impossible.",
        );
        // Recover the server's sequence after an ambiguous network failure, without replaying writes.
        if (current.current) {
          try {
            const restored = await api<Sequence>(
              `${base}/sequences/${current.current.id}`,
            );
            if (alive.current) {
              if (restored.status === "cancelled") remember(null, null);
              else {
                const candidates = decision
                  ? await Promise.all(
                      decision.candidates.map((candidate) =>
                        api<Interpretation>(
                          `${base}/interpretations/${candidate.id}`,
                        ),
                      ),
                    )
                  : [];
                if (alive.current)
                  remember(
                    restored,
                    decision ? { ...decision, candidates } : null,
                  );
              }
            }
          } catch {
            /* Keep the error visible; never guess the committed state. */
          }
        }
      }
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function select(tile: Tile) {
    let active = current.current;
    if (!active) {
      active = await api<Sequence>(`${base}/sequences`, {
        method: "POST",
        body: JSON.stringify({ session_id: newIdentity() }),
      });
      if (!alive.current) return;
      remember(active, null);
    }
    if (active.status !== "in_progress") return;
    const result = await api<Sequence>(
      `${base}/sequences/${active.id}/selection`,
      {
        method: "POST",
        body: JSON.stringify({ action: "append", block_id: tile.block_id }),
      },
    );
    if (alive.current) remember(result, null);
  }
  async function selection(action: "undo" | "clear" | "complete") {
    if (!current.current) return;
    const result = await api<Sequence>(
      `${base}/sequences/${current.current.id}/selection`,
      { method: "POST", body: JSON.stringify({ action }) },
    );
    if (alive.current) {
      remember(result, null);
      if (action === "complete")
        setNotice(
          "Votre message est terminé. Vous pouvez le lire ou demander une proposition de phrase.",
        );
    }
  }
  async function propose() {
    if (!current.current || current.current.status !== "completed") return;
    const result = await api<Decision>(
      `${base}/sequences/${current.current.id}/interpret`,
      {
        method: "POST",
        body: JSON.stringify({
          declared_context: context.trim() ? [context.trim()] : [],
        }),
      },
    );
    if (alive.current) remember(current.current, result);
  }
  async function feedback(
    candidate: Interpretation,
    action: "confirm" | "correct" | "reject",
    corrected?: string,
  ) {
    const result = await api<Interpretation>(
      `${base}/interpretations/${candidate.id}/feedback`,
      {
        method: "POST",
        body: JSON.stringify({
          action,
          actor_role: role,
          ...(action === "correct"
            ? { corrected_value: corrected?.trim() }
            : {}),
        }),
      },
    );
    if (alive.current && decision) {
      remember(current.current, {
        ...decision,
        candidates: decision.candidates.map((item) =>
          item.id === result.id ? result : item,
        ),
      });
      setNotice(
        action === "reject"
          ? "Cette proposition a été écartée."
          : "Votre sens a été enregistré dans la mémoire validée de ce profil.",
      );
    }
  }
  async function newMessage() {
    if (current.current?.status === "in_progress")
      await api(`${base}/sequences/${current.current.id}/selection`, {
        method: "POST",
        body: JSON.stringify({ action: "cancel" }),
      });
    if (alive.current) {
      speech.stop();
      remember(null, null);
      setContext("");
      setNotice("Vous pouvez composer un nouveau message.");
    }
  }
  const tiles = joinKeyboard(
    profileId,
    data.blocks,
    data.positions,
    data.representations,
  );
  const chosen =
    sequence?.block_ids.map((id) => {
      const block = data.blocks.find(
        (item) => item.id === id && item.profile_id === profileId,
      );
      return {
        label: block?.label ?? "Touche indisponible",
        representation: block
          ? blockRepresentation(profileId, block, data.representations)
          : undefined,
      };
    }) ?? [];
  const literal = chosen.map((item) => item.label).join(" ");
  const completed = sequence?.status === "completed";
  const accepted =
    decision?.candidates.some((candidate) =>
      ["confirmed", "corrected"].includes(candidate.status),
    ) ?? false;
  const pending =
    busy || restoring || data.loading || restoreFailed || !display.ready;
  return (
    <>
      {!standalone && (
        <ProfileNavigation profileId={profileId} section="communication" />
      )}
      <section
        className={`page communication-page${standalone ? " communication-standalone" : ""}`}
      >
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {standalone ? "PICTOFLOW · MES MOTS" : "MON MESSAGE, MES MOTS"}
            </div>
            <h1>Je communique</h1>
            <p className="communication-profile">
              <ProfileIdentity profileId={profileId} />
            </p>
            <p>
              Choisissez vos touches dans l'ordre. Votre message peut rester tel
              quel ou recevoir une proposition de phrase.
            </p>
          </div>
          <div className="communication-navigation">
            {!standalone && (
              <Link
                className="button-link"
                href={`/communication/${profileId}`}
                aria-disabled={busy}
                tabIndex={busy ? -1 : undefined}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
              >
                Ouvrir l’espace de communication
              </Link>
            )}
            <Link
              className="button-link secondary"
              href={`/admin/profiles/${profileId}/keyboard`}
              aria-disabled={busy}
              tabIndex={busy ? -1 : undefined}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              {standalone ? "Retour à la préparation" : "Modifier mon clavier"}
            </Link>
          </div>
        </div>
        {data.error && (
          <div className="error" role="alert">
            {data.error}
            {restoreFailed && (
              <button
                className="secondary"
                onClick={() => window.location.reload()}
              >
                Recharger le message
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {pending && (
          <p role="status">
            {busy ? "Enregistrement…" : "Chargement de votre clavier…"}
          </p>
        )}
        <section className="message-panel" aria-label="Message en cours">
          <div className="zone-heading">
            <h2>{completed ? "Mon message terminé" : "Mon message"}</h2>
            <span>{chosen.length} / 32 touches</span>
          </div>
          <div className="message-tokens" role="status" aria-live="polite">
            {chosen.length ? (
              chosen.map((item, index) => (
                <span className="message-touch" key={index}>
                  <TouchContent
                    label={item.label}
                    representation={item.representation}
                  />
                </span>
              ))
            ) : (
              <p>Votre message apparaîtra ici.</p>
            )}
          </div>
          <div className="actions">
            <button
              className="secondary"
              onClick={() => void perform(() => selection("undo"))}
              disabled={pending || completed || !chosen.length}
            >
              Annuler la dernière touche
            </button>
            <button
              className="secondary"
              onClick={() => void perform(() => selection("clear"))}
              disabled={pending || completed || !chosen.length}
            >
              Effacer le message
            </button>
            <button
              onClick={() => void perform(() => selection("complete"))}
              disabled={pending || completed || !chosen.length}
            >
              Terminer mon message
            </button>
            <button
              className="secondary"
              onClick={() => speech.read(literal)}
              disabled={!speech.available || !literal || pending}
            >
              Lire mes mots
            </button>
            <button
              className="secondary"
              onClick={() => void perform(newMessage)}
              disabled={pending || !sequence}
            >
              Nouveau message
            </button>
          </div>
          {!speech.available && (
            <p className="helper">
              La lecture vocale française locale n'est pas disponible dans ce
              navigateur.
            </p>
          )}
          {speech.speaking && (
            <button className="secondary" onClick={speech.stop}>
              Arrêter la lecture
            </button>
          )}
          {speech.error && <p role="alert">{speech.error}</p>}
        </section>
        <DisplaySettings
          size={display.size}
          onChange={display.change}
          disabled={pending}
          temporary={display.temporary}
        />
        {!data.loading &&
          display.ready &&
          (tiles.length ? (
            <KeyboardGrid
              profileId={profileId}
              groups={data.groups}
              tiles={tiles}
              onSelect={(tile) => perform(() => select(tile))}
              disabled={pending || Boolean(completed) || chosen.length >= 32}
              displaySize={display.size}
            />
          ) : (
            <div className="empty">
              <h2>Il faut d'abord préparer vos touches</h2>
              <p>
                Créez et validez vos premières touches dans l'éditeur du
                clavier.
              </p>
              <Link
                className="button-link"
                href={`/admin/profiles/${profileId}/keyboard`}
              >
                Créer mes premières touches
              </Link>
            </div>
          ))}
        {completed && !decision && (
          <section className="panel interpretation-panel">
            <h2>Une proposition de phrase ?</h2>
            <p>
              La proposition reste à vérifier. Vos touches et leur ordre sont
              conservés.
            </p>
            <label>
              Contexte que je souhaite préciser, facultatif
              <input
                value={context}
                onChange={(event) => setContext(event.target.value)}
                maxLength={256}
                disabled={pending}
                placeholder="Par exemple : je suis à la maison"
              />
            </label>
            <button onClick={() => void perform(propose)} disabled={pending}>
              Proposer une phrase
            </button>
          </section>
        )}
        {decision && (
          <section className="review-section">
            <h2>Vérifier ce que je veux dire</h2>
            <HumanRoleSelector
              value={role}
              onChange={setRole}
              disabled={pending}
            />
            {decision.state === "not_understood" ? (
              <div className="notice">
                <p>
                  Aucune interprétation fiable n'a été trouvée. Vos mots restent
                  disponibles et peuvent être lus tels quels.
                </p>
              </div>
            ) : (
              <>
                <p>
                  Choisissez une proposition, corrigez-la si besoin, ou
                  écartez-la. Aucune proposition n'entre seule dans la mémoire
                  validée.
                </p>
                {decision.candidates.map((candidate) => (
                  <InterpretationCard
                    key={candidate.id}
                    candidate={candidate}
                    disabled={
                      pending || (accepted && candidate.status === "proposed")
                    }
                    read={speech.available ? speech.read : undefined}
                    feedback={(action, text) =>
                      perform(() => feedback(candidate, action, text))
                    }
                  />
                ))}
              </>
            )}
            <Link
              className="text-link"
              href={`/admin/profiles/${profileId}/memory`}
            >
              Consulter la mémoire de ce profil →
            </Link>
          </section>
        )}
      </section>
    </>
  );
}

function InterpretationCard({
  candidate,
  disabled,
  feedback,
  read,
}: {
  candidate: Interpretation;
  disabled: boolean;
  feedback: (
    action: "confirm" | "correct" | "reject",
    corrected?: string,
  ) => Promise<void>;
  read?: (text: string) => void;
}) {
  const [correction, setCorrection] = useState(
    candidate.corrected_text ?? candidate.text,
  );
  const accepted = ["confirmed", "corrected"].includes(candidate.status);
  const text = candidate.corrected_text ?? candidate.text;
  return (
    <section className="panel interpretation-card">
      <span className="tag">
        {accepted
          ? "Mémoire validée"
          : candidate.status === "rejected"
            ? "Proposition écartée"
            : "Proposition à vérifier"}
      </span>
      <p className="proposed-phrase">{text}</p>
      {candidate.corrected_text && (
        <details>
          <summary>Voir la proposition d'origine</summary>
          <p>{candidate.text}</p>
        </details>
      )}
      {read && (
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => read(text)}
        >
          Lire cette phrase
        </button>
      )}
      {candidate.status === "proposed" && (
        <>
          <div className="actions">
            <button
              disabled={disabled}
              onClick={() => void feedback("confirm")}
            >
              C'est ce que je veux dire
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void feedback("reject")}
            >
              Ce n'est pas mon sens
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void feedback("correct", correction);
            }}
          >
            <label>
              Je corrige la phrase
              <textarea
                value={correction}
                onChange={(event) => setCorrection(event.target.value)}
                maxLength={4000}
                required
                disabled={disabled}
                rows={3}
              />
            </label>
            <button
              className="secondary"
              disabled={disabled || !correction.trim()}
            >
              Valider ma correction
            </button>
          </form>
        </>
      )}
      {accepted && (
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => void feedback("reject")}
        >
          Retirer cette interprétation de la mémoire validée
        </button>
      )}
    </section>
  );
}
