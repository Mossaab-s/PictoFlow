"use client";
import {
  useId,
  useRef,
  useState,
  useEffect,
  type RefObject,
  type ReactNode,
} from "react";
import type {
  Decision,
  Interpretation,
  KeyboardGroup,
  Sequence,
  Tile,
} from "@/lib/keyboard";
import type { DisplaySize } from "@/lib/display";
import KeyboardGrid from "./keyboard-grid";
import CommunicationTouchSearch from "./communication-touch-search";
import CompactPhraseComparison from "./compact-phrase-comparison";
import ProfileIdentity from "./profile-identity";
import CompactMessageTouches from "./compact-message-touches";
import type { Word, TouchRemoval } from "./message-touch-editor";

export default function CompactCommunication({
  profileId,
  sequence,
  words,
  tiles,
  groups,
  displaySize,
  contrastEnhanced,
  decision,
  disabled,
  busy,
  generation,
  notice,
  error,
  online,
  canReview,
  canFormulate,
  speech,
  heading,
  select,
  remove,
  replace,
  onTouchEditingChange,
  undo,
  reset,
  review,
  options,
  phrases,
  refresh,
}: {
  profileId: string;
  sequence: Sequence | null;
  words: Word[];
  tiles: Tile[];
  groups: KeyboardGroup[];
  displaySize: DisplaySize;
  contrastEnhanced: boolean;
  decision: Decision | null;
  disabled: boolean;
  busy: boolean;
  generation: {
    pending: boolean;
    busy: boolean;
    error: string;
    retry: () => void;
  };
  notice: string;
  error: string;
  online: boolean;
  canReview: boolean;
  canFormulate: boolean;
  speech: {
    available: boolean;
    speaking: boolean;
    error: string;
    read: (text: string) => void;
    stop: () => void;
  };
  heading: RefObject<HTMLHeadingElement | null>;
  select: (tile: Tile) => Promise<void>;
  remove: (choice: TouchRemoval) => Promise<void>;
  replace: (choice: TouchRemoval & { blockId: string }) => Promise<void>;
  onTouchEditingChange: (editing: boolean) => void;
  undo: () => void;
  reset: (button: HTMLButtonElement) => void;
  review: (
    candidate: Interpretation,
    action: "confirm" | "correct" | "reject",
    text?: string,
  ) => Promise<boolean>;
  options: () => void;
  phrases: ReactNode;
  refresh: () => void;
}) {
  const candidates = decision?.candidates ?? [];
  const [inspectedId, setInspectedId] = useState("");
  const [reviewError, setReviewError] = useState("");
  const accepted = candidates.find((item) =>
    ["confirmed", "corrected"].includes(item.status),
  );
  const candidate =
    accepted ??
    candidates.find((item) => item.id === inspectedId) ??
    candidates[0];
  const text =
    candidate?.status === "rejected"
      ? undefined
      : (candidate?.corrected_text ?? candidate?.text);
  const literal = words.map((word) => word.label).join(" ");
  const [correction, setCorrection] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    if (correction) editor.current?.showModal();
    else editor.current?.close();
  }, [correction?.id]);
  function close() {
    editor.current?.close();
    setCorrection(null);
    requestAnimationFrame(() =>
      opener.current?.isConnected
        ? opener.current.focus({ preventScroll: true })
        : heading.current?.focus({ preventScroll: true }),
    );
  }
  const currentCandidate = candidate?.status === "proposed";
  return (
    <section
      className={`compact-communication${contrastEnhanced ? " contrast-enhanced" : ""}`}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && speech.speaking) {
          event.preventDefault();
          speech.stop();
        }
      }}
    >
      <header className="compact-heading">
        <div>
          <h1>Je communique</h1>
          <ProfileIdentity profileId={profileId} />
        </div>
        <div className="compact-heading-actions">
          {phrases}
          <button className="secondary" onClick={options}>
            Options
          </button>
        </div>
      </header>
      <section className="compact-message" aria-label="Message en cours">
        <div className="compact-words">
          <h2 ref={heading} tabIndex={-1}>
            Mon message
          </h2>
          <CompactMessageTouches
            profileId={profileId}
            sequence={sequence}
            words={words}
            tiles={tiles}
            groups={groups}
            displaySize={displaySize}
            disabled={disabled}
            busy={busy}
            heading={heading}
            stop={speech.stop}
            remove={remove}
            replace={replace}
            onEditingChange={onTouchEditingChange}
          />
        </div>
        <div className="compact-formulation">
          <div className="compact-phrase-heading">
            <span>
              {accepted
                ? "Phrase validée"
                : text && candidate?.source !== "pcl"
                  ? "Phrase à vérifier"
                  : "Mes pictos"}
            </span>
            {candidates.length > 1 && candidate && (
              <CompactPhraseComparison
                candidates={candidates}
                inspected={candidate}
                disabled={disabled}
                accepted={Boolean(accepted)}
                speech={speech}
                heading={heading}
                inspect={setInspectedId}
              />
            )}
          </div>
          <p
            className="proposed-phrase"
            tabIndex={0}
            aria-live="polite"
            aria-atomic="true"
          >
            {text || literal || "Votre message apparaîtra ici."}
          </p>
          <p className="compact-status" role="status">
            {!online
              ? "Hors connexion · vos pictos restent lisibles."
              : error ||
                generation.error ||
                (generation.pending
                  ? "Une proposition arrive… vous pouvez continuer."
                  : accepted
                    ? "Seule votre validation a ajouté cette phrase à la mémoire."
                    : candidate?.status === "rejected"
                      ? "Phrase écartée. Choisissez un autre sens ou recommencez."
                      : notice ||
                        (words.length
                          ? "Une proposition ne décide pas à votre place."
                          : "Aucune lecture ou validation automatique."))}
          </p>
        </div>
        <div className="compact-actions">
          <button
            className="speak-message"
            disabled={!speech.available || !(text || literal) || busy}
            onClick={() => speech.read(text || literal)}
          >
            Parler
          </button>
          <button
            disabled={disabled || !canReview || !currentCandidate}
            onClick={() => candidate && void review(candidate, "confirm")}
          >
            C’est ça
          </button>
          <button
            className="secondary"
            disabled={disabled || !canReview || !currentCandidate}
            onClick={(event) => {
              if (candidate) {
                opener.current = event.currentTarget;
                setReviewError("");
                setCorrection({ id: candidate.id, text: text ?? "" });
              }
            }}
          >
            Changer
          </button>
          {speech.speaking ? (
            <button className="secondary" onClick={speech.stop}>
              Arrêter la lecture
            </button>
          ) : (
            <button
              className="secondary"
              disabled={!speech.available || !literal}
              onClick={() => speech.read(literal)}
            >
              Lire mes pictos
            </button>
          )}
          {currentCandidate && (
            <button
              className="secondary"
              disabled={disabled || !canReview}
              onClick={() => candidate && void review(candidate, "reject")}
            >
              Pas ça
            </button>
          )}
          {canFormulate &&
            (!decision || generation.error || (decision && !accepted)) &&
            words.length > 0 && (
              <button
                className="secondary"
                disabled={disabled || generation.busy}
                onClick={generation.error ? generation.retry : refresh}
              >
                {decision
                  ? "Autre phrase"
                  : generation.busy
                    ? "Proposition en cours…"
                    : "Formuler"}
              </button>
            )}
          {error && (
            <button
              className="secondary"
              onClick={() => window.location.reload()}
            >
              Recharger le message
            </button>
          )}
        </div>
      </section>
      <section
        className="compact-keyboard"
        aria-label="Mon clavier de communication"
      >
        <div className="compact-stable" aria-label="Repères fixes">
          {tiles.some((tile) => tile.zone === "stable") ? (
            <KeyboardGrid
              profileId={profileId}
              tiles={tiles.filter((tile) => tile.zone === "stable")}
              groups={[]}
              onSelect={select}
              disabled={disabled || words.length >= 32}
            />
          ) : (
            <p className="helper">
              Les repères fixes de ce profil sont à préparer dans les options.
            </p>
          )}
        </div>
        <div
          className="compact-browse"
          tabIndex={0}
          aria-label="Parcourir mes pictos"
        >
          <CommunicationTouchSearch
            profileId={profileId}
            tiles={tiles}
            groups={groups}
            displaySize={displaySize}
            disabled={disabled || words.length >= 32}
            onSelect={select}
          />
          <KeyboardGrid
            profileId={profileId}
            tiles={tiles.filter((tile) => tile.zone !== "stable")}
            groups={groups}
            displaySize={displaySize}
            disabled={disabled || words.length >= 32}
            onSelect={select}
          />
          {!tiles.length && (
            <p>
              Ce clavier attend ses touches. Une personne autorisée peut les
              préparer dans les options.
            </p>
          )}
        </div>
      </section>
      <footer className="compact-footer">
        <button
          className="secondary"
          disabled={disabled || !words.length}
          onClick={undo}
        >
          Annuler
        </button>
        <span>{words.length} / 32</span>
        <button
          className="secondary"
          disabled={disabled || !sequence}
          onClick={(event) => reset(event.currentTarget)}
        >
          Recommencer
        </button>
      </footer>
      {speech.error && (
        <p role="alert" className="error compact-error">
          {speech.error}
        </p>
      )}
      {correction && (
        <dialog
          ref={editor}
          className="message-reset-dialog"
          aria-labelledby={`${id}-edit`}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <h2 id={`${id}-edit`}>Changer la phrase</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const item = candidates.find((item) => item.id === correction.id);
              if (item) {
                if (await review(item, "correct", correction.text)) close();
                else
                  setReviewError(
                    "La correction n’a pas été enregistrée. Votre texte reste ici. Vérifiez la connexion ou rechargez le message.",
                  );
              }
            }}
          >
            <label>
              Je corrige la phrase
              <textarea
                autoFocus
                required
                maxLength={4000}
                rows={4}
                value={correction.text}
                disabled={disabled}
                onChange={(event) =>
                  setCorrection({ ...correction, text: event.target.value })
                }
              />
            </label>
            {reviewError && (
              <p role="alert" className="error">
                {reviewError}
              </p>
            )}
            <div className="actions">
              <button disabled={disabled || !correction.text.trim()}>
                Valider ma correction
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={close}
              >
                Annuler la correction
              </button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}
