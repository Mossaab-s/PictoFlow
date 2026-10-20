"use client";
import { useEffect, useId, useRef, useState } from "react";
import { movedMessage } from "@/lib/message-order";
import { TouchContent } from "./pictogram";
import type { TouchRemoval, Word } from "./message-touch-editor";

export type TouchMove = TouchRemoval & { words: Word[] };

export default function MessageMoveDialog({
  choice,
  disabled,
  busy,
  cancel,
  confirm,
}: {
  choice: TouchMove;
  disabled: boolean;
  busy: boolean;
  cancel: () => void;
  confirm: (destination: number) => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const placeId = useId();
  const titleId = useId();
  const helpId = useId();
  const [destination, setDestination] = useState(choice.index);
  const ids = movedMessage(choice.blockIds, choice.index, destination);
  const preview = movedMessage(choice.words, choice.index, destination);
  const changed = !!ids?.some((id, index) => id !== choice.blockIds[index]);
  useEffect(() => {
    const dialog = modal.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={modal}
      className="message-reset-dialog message-move-dialog"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2 id={titleId}>Changer l’ordre du message</h2>
      <p id={helpId}>
        Touche {choice.index + 1} sur {choice.words.length} :{" "}
        <strong>{choice.words[choice.index]?.label}</strong>. Choisissez sa
        nouvelle place, puis vérifiez l’ordre proposé.
      </p>
      <label htmlFor={placeId}>Nouvelle place</label>
      <select
        id={placeId}
        value={destination}
        disabled={disabled}
        onChange={(event) => setDestination(Number(event.target.value))}
      >
        {choice.words.map((_, index) => (
          <option key={index} value={index}>
            Place {index + 1} sur {choice.words.length}
          </option>
        ))}
      </select>
      <div className="message-move-steps">
        <button
          type="button"
          className="secondary"
          disabled={disabled || destination <= 0}
          onClick={() => setDestination(destination - 1)}
        >
          ← Une place avant
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled || destination >= choice.words.length - 1}
          onClick={() => setDestination(destination + 1)}
        >
          Une place après →
        </button>
      </div>
      <h3>Ordre proposé</h3>
      <ol
        className="message-order-preview"
        aria-label="Ordre proposé"
        tabIndex={0}
      >
        {preview?.map((word, index) => (
          <li
            className="message-order-touch"
            key={index}
            aria-current={index === destination ? "step" : undefined}
          >
            <TouchContent
              label={word.label}
              representation={word.representation}
            />
            <small>
              Place {index + 1}
              {index === destination ? " · déplacée" : ""}
            </small>
          </li>
        ))}
      </ol>
      <p role="status">
        {busy
          ? "Déplacement en cours…"
          : changed
            ? `La touche passera de la place ${choice.index + 1} à la place ${destination + 1}.`
            : "L’ordre reste inchangé."}
      </p>
      <div className="actions">
        <button type="button" autoFocus disabled={busy} onClick={cancel}>
          Garder l’ordre actuel
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled || !changed}
          onClick={() => confirm(destination)}
        >
          Confirmer cet ordre
        </button>
      </div>
    </dialog>
  );
}
