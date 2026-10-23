"use client";
import { useEffect, useId, useRef, type RefObject } from "react";
import type { Block, Representation } from "@/lib/keyboard";
import PhraseLibrary from "./phrase-library";

export default function CompactPhraseLibrary({
  profileId,
  blocks,
  visuals,
  open,
  onOpenChange,
  disabled,
  online,
  speech,
  heading,
}: {
  profileId: string;
  blocks: Block[];
  visuals: Representation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  online: boolean;
  speech: {
    available: boolean;
    speaking: boolean;
    error: string;
    read: (text: string) => void;
    stop: () => void;
  };
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      title.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => {
          speech.stop();
          onOpenChange(true);
        }}
      >
        Mes phrases
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="message-reset-dialog compact-phrase-library"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-help`}
        onCancel={(event) => {
          event.preventDefault();
          if (speech.speaking) speech.stop();
          else onOpenChange(false);
        }}
        onClose={() => {
          speech.stop();
          onOpenChange(false);
          requestAnimationFrame(() => {
            if (trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus({ preventScroll: true });
            else heading.current?.focus({ preventScroll: true });
          });
        }}
      >
        <div className="compact-library-controls">
          <h2 ref={title} id={`${id}-title`} tabIndex={-1}>
            Mes phrases
          </h2>
          <div className="actions">
            <button onClick={() => onOpenChange(false)}>
              Revenir au message
            </button>
            {speech.speaking && (
              <button className="secondary" onClick={speech.stop}>
                Arrêter la lecture
              </button>
            )}
          </div>
        </div>
        <p id={`${id}-help`}>
          Retrouvez une phrase déjà acceptée, puis choisissez de la lire. Vos
          pictos en cours sont conservés.
        </p>
        {open &&
          (online ? (
            <PhraseLibrary
              key={profileId}
              profileId={profileId}
              blocks={blocks}
              visuals={visuals}
              speech={speech}
              disabled={disabled}
              revision={null}
              allowShortcutChanges={false}
              pickerInitiallyOpen
            />
          ) : (
            <p role="status">
              Les phrases acceptées demandent une connexion pour vérifier leur
              texte actuel. Revenez au message pour parler avec vos pictos.
            </p>
          ))}
        {speech.error && <p role="alert">{speech.error}</p>}
      </dialog>
    </>
  );
}
