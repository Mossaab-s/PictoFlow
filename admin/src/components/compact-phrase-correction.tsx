"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Interpretation } from "@/lib/keyboard";
import type { Word } from "./message-touch-editor";
import { TouchContent } from "./pictogram";

export default function CompactPhraseCorrection({
  candidate,
  current,
  words,
  disabled,
  busy,
  cancel,
  save,
}: {
  candidate: Interpretation;
  current: Interpretation | undefined;
  words: Word[];
  disabled: boolean;
  busy: boolean;
  cancel: () => void;
  save: (text: string) => Promise<boolean>;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState(candidate.corrected_text ?? candidate.text);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const locked = busy || pending;
  const available = current?.status === "proposed";
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (reviewing) keep.current?.focus();
    else input.current?.focus();
  }, [reviewing]);
  function close() {
    if (busy || sending.current) return;
    dialog.current?.close();
    cancel();
  }
  async function submit() {
    if (disabled || locked || sending.current || !available || !text.trim())
      return;
    sending.current = true;
    setPending(true);
    setError("");
    try {
      if (await save(text.trim())) {
        dialog.current?.close();
        cancel();
      } else {
        setError(
          "L’enregistrement n’a pas été confirmé. Votre texte reste ici. Vérifiez le résultat actuel avant de réessayer.",
        );
      }
    } catch {
      setError(
        "L’enregistrement n’a pas été confirmé. Votre texte reste ici. Vérifiez le résultat actuel avant de réessayer.",
      );
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="message-reset-dialog compact-phrase-correction"
      aria-labelledby={`${id}-title`}
      aria-busy={locked}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id={`${id}-title`}>Changer la phrase</h2>
      <ol className="message-order-preview" aria-label="Pictos du message">
        {words.map((word, index) => (
          <li key={index} className="message-order-touch">
            <small>{index + 1}</small>
            <TouchContent
              label={word.label}
              representation={word.representation}
            />
          </li>
        ))}
      </ol>
      <h3>Phrase proposée</h3>
      <p className="correction-original">{candidate.text}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (reviewing) void submit();
          else if (!locked && text.trim()) setReviewing(true);
        }}
      >
        <label>
          {reviewing ? "Mon texte à enregistrer" : "Je corrige la phrase"}
          <textarea
            ref={input}
            required
            maxLength={4000}
            rows={4}
            value={reviewing ? text.trim() : text}
            readOnly={reviewing}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {reviewing && (
          <p>
            Seul « Enregistrer mon sens » ajoutera ce texte à la mémoire de ce
            profil. Les pictos restent identiques.
          </p>
        )}
        {!available && (
          <p role="status">
            Cette proposition a déjà été traitée ou n’est plus disponible. Le
            résultat actuel est affiché dans le message. Aucun nouvel
            enregistrement ici.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {locked && <p role="status">Enregistrement en cours…</p>}
        <div className="actions correction-actions">
          <button ref={keep} type="button" disabled={locked} onClick={close}>
            Garder le message actuel
          </button>
          {reviewing ? (
            <>
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() => setReviewing(false)}
              >
                Modifier mon texte
              </button>
              <button
                disabled={disabled || locked || !available || !text.trim()}
              >
                Enregistrer mon sens
              </button>
            </>
          ) : (
            <button disabled={locked || !text.trim()}>
              Vérifier ma correction
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
