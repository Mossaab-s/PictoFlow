"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { KeyboardGroup, Tile } from "@/lib/keyboard";
import type { DisplaySize } from "@/lib/display";
import { availableCommunicationTouches } from "@/lib/communication-search";
import { touchLocation } from "@/lib/keyboard-organization";
import { insertedMessage } from "@/lib/message-insertion";
import KeyboardGrid from "./keyboard-grid";
import CommunicationTouchSearch from "./communication-touch-search";
import { TouchContent } from "./pictogram";
import type { TouchRemoval, Word } from "./message-touch-editor";

export type TouchInsertion = TouchRemoval & { words: Word[] };

export default function MessageInsertDialog({
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
  choice: TouchInsertion;
  profileId: string;
  tiles: Tile[];
  groups: KeyboardGroup[];
  displaySize: DisplaySize;
  disabled: boolean;
  busy: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  cancel: () => void;
  confirm: (tile: Tile, index: number) => void;
}) {
  const title = useId();
  const help = useId();
  const positionId = useId();
  const keep = useRef<HTMLButtonElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const orderPreview = useRef<HTMLOListElement>(null);
  const previousChoice = useRef<HTMLButtonElement | null>(null);
  const transitionOrigin = useRef<Element | null>(null);
  const [review, setReview] = useState(false);
  const [after, setAfter] = useState(false);
  const [candidate, setCandidate] = useState<Tile | null>(null);
  const available = availableCommunicationTouches(profileId, tiles, groups);
  const chosen = available.find(
    (tile) => tile.block_id === candidate?.block_id,
  );
  const index = choice.index + (after ? 1 : 0);
  const preview = chosen
    ? insertedMessage(
        choice.words,
        {
          label: chosen.block.label,
          representation: chosen.representation,
        },
        index,
      )
    : null;
  const anchor = choice.words[choice.index];
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
  useEffect(() => {
    if (!review) return;
    const list = orderPreview.current;
    const added = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !added) return;
    const viewport = list.getBoundingClientRect();
    const item = added.getBoundingClientRect();
    if (item.bottom > viewport.bottom)
      list.scrollTop += item.bottom - viewport.bottom;
    else if (item.top < viewport.top) list.scrollTop += item.top - viewport.top;
  }, [index, review]);
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
      className="message-reset-dialog message-replace-dialog message-insert-dialog"
      aria-labelledby={title}
      aria-describedby={help}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2 id={title}>Insérer une touche</h2>
      <p id={help}>
        Touche repère {choice.index + 1} sur {choice.words.length} :{" "}
        <strong>{anchor?.label}</strong>.
      </p>
      <div hidden={review}>
        <button ref={keep} type="button" disabled={busy} onClick={cancel}>
          Garder le message actuel
        </button>
        <p>
          Choisissez une touche dans votre clavier, puis vérifiez où l’ajouter.
        </p>
        <div
          className="replacement-keyboard"
          role="region"
          aria-label="Clavier d’insertion"
        >
          <CommunicationTouchSearch
            profileId={profileId}
            tiles={available}
            groups={groups}
            displaySize={displaySize}
            disabled={disabled || review}
            purpose="insert"
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
          Vérifier l’ajout
        </h3>
        {chosen && (
          <div className="insertion-choice">
            <TouchContent
              label={chosen.block.label}
              representation={chosen.representation}
            />
            <small>
              {touchLocation(profileId, chosen.block_id, [chosen], groups)}
            </small>
          </div>
        )}
        <label htmlFor={positionId}>Ajouter la touche</label>
        <select
          id={positionId}
          value={after ? "after" : "before"}
          disabled={disabled}
          onChange={(event) => setAfter(event.target.value === "after")}
        >
          <option value="before">
            Avant « {anchor?.label} », touche {choice.index + 1}
          </option>
          <option value="after">
            Après « {anchor?.label} », touche {choice.index + 1}
          </option>
        </select>
        <h3>Message proposé</h3>
        <ol
          ref={orderPreview}
          className="message-order-preview"
          aria-label="Message proposé"
          tabIndex={0}
        >
          {preview?.map((word, position) => (
            <li
              key={position}
              className="message-order-touch"
              aria-current={position === index ? "step" : undefined}
            >
              <TouchContent
                label={word.label}
                representation={word.representation}
              />
              <small>
                Place {position + 1}
                {position === index ? " · ajoutée" : ""}
              </small>
            </li>
          ))}
        </ol>
        <p role="status">
          {busy
            ? "Ajout en cours…"
            : preview
              ? `La nouvelle touche sera à la place ${index + 1} sur ${preview.length}. Les autres gardent leur ordre.`
              : "Cette touche n’est plus disponible."}
        </p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={cancel}>
            Garder le message actuel
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled || !preview}
            onClick={() => {
              if (chosen && preview) confirm(chosen, index);
            }}
          >
            Confirmer l’ajout
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
