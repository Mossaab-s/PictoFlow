"use client";
import { useEffect, useRef, useState } from "react";
import type {
  Representation,
  Sequence,
  Tile,
  KeyboardGroup,
} from "@/lib/keyboard";
import type { DisplaySize } from "@/lib/display";
import { TouchContent } from "./pictogram";
import MessageMoveDialog, { type TouchMove } from "./message-move-dialog";
import MessageReplaceDialog, {
  type TouchReplacement,
} from "./message-replace-dialog";

export type Word = { label: string; representation?: Representation };
export type TouchRemoval = {
  sequenceId: string;
  blockIds: string[];
  index: number;
};

export default function MessageTouchEditor({
  sequence,
  words,
  disabled,
  busy,
  remove,
  move,
  replace,
  profileId,
  tiles,
  groups,
  displaySize,
}: {
  sequence: Sequence | null;
  words: Word[];
  disabled: boolean;
  busy: boolean;
  remove: (choice: TouchRemoval) => Promise<void>;
  move: (choice: TouchRemoval & { targetIndex: number }) => Promise<void>;
  replace: (choice: TouchRemoval & { blockId: string }) => Promise<void>;
  profileId: string;
  tiles: Tile[];
  groups: KeyboardGroup[];
  displaySize: DisplaySize;
}) {
  const [editing, setEditing] = useState(false);
  const [operation, setOperation] = useState<"remove" | "move" | "replace">(
    "remove",
  );
  const [replacement, setReplacement] = useState<TouchReplacement | null>(null);
  const [moveChoice, setMoveChoice] = useState<TouchMove | null>(null);
  const [choice, setChoice] = useState<(TouchRemoval & { word: Word }) | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const tokens = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const moveDialog = useRef<HTMLDialogElement>(null);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  const returnFocus = useRef<{ index: number; origin: Element | null } | null>(
    null,
  );
  const canEdit = sequence?.status === "in_progress" && words.length > 0;
  const active = editing && canEdit;
  const moving = active && operation === "move" && words.length > 1;
  const replacing = active && operation === "replace";
  const verb = replacing ? "Remplacer" : moving ? "Déplacer" : "Retirer";

  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);
  useEffect(() => {
    if (words.length < 2 && operation === "move") setOperation("remove");
  }, [words.length, operation]);
  useEffect(() => {
    if (choice && !dialog.current?.open) dialog.current?.showModal();
    if (!choice && dialog.current?.open) dialog.current.close();
  }, [choice]);
  useEffect(() => {
    if (busy || choice || moveChoice || replacement || !returnFocus.current)
      return;
    const requested = returnFocus.current;
    returnFocus.current = null;
    focusOccurrence(requested.index, requested.origin);
  }, [busy, choice, moveChoice, replacement]);

  function closeAndReturn(modal: HTMLDialogElement | null, index: number) {
    modal?.close();
    returnFocus.current = { index, origin: document.activeElement };
  }

  function focusOccurrence(index: number, origin = document.activeElement) {
    requestAnimationFrame(() => {
      if (!root.current?.isConnected) return;
      if (
        document.activeElement !== origin &&
        document.activeElement !== document.body
      )
        return;
      const buttons =
        tokens.current?.querySelectorAll<HTMLButtonElement>("button");
      const target = buttons?.[Math.min(index, buttons.length - 1)];
      if (target && !target.disabled) target.focus();
      else if (toggle.current && !toggle.current.disabled)
        toggle.current.focus();
      else tokens.current?.focus();
    });
  }
  function focusToggle(origin = document.activeElement) {
    requestAnimationFrame(() => {
      if (
        !root.current?.isConnected ||
        !toggle.current ||
        toggle.current.disabled
      )
        return;
      if (
        document.activeElement === origin ||
        document.activeElement === document.body
      )
        toggle.current.focus();
    });
  }
  function cancel() {
    if (sending.current) return;
    const index = choice?.index ?? 0;
    closeAndReturn(dialog.current, index);
    setChoice(null);
  }
  async function confirm() {
    if (!choice || disabled || sending.current) return;
    sending.current = true;
    const selected = choice;
    try {
      await remove(selected);
    } finally {
      sending.current = false;
      // Closing does not retry an uncertain request. The parent has already reread the draft.
      closeAndReturn(dialog.current, selected.index);
      setChoice(null);
    }
  }
  function cancelMove() {
    if (sending.current) return;
    const index = moveChoice?.index ?? 0;
    closeAndReturn(moveDialog.current, index);
    setMoveChoice(null);
  }
  async function confirmMove(targetIndex: number) {
    if (!moveChoice || disabled || sending.current) return;
    sending.current = true;
    try {
      await move({ ...moveChoice, targetIndex });
    } finally {
      sending.current = false;
      closeAndReturn(moveDialog.current, targetIndex);
      setMoveChoice(null);
    }
  }
  function cancelReplacement() {
    if (sending.current) return;
    closeAndReturn(replaceDialog.current, replacement?.index ?? 0);
    setReplacement(null);
  }
  async function confirmReplacement(tile: Tile) {
    if (!replacement || disabled || sending.current) return;
    sending.current = true;
    const selected = replacement;
    try {
      await replace({ ...selected, blockId: tile.block_id });
    } finally {
      sending.current = false;
      closeAndReturn(replaceDialog.current, selected.index);
      setReplacement(null);
    }
  }
  return (
    <div
      ref={root}
      className="message-touch-editor"
      data-editing={active}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          active &&
          !choice &&
          !moveChoice &&
          !replacement &&
          !busy
        ) {
          event.preventDefault();
          setEditing(false);
          focusToggle();
        }
      }}
    >
      {active && (
        <div
          className="message-edit-operations"
          role="group"
          aria-label="Type de correction"
        >
          <button
            type="button"
            className="secondary"
            aria-pressed={!moving && !replacing}
            disabled={disabled}
            onClick={() => {
              setOperation("remove");
              focusOccurrence(0);
            }}
          >
            Retirer une touche
          </button>
          <button
            type="button"
            className="secondary"
            aria-pressed={moving}
            disabled={disabled || words.length < 2}
            onClick={() => {
              setOperation("move");
              focusOccurrence(0);
            }}
          >
            Déplacer une touche
          </button>
          <button
            type="button"
            className="secondary"
            aria-pressed={replacing}
            disabled={disabled}
            onClick={() => {
              setOperation("replace");
              focusOccurrence(0);
            }}
          >
            Remplacer une touche
          </button>
        </div>
      )}
      {active && (
        <p className="helper" id="message-edit-help">
          Choisissez la touche à {verb.toLowerCase()}, puis vérifiez votre
          choix.
        </p>
      )}
      <div
        ref={tokens}
        className="message-tokens"
        tabIndex={-1}
        role={active ? "group" : "status"}
        aria-label={active ? "Touches à corriger" : undefined}
        aria-describedby={active ? "message-edit-help" : undefined}
        aria-live={active ? undefined : "polite"}
        aria-atomic={active ? undefined : true}
      >
        {words.length ? (
          words.map((word, index) =>
            active ? (
              <button
                key={index}
                type="button"
                className="message-touch secondary"
                disabled={disabled}
                aria-label={`${verb} « ${word.label} », touche ${index + 1} sur ${words.length}`}
                onClick={() => {
                  if (!sequence) return;
                  const selected = {
                    sequenceId: sequence.id,
                    blockIds: [...sequence.block_ids],
                    index,
                    word,
                  };
                  if (replacing) setReplacement(selected);
                  else if (moving)
                    setMoveChoice({ ...selected, words: [...words] });
                  else setChoice(selected);
                }}
              >
                <TouchContent
                  label={word.label}
                  representation={word.representation}
                />
                <small>Touche {index + 1}</small>
              </button>
            ) : (
              <span className="message-touch" key={index}>
                <TouchContent
                  label={word.label}
                  representation={word.representation}
                />
              </span>
            ),
          )
        ) : (
          <p>Votre message apparaîtra ici.</p>
        )}
      </div>
      {canEdit && (
        <button
          ref={toggle}
          type="button"
          className="secondary message-edit-toggle"
          aria-pressed={active}
          disabled={busy || (!active && disabled)}
          onClick={() => {
            setEditing(!active);
            if (!active) {
              setOperation("remove");
              focusOccurrence(0);
            } else focusToggle();
          }}
        >
          {active ? "Finir la correction" : "Corriger une touche"}
        </button>
      )}
      <dialog
        ref={dialog}
        className="message-reset-dialog message-touch-dialog"
        aria-labelledby="remove-message-touch-title"
        aria-describedby="remove-message-touch-help"
        onCancel={(event) => {
          event.preventDefault();
          cancel();
        }}
      >
        <h2 id="remove-message-touch-title">
          Retirer cette touche du message ?
        </h2>
        {choice && (
          <>
            <div className="removal-touch">
              <TouchContent
                label={choice.word.label}
                representation={choice.word.representation}
              />
            </div>
            <p>
              Touche {choice.index + 1} sur {choice.blockIds.length}
            </p>
          </>
        )}
        <p id="remove-message-touch-help">
          Les autres touches garderont leur ordre.
        </p>
        {busy && <p role="status">Retrait en cours…</p>}
        <div className="actions">
          <button type="button" autoFocus disabled={busy} onClick={cancel}>
            Garder cette touche
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() => void confirm()}
          >
            Oui, retirer cette touche
          </button>
        </div>
      </dialog>
      {moveChoice && (
        <MessageMoveDialog
          dialogRef={moveDialog}
          choice={moveChoice}
          disabled={disabled}
          busy={busy}
          cancel={cancelMove}
          confirm={(index) => void confirmMove(index)}
        />
      )}
      {replacement && (
        <MessageReplaceDialog
          choice={replacement}
          dialogRef={replaceDialog}
          profileId={profileId}
          tiles={tiles}
          groups={groups}
          displaySize={displaySize}
          disabled={disabled}
          busy={busy}
          cancel={cancelReplacement}
          confirm={(tile) => void confirmReplacement(tile)}
        />
      )}
    </div>
  );
}
