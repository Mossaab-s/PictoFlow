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
import { useAuthentication } from "./authentication";
import { canPrepare } from "@/lib/access";
import { useProfileKeyboard } from "./use-profile-keyboard";
import { TouchContent } from "./pictogram";
import ProfileIdentity from "./profile-identity";
import { useLocalSpeech } from "./use-local-speech";
import CommunicationPreferences from "./communication-preferences";
import { useDisplaySettings } from "./use-display-settings";
import PhraseLibrary from "./phrase-library";
import { useContrastSetting } from "./use-contrast-setting";
import OfflineCommunication from "./offline-communication";
import CompositionMemory from "./composition-memory";
import { replayAvailable } from "@/lib/learning";
import MemorySuggestions from "./memory-suggestions";
import AIContext from "./ai-context";
import MessageResetDialog from "./message-reset-dialog";
import { useOnlineStatus } from "./use-online-status";
import SelectionRhythm from "./selection-rhythm";
import {
  selectionObservation,
  type InputMethod,
  type SelectionMark,
} from "@/lib/selection-rhythm";
import { useMemorySuggestionMode } from "./use-memory-suggestion-mode";
import type { MemoryProposalBody } from "@/lib/memory-suggestions";

export default function CommunicationScreen({
  profileId,
  standalone = false,
  initialPhraseId = null,
}: {
  profileId: string;
  standalone?: boolean;
  initialPhraseId?: string | null;
}) {
  const data = useProfileKeyboard(profileId);
  const online = useOnlineStatus();
  const canEdit = canPrepare(useAuthentication(), profileId);
  const display = useDisplaySettings(profileId);
  const contrast = useContrastSetting(profileId);
  const suggestions = useMemorySuggestionMode(profileId);
  const messageHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const tools = useRef<HTMLDetailsElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const toolsReturn = useRef<HTMLButtonElement | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  useEffect(() => {
    if (decision) requestAnimationFrame(() => reviewHeading.current?.focus());
  }, [decision]);
  const [context, setContext] = useState("");
  const [observeRhythm, setObserveRhythm] = useState(false);
  const lastSelection = useRef<SelectionMark | null>(null);
  const inputMethod = useRef<InputMethod>("unknown");
  const [role, setRole] = useState<HumanRole>("user");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [resetAction, setResetAction] = useState<"clear" | "new" | null>(null);
  const resetOpener = useRef<HTMLButtonElement | null>(null);
  const [phraseChoice, setPhraseChoice] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const current = useRef<Sequence | null>(null);
  const gate = useRef(false);
  const alive = useRef(true);
  const speech = useLocalSpeech(profileId);
  useEffect(() => {
    if ((phraseChoice || initialPhraseId) && tools.current)
      tools.current.open = true;
  }, [phraseChoice, initialPhraseId]);
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

  useEffect(() => {
    setObserveRhythm(false);
    lastSelection.current = null;
  }, [profileId]);

  useEffect(() => {
    const reset = () => {
      if (document.hidden) lastSelection.current = null;
    };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);

  async function perform(task: () => Promise<void>) {
    if (gate.current) return;
    const origin =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    gate.current = true;
    setBusy(true);
    data.setError("");
    setNotice("");
    try {
      await task();
    } catch (error) {
      lastSelection.current = null;
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
                const matchingDecision =
                  sequence?.id === restored.id ? decision : null;
                const candidates = matchingDecision
                  ? await Promise.all(
                      matchingDecision.candidates.map((candidate) =>
                        api<Interpretation>(
                          `${base}/interpretations/${candidate.id}`,
                        ),
                      ),
                    )
                  : [];
                if (alive.current)
                  remember(
                    restored,
                    matchingDecision
                      ? { ...matchingDecision, candidates }
                      : null,
                  );
              }
            }
          } catch {
            // An ambiguous write cannot be followed by more writes until state is reloaded.
            if (alive.current) setRestoreFailed(true);
          }
        } else if (error instanceof TypeError && alive.current)
          setRestoreFailed(true);
      }
    } finally {
      gate.current = false;
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (
            !alive.current ||
            (document.activeElement !== document.body &&
              document.activeElement !== origin)
          )
            return;
          if (origin?.isConnected && !origin.disabled) origin.focus();
          else messageHeading.current?.focus();
        });
      }
    }
  }
  async function select(tile: Tile, clickedAt = performance.now()) {
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
        body: JSON.stringify({
          action: "append",
          block_id: tile.block_id,
          ...(observeRhythm
            ? {
                observation: selectionObservation(
                  lastSelection.current,
                  active.id,
                  clickedAt,
                  inputMethod.current,
                ),
              }
            : {}),
        }),
      },
    );
    if (alive.current) {
      lastSelection.current = observeRhythm
        ? { sequenceId: active.id, clickedAt, releasedAt: performance.now() }
        : null;
      remember(result, null);
    }
  }
  async function selection(action: "undo" | "clear" | "complete") {
    if (!current.current) return;
    lastSelection.current = null;
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
  async function proposeFromMemory(body: MemoryProposalBody) {
    let succeeded = false;
    await perform(async () => {
      const active = current.current;
      if (!active || active.status !== "completed") return;
      let result: Decision;
      try {
        result = await api<Decision>(
          `${base}/sequences/${active.id}/memory-proposals`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      } catch (error) {
        if (error instanceof APIError && error.status === 409)
          throw new Error(
            "Cette suggestion a changé ou n’est plus disponible. Actualisez les suggestions, puis vérifiez votre choix.",
          );
        if (error instanceof TypeError)
          throw new Error(
            "La connexion a été interrompue. Réessayez la même proposition.",
          );
        throw error;
      }
      if (alive.current && current.current?.id === active.id) {
        remember(active, result);
        setNotice(
          "Cette proposition vient uniquement de vos phrases acceptées. Choisissez si elle exprime votre message.",
        );
        succeeded = true;
      }
    });
    return succeeded;
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
  async function replay() {
    const previous = current.current;
    if (!previous || !replayAvailable(profileId, previous, data.blocks)) return;
    speech.stop();
    let active = await api<Sequence>(`${base}/sequences`, {
      method: "POST",
      body: JSON.stringify({
        session_id: newIdentity(),
        context_id: previous.context_id ?? null,
      }),
    });
    if (!alive.current) return;
    remember(active, null);
    setContext("");
    for (const blockId of previous.block_ids) {
      active = await api<Sequence>(`${base}/sequences/${active.id}/selection`, {
        method: "POST",
        body: JSON.stringify({ action: "append", block_id: blockId }),
      });
      if (!alive.current) return;
      remember(active, null);
    }
    active = await api<Sequence>(`${base}/sequences/${active.id}/selection`, {
      method: "POST",
      body: JSON.stringify({ action: "complete" }),
    });
    if (alive.current) {
      remember(active, null);
      setNotice(
        "Les mêmes touches composent un nouveau message. Retrouvez vos choix précédents dans le PCL, puis choisissez ce que vous voulez dire.",
      );
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
    busy ||
    !online ||
    restoring ||
    data.loading ||
    restoreFailed ||
    !display.ready ||
    !contrast.ready ||
    !suggestions.ready ||
    !speech.ready;
  function cancelReset() {
    setResetAction(null);
    requestAnimationFrame(() => resetOpener.current?.focus());
  }
  function requestReset(action: "clear" | "new", button: HTMLButtonElement) {
    if (chosen.length && (!completed || (!!decision && !accepted))) {
      resetOpener.current = button;
      setResetAction(action);
    } else
      void perform(action === "clear" ? () => selection("clear") : newMessage);
  }
  return (
    <>
      {!standalone && (
        <ProfileNavigation profileId={profileId} section="communication" />
      )}
      <section
        className={`page communication-page${standalone ? " communication-standalone" : ""}${contrast.enhanced ? " contrast-enhanced" : ""}`}
        onMouseDownCapture={(event) => {
          if (event.button !== 0 || !(event.target instanceof Element)) return;
          const button = event.target.closest("button");
          if (button instanceof HTMLButtonElement && !button.disabled) {
            // Native focus scrolling must not move a button between pointer press and release.
            event.preventDefault();
            button.focus({ preventScroll: true });
          }
        }}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && speech.speaking) {
            event.preventDefault();
            speech.stop();
          }
        }}
      >
        <nav className="communication-jumps" aria-label="Accès rapides">
          <a href="#communication-message">Aller au message</a>
          <a href="#communication-keyboard">Aller au clavier</a>
        </nav>
        <header className="communication-heading">
          <div>
            <h1>Je communique</h1>
            <p className="communication-profile">
              <ProfileIdentity profileId={profileId} />
            </p>
          </div>
          <button
            ref={toolsButton}
            className="secondary"
            aria-controls="communication-options"
            aria-label="Plus d’options"
            aria-expanded={toolsOpen}
            onClick={(event) => {
              toolsReturn.current = event.currentTarget;
              if (tools.current) {
                tools.current.open = true;
                tools.current.querySelector("summary")?.focus();
                tools.current.scrollIntoView({ block: "start" });
              }
            }}
          >
            Options
          </button>
          <button
            className="secondary"
            disabled={busy || restoring}
            onClick={(event) => {
              toolsReturn.current = event.currentTarget;
              if (tools.current) {
                tools.current.open = true;
                const library =
                  tools.current.querySelector<HTMLDetailsElement>(
                    ".phrase-library",
                  );
                if (library) {
                  library.open = true;
                  library.querySelector("summary")?.focus();
                  library.scrollIntoView({ block: "start" });
                }
              }
            }}
          >
            Mes phrases
          </button>
        </header>
        {!online && (
          <div className="communication-connection notice" role="status">
            <strong>Connexion réseau interrompue</strong>
            <p>
              Vos mots déjà affichés restent lisibles. Vous pouvez les faire
              parler si une voix locale est disponible. Les envois attendent
              votre action.
            </p>
            <Link className="text-link" href="/offline">
              Ouvrir une copie hors connexion déjà préparée
            </Link>
          </div>
        )}
        {data.error && (
          <div className="error" role="alert">
            <span>{data.error}</span>
            <p>
              Votre message reste affiché. Aucune action n’est renvoyée
              automatiquement.
            </p>
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
        {(busy || restoring || data.loading) && (
          <p role="status">
            {busy ? "Enregistrement…" : "Chargement de votre clavier…"}
          </p>
        )}
        <section
          className="message-panel"
          data-completed={completed ? "true" : "false"}
          aria-label="Message en cours"
          id="communication-message"
          tabIndex={-1}
        >
          <div className="zone-heading">
            <h2 ref={messageHeading} tabIndex={-1}>
              {completed ? "Mon message terminé" : "Mon message"}
            </h2>
            <span>{chosen.length} / 32 touches</span>
          </div>
          <div
            className="message-tokens"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
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
              className="speak-message"
              onClick={() => speech.read(literal)}
              disabled={!speech.available || !literal || busy || restoring}
              aria-label="Parler : lire mes mots"
            >
              Parler
            </button>
            <button
              className="secondary"
              onClick={() => void perform(() => selection("undo"))}
              aria-label="Annuler la dernière touche"
              disabled={pending || completed || !chosen.length}
            >
              Annuler
            </button>
            <button
              className="secondary"
              onClick={(event) => requestReset("clear", event.currentTarget)}
              aria-label="Effacer le message"
              disabled={pending || completed || !chosen.length}
            >
              Effacer
            </button>
          </div>
          <div className="message-flow-actions">
            <a
              className="button-link secondary"
              href="#communication-suggestions"
            >
              Suggestions :{" "}
              {suggestions.mode === "off"
                ? "désactivées"
                : suggestions.mode === "words"
                  ? "mots"
                  : "phrases"}
            </a>
            {!completed && (
              <button
                className="secondary"
                onClick={() => void perform(() => selection("complete"))}
                disabled={pending || !chosen.length}
              >
                Terminer mon message
              </button>
            )}
            {sequence && (
              <button
                className="secondary"
                onClick={(event) => requestReset("new", event.currentTarget)}
                disabled={pending || !sequence}
              >
                Nouveau message
              </button>
            )}
          </div>
          <p className="helper">
            {!chosen.length
              ? "Choisissez vos touches, puis Parler pour les lire."
              : completed
                ? "Vos mots sont conservés. Vous pouvez les lire ou choisir une formulation à vérifier."
                : "Parler lit vos mots. Terminer permet ensuite de vérifier une phrase."}
          </p>
          {!speech.available && (
            <p className="helper">
              La lecture vocale française locale n'est pas disponible dans ce
              navigateur.
            </p>
          )}
          {(speech.speaking || speech.error) && (
            <div className="message-speech-status">
              {" "}
              <div
                className={`speech-controls${speech.speaking ? " is-speaking" : ""}`}
              >
                <span role="status">
                  {speech.speaking ? "Lecture en cours…" : "Lecture arrêtée"}
                </span>
                <button
                  className="secondary"
                  onClick={speech.stop}
                  disabled={!speech.speaking}
                >
                  Arrêter la lecture
                </button>
              </div>
              {speech.error && (
                <p className="error" role="alert">
                  {speech.error}
                </p>
              )}
            </div>
          )}
        </section>
        <section
          className="communication-keyboard"
          id="communication-keyboard"
          onPointerDownCapture={() => {
            inputMethod.current = "pointer";
          }}
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" || event.key === " ")
              inputMethod.current = "keyboard";
          }}
          tabIndex={-1}
          aria-label="Mon clavier de communication"
        >
          {canEdit ? (
            <Link
              className="button-link secondary"
              href={`/admin/profiles/${profileId}/keyboard?resume=1`}
              aria-disabled={pending}
              onClick={(event) => {
                if (pending) event.preventDefault();
              }}
            >
              Il me manque un mot
            </Link>
          ) : (
            <p className="helper">
              Il vous manque un mot ? Une personne autorisée à préparer ce
              profil peut ajouter une touche avec vous.
            </p>
          )}
          {completed && canEdit && (
            <p className="helper">
              Ce message est terminé. Après l’ajout d’une touche, choisissez «
              Refaire un essai avec les mêmes touches » ou « Nouveau message »
              pour l’utiliser.
            </p>
          )}
          <p className="keyboard-help">
            Au clavier : Tab pour parcourir, Entrée ou Espace pour choisir.
            Échap arrête la lecture. Les cases libres sont ignorées.
          </p>
          {!data.loading &&
            display.ready &&
            (tiles.length ? (
              <KeyboardGrid
                profileId={profileId}
                groups={data.groups}
                tiles={tiles}
                onSelect={(tile) => {
                  const clickedAt = performance.now();
                  return perform(() => select(tile, clickedAt));
                }}
                disabled={pending || Boolean(completed) || chosen.length >= 32}
                displaySize={display.size}
              />
            ) : (
              <div className="empty">
                <h2>Il faut d'abord préparer vos touches</h2>
                <p>
                  {canEdit
                    ? "Créez et validez vos premières touches dans l’éditeur du clavier."
                    : "Demandez à une personne qui prépare ce profil d’ajouter les touches avec vous."}
                </p>
                {canEdit && (
                  <Link
                    className="button-link"
                    href={`/admin/profiles/${profileId}/keyboard`}
                  >
                    Créer mes premières touches
                  </Link>
                )}
              </div>
            ))}
        </section>
        <MemorySuggestions
          key={`suggestions:${profileId}`}
          profileId={profileId}
          sequence={sequence}
          mode={suggestions.mode}
          onModeChange={suggestions.change}
          temporary={suggestions.temporary}
          disabled={pending || accepted}
          revision={decision}
          onPropose={proposeFromMemory}
        />
        <details
          ref={tools}
          id="communication-options"
          className="communication-tools"
          onToggle={() => setToolsOpen(Boolean(tools.current?.open))}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !speech.speaking) {
              event.preventDefault();
              if (tools.current) tools.current.open = false;
              (toolsReturn.current ?? toolsButton.current)?.focus();
            }
          }}
        >
          <summary>Plus d’options : voix, affichage et préparation</summary>
          <button
            className="secondary"
            onClick={() => {
              if (tools.current) tools.current.open = false;
              (toolsReturn.current ?? toolsButton.current)?.focus();
            }}
          >
            Revenir au clavier
          </button>
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
            {canEdit ? (
              <Link
                className="button-link secondary"
                href={`/admin/profiles/${profileId}/keyboard`}
                aria-disabled={busy}
                tabIndex={busy ? -1 : undefined}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
              >
                {standalone
                  ? "Retour à la préparation"
                  : "Modifier mon clavier"}
              </Link>
            ) : (
              <Link className="button-link secondary" href="/admin/profiles">
                Mes profils
              </Link>
            )}
          </div>
          <PhraseLibrary
            profileId={profileId}
            blocks={data.blocks}
            visuals={data.representations}
            speech={speech}
            disabled={pending}
            initialPhraseId={phraseChoice?.id ?? initialPhraseId}
            choiceRevision={phraseChoice?.version ?? 0}
            revision={decision}
          />
          <CommunicationPreferences
            display={display}
            speech={speech}
            tile={tiles.find((tile) => tile.zone !== "stable") ?? tiles[0]}
            disabled={pending}
            contrast={contrast}
          />
          <OfflineCommunication
            key={profileId}
            profileId={profileId}
            speech={speech}
            size={display.size}
            canOpen={!sequence && !pending}
            onOpen={(value) => {
              remember(value, null);
              setNotice("Votre message local enregistré est ouvert.");
            }}
          />
          {chosen.length > 0 && (
            <details className="panel">
              <summary>Le sens personnel de mes touches</summary>
              <p>
                Les mots et dessins restent vos repères. Ces sens viennent du
                profil et peuvent aider à comprendre une proposition de phrase.
              </p>
              <ol>
                {sequence?.block_ids.map((id, index) => {
                  const block = data.blocks.find(
                    (item) => item.id === id && item.profile_id === profileId,
                  );
                  const meaning =
                    data.concepts.find(
                      (item) =>
                        item.id === block?.concept_id &&
                        item.profile_id === profileId,
                    )?.label ?? block?.canonical_intent;
                  return (
                    <li key={index}>
                      <strong>{block?.label ?? "Touche indisponible"}</strong> :{" "}
                      {meaning ?? "Sens indisponible"}
                    </li>
                  );
                })}
              </ol>
            </details>
          )}
          <SelectionRhythm
            key={`rhythm:${profileId}:${sequence?.id ?? "new"}`}
            profileId={profileId}
            sequenceId={sequence?.id ?? null}
            enabled={observeRhythm}
            disabled={pending}
            onChange={(enabled) => {
              setObserveRhythm(enabled);
              lastSelection.current = null;
            }}
          />
        </details>
        {completed && sequence && (
          <CompositionMemory
            key={sequence.id}
            profileId={profileId}
            sequence={sequence}
            revision={decision}
            decision={decision}
            disabled={pending}
            canReplay={replayAvailable(profileId, sequence, data.blocks)}
            onReplay={() => void perform(replay)}
            onChoose={(id) => {
              speech.stop();
              setPhraseChoice((previous) => ({
                id,
                version: (previous?.version ?? 0) + 1,
              }));
            }}
          />
        )}
        {completed && !decision && suggestions.mode === "off" && (
          <section className="panel interpretation-panel">
            <h2>Une proposition de phrase ?</h2>
            <p>
              La proposition reste à vérifier. Vos touches et leur ordre sont
              conservés.
            </p>
            <p className="helper">
              Cette demande utilise l’IA configurée, si elle est disponible,
              guidée par votre mémoire personnelle. Les modes Mots et Phrases
              utilisent uniquement vos phrases acceptées.
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
            <p className="helper">
              Cette précision aide seulement la proposition actuelle. Elle ne
              change pas le sens de vos touches et n’ajoute aucun mot aux
              suggestions de mémoire.
            </p>
            <button onClick={() => void perform(propose)} disabled={pending}>
              Proposer une phrase
            </button>
          </section>
        )}
        {decision &&
          (suggestions.mode === "off" ||
            accepted ||
            decision.candidates.some(
              (item) => item.source === "pcl-memory",
            )) && (
            <section className="review-section">
              <h2 ref={reviewHeading} tabIndex={-1}>
                Vérifier ce que je veux dire
              </h2>
              <details>
                <summary>Qui valide ce message ?</summary>
                <HumanRoleSelector
                  value={role}
                  onChange={setRole}
                  disabled={pending}
                />
              </details>
              {decision.state === "not_understood" ? (
                <div className="notice">
                  <p>
                    Aucune interprétation fiable n'a été trouvée. Vos mots
                    restent disponibles et peuvent être lus tels quels.
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
      <MessageResetDialog
        action={resetAction}
        cancel={cancelReset}
        confirm={() => {
          const action = resetAction;
          setResetAction(null);
          requestAnimationFrame(() => {
            resetOpener.current?.focus();
            if (action)
              void perform(
                action === "clear" ? () => selection("clear") : newMessage,
              );
          });
        }}
      />
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
      {candidate.source === "pcl-memory" && (
        <p className="helper">
          Proposition issue uniquement des phrases acceptées de ce profil. Elle
          reste à vérifier pour ce message.
        </p>
      )}
      {candidate.source === "pcl" && !candidate.corrected_text && (
        <p className="notice">
          Vos mots sont présentés tels quels. Vous pouvez les lire ou les
          reformuler pour préciser votre message.
        </p>
      )}
      {["openai-compatible", "prism", "fake"].includes(candidate.source) && (
        <AIContext
          profileId={candidate.profile_id}
          interpretationId={candidate.id}
        />
      )}
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
          <details className="correction-editor">
            <summary>Modifier la phrase</summary>
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
          </details>
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
