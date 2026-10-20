"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { KeyboardGroup, Tile } from "@/lib/keyboard";
import type { DisplaySize } from "@/lib/display";
import { availableCommunicationTouches } from "@/lib/communication-search";
import { touchLocation } from "@/lib/keyboard-organization";
import KeyboardGrid from "./keyboard-grid";
import CommunicationTouchSearch from "./communication-touch-search";
import { TouchContent } from "./pictogram";
import type { TouchRemoval, Word } from "./message-touch-editor";

export type TouchReplacement = TouchRemoval & { word: Word };

export default function MessageReplaceDialog({
  choice,
  profileId,
  tiles,
  groups,
  displaySize,
  disabled,
  busy,
  dialogRef,
  cancel,
  confirm,
}: {
  choice: TouchReplacement;
  profileId: string;
  tiles: Tile[];
  groups: KeyboardGroup[];
  displaySize: DisplaySize;
  disabled: boolean;
  busy: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  cancel: () => void;
  confirm: (tile: Tile) => void;
}) {
  const title = useId();
  const help = useId();
  const keep = useRef<HTMLButtonElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const previousChoice = useRef<HTMLButtonElement | null>(null);
  const transitionOrigin = useRef<Element | null>(null);
  const [review, setReview] = useState(false);
  const [candidate, setCandidate] = useState<Tile | null>(null);
  const available = availableCommunicationTouches(profileId, tiles, groups);
  const chosen = available.find(
    (tile) => tile.block_id === candidate?.block_id,
  );
  const changed = !!chosen && chosen.block_id !== choice.blockIds[choice.index];
  useEffect(() => {
    const modal = dialogRef.current;
    modal?.showModal();
    keep.current?.focus();
    return () => modal?.close();
  }, [dialogRef]);
  useEffect(() => {
    if (!transitionOrigin.current) return;
    const origin = transitionOrigin.current;
    transitionOrigin.current = null;
    if (
      document.activeElement !== origin &&
      document.activeElement !== document.body
    )
      return;
    if (review) reviewHeading.current?.focus();
    else if (
      previousChoice.current?.isConnected &&
      !previousChoice.current.disabled
    )
      previousChoice.current.focus();
    else keep.current?.focus();
  }, [review]);
  function choose(tile: Tile) {
    if (disabled || review) return;
    previousChoice.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    transitionOrigin.current = document.activeElement;
    setCandidate(tile);
    setReview(true);
  }
  return (
    <dialog
      ref={dialogRef}
      className="message-reset-dialog message-replace-dialog"
      aria-labelledby={title}
      aria-describedby={help}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2 id={title}>Remplacer une touche</h2>
      <p id={help}>
        Touche {choice.index + 1} sur {choice.blockIds.length} :{" "}
        <strong>{choice.word.label}</strong>.
      </p>
      <div hidden={review}>
        <button ref={keep} type="button" disabled={busy} onClick={cancel}>
          Garder la touche actuelle
        </button>
        <p>
          Choisissez une nouvelle touche dans votre clavier. Vous la vérifierez
          avant de confirmer.
        </p>
        <div
          className="replacement-keyboard"
          role="region"
          aria-label="Clavier de remplacement"
        >
          <CommunicationTouchSearch
            profileId={profileId}
            tiles={available}
            groups={groups}
            displaySize={displaySize}
            disabled={disabled || review}
            purpose="replace"
            onSelect={choose}
          />
          <KeyboardGrid
            profileId={profileId}
            tiles={available}
            groups={groups}
            displaySize={displaySize}
            disabled={disabled || review}
            onSelect={choose}
          />
          {!available.length && <p>Aucune touche disponible pour ce profil.</p>}
        </div>
      </div>
      <div hidden={!review}>
        <h3 ref={reviewHeading} tabIndex={-1}>
          Vérifier le remplacement
        </h3>
        <div className="replacement-comparison">
          <figure>
            <figcaption>Avant</figcaption>
            <TouchContent
              label={choice.word.label}
              representation={choice.word.representation}
            />
          </figure>
          <figure>
            <figcaption>Après</figcaption>
            {chosen ? (
              <>
                <TouchContent
                  label={chosen.block.label}
                  representation={chosen.representation}
                />
                <small>
                  {touchLocation(profileId, chosen.block_id, [chosen], groups)}
                </small>
              </>
            ) : (
              <p>Touche indisponible</p>
            )}
          </figure>
        </div>
        <p role="status">
          {busy
            ? "Remplacement en cours…"
            : changed
              ? "Les autres touches garderont leur place."
              : "Cette touche est déjà à cette place."}
        </p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={cancel}>
            Garder la touche actuelle
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled || !changed}
            onClick={() => {
              if (chosen) confirm(chosen);
            }}
          >
            Confirmer le remplacement
          </button>
        </div>
        <button
          type="button"
          className="secondary replacement-another"
          disabled={disabled}
          onClick={() => {
            transitionOrigin.current = document.activeElement;
            setReview(false);
          }}
        >
          Choisir une autre touche
        </button>
      </div>
    </dialog>
  );
}
