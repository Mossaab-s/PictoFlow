"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
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
  dialogRef,
}: {
  choice: TouchMove;
  disabled: boolean;
  busy: boolean;
  cancel: () => void;
  confirm: (destination: number) => void;
  dialogRef: RefObject<HTMLDialogElement | null>;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  const orderPreview = useRef<HTMLOListElement>(null);
  const before = useRef<HTMLButtonElement>(null);
  const after = useRef<HTMLButtonElement>(null);
  const placeId = useId();
  const titleId = useId();
  const helpId = useId();
  const [destination, setDestination] = useState(choice.index);
  const ids = movedMessage(choice.blockIds, choice.index, destination);
  const preview = movedMessage(choice.words, choice.index, destination);
  const changed = !!ids?.some((id, index) => id !== choice.blockIds[index]);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    keep.current?.focus();
    return () => dialog?.close();
  }, [dialogRef]);
  useEffect(() => {
    const list = orderPreview.current;
    const chosen = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !chosen) return;
    const viewport = list.getBoundingClientRect();
    const item = chosen.getBoundingClientRect();
    // Follow the chosen occurrence inside the preview without scrolling the page or moving focus.
    if (item.bottom > viewport.bottom)
      list.scrollTop += item.bottom - viewport.bottom;
    else if (item.top < viewport.top) list.scrollTop += item.top - viewport.top;
  }, [destination]);
  function step(target: number, origin: HTMLButtonElement) {
    setDestination(target);
    if (target !== 0 && target !== choice.words.length - 1) return;
    requestAnimationFrame(() => {
      if (
        document.activeElement !== origin &&
        document.activeElement !== document.body
      )
        return;
      const next = target === 0 ? after.current : before.current;
      if (next?.isConnected && !next.disabled) next.focus();
    });
  }
  return (
    <dialog
      ref={dialogRef}
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
          ref={before}
          type="button"
          className="secondary"
          disabled={disabled || destination <= 0}
          onClick={(event) => step(destination - 1, event.currentTarget)}
        >
          ← Une place avant
        </button>
        <button
          ref={after}
          type="button"
          className="secondary"
          disabled={disabled || destination >= choice.words.length - 1}
          onClick={(event) => step(destination + 1, event.currentTarget)}
        >
          Une place après →
        </button>
      </div>
      <h3>Ordre proposé</h3>
      <ol
        ref={orderPreview}
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
              {index === destination ? " · choisie" : ""}
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
        <button
          ref={keep}
          type="button"
          autoFocus
          disabled={busy}
          onClick={cancel}
        >
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
