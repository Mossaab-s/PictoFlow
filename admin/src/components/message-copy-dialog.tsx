"use client";
import { useEffect, useId, useRef, type RefObject } from "react";
import type { Sequence } from "@/lib/keyboard";
import type { CopyAttempt } from "@/lib/message-copy";
import type { Word } from "./message-touch-editor";
import { TouchContent } from "./pictogram";

export type MessageCopyChoice = {
  source: Sequence;
  words: Word[];
  attempt: CopyAttempt;
};

export default function MessageCopyDialog({
  choice,
  disabled,
  busy,
  dialogRef,
  cancel,
  confirm,
}: {
  choice: MessageCopyChoice;
  disabled: boolean;
  busy: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  cancel: () => void;
  confirm: () => void;
}) {
  const title = useId();
  const help = useId();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const modal = dialogRef.current;
    modal?.showModal();
    keep.current?.focus();
    return () => modal?.close();
  }, [dialogRef]);
  return (
    <dialog
      ref={dialogRef}
      className="message-reset-dialog message-copy-dialog"
      aria-labelledby={title}
      aria-describedby={help}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2 id={title}>Modifier une copie</h2>
      <p id={help}>
        Ces pictos formeront un nouveau brouillon. Le message d’origine et ses
        validations restent conservés.
      </p>
      <ol
        className="message-order-preview"
        aria-label="Pictos de la copie"
        tabIndex={0}
      >
        {choice.words.map((word, index) => (
          <li key={index} className="message-order-touch">
            <TouchContent
              label={word.label}
              representation={word.representation}
            />
            <small>Place {index + 1}</small>
          </li>
        ))}
      </ol>
      <p>
        Seuls les pictos sont repris. Vous pourrez les modifier, terminer ce
        nouveau message et choisir à nouveau ce qu’il veut dire.
      </p>
      <p role="status">
        {busy
          ? "Création de la copie…"
          : `${choice.words.length} touche${choice.words.length > 1 ? "s" : ""} à reprendre dans le même ordre.`}
      </p>
      <div className="actions">
        <button ref={keep} type="button" disabled={busy} onClick={cancel}>
          Garder mon message
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={confirm}
        >
          Créer la copie modifiable
        </button>
      </div>
    </dialog>
  );
}
