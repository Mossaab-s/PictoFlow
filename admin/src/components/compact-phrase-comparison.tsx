"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { Interpretation } from "@/lib/keyboard";

export default function CompactPhraseComparison({
  candidates,
  inspected,
  disabled,
  accepted,
  speech,
  heading,
  inspect,
}: {
  candidates: Interpretation[];
  inspected: Interpretation;
  disabled: boolean;
  accepted: boolean;
  speech: {
    available: boolean;
    speaking: boolean;
    error: string;
    read: (text: string) => void;
    stop: () => void;
  };
  heading: RefObject<HTMLHeadingElement | null>;
  inspect: (id: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const revision = candidates
    .map((item) => `${item.id}:${item.status}`)
    .join("|");
  useEffect(() => {
    // New proposals or changed feedback must be inspected in their current state.
    setOpen(false);
  }, [revision]);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      dialog.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    } else dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="secondary compact-compare-trigger"
        aria-label={`Comparer les ${candidates.length} phrases`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled || accepted}
        onClick={() => {
          speech.stop();
          setOpen(true);
        }}
      >
        Comparer ({candidates.length})
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="message-reset-dialog compact-phrase-comparison"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-help`}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => {
          speech.stop();
          setOpen(false);
          requestAnimationFrame(() => {
            if (trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus({ preventScroll: true });
            else heading.current?.focus({ preventScroll: true });
          });
        }}
      >
        <h2 id={`${id}-title`}>Plusieurs sens sont possibles</h2>
        <p id={`${id}-help`}>
          Comparez les phrases. Choisir ou écouter une phrase ne la valide pas.
        </p>
        <fieldset
          className="hypothesis-choices"
          disabled={disabled || accepted}
        >
          <legend>Quelle phrase voulez-vous vérifier ?</legend>
          {candidates.map((item, index) => (
            <label key={item.id} className="hypothesis-choice">
              <input
                type="radio"
                name={id}
                value={item.id}
                checked={inspected.id === item.id}
                onChange={() => {
                  speech.stop();
                  inspect(item.id);
                }}
              />
              <span>
                <span className="helper">Phrase {index + 1}</span>
                <strong>{item.corrected_text ?? item.text}</strong>
                {item.status === "rejected" && (
                  <span className="helper">Proposition écartée</span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="actions compact-comparison-actions">
          <button onClick={() => setOpen(false)}>Revenir au message</button>
          <button
            className="secondary"
            disabled={!speech.available}
            onClick={() =>
              speech.read(inspected.corrected_text ?? inspected.text)
            }
          >
            Écouter cette phrase
          </button>
          {speech.speaking && (
            <button className="secondary" onClick={speech.stop}>
              Arrêter la lecture
            </button>
          )}
        </div>
        {speech.error && <p role="alert">{speech.error}</p>}
      </dialog>
    </>
  );
}
