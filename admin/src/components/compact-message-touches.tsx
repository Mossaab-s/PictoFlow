"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { KeyboardGroup, Sequence, Tile } from "@/lib/keyboard";
import type { DisplaySize } from "@/lib/display";
import type { TouchRemoval, Word } from "./message-touch-editor";
import MessageReplaceDialog, {
  type TouchReplacement,
} from "./message-replace-dialog";
import MessageMoveDialog from "./message-move-dialog";
import { TouchContent } from "./pictogram";

export default function CompactMessageTouches({
  profileId,
  sequence,
  words,
  tiles,
  groups,
  displaySize,
  disabled,
  busy,
  heading,
  stop,
  remove,
  replace,
  move,
  onEditingChange,
}: {
  profileId: string;
  sequence: Sequence | null;
  words: Word[];
  tiles: Tile[];
  groups: KeyboardGroup[];
  displaySize: DisplaySize;
  disabled: boolean;
  busy: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  stop: () => void;
  remove: (choice: TouchRemoval) => Promise<void>;
  replace: (choice: TouchRemoval & { blockId: string }) => Promise<void>;
  move: (choice: TouchRemoval & { targetIndex: number }) => Promise<void>;
  onEditingChange: (editing: boolean) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<
    (TouchReplacement & { words: Word[] }) | null
  >(null);
  const [operation, setOperation] = useState<"replace" | "move" | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const replacementDialog = useRef<HTMLDialogElement>(null);
  const moveDialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const returnFocus = useRef<{ index: number; origin: Element | null } | null>(
    null,
  );
  useEffect(() => () => onEditingChange(false), [onEditingChange]);
  useEffect(() => {
    if (choice && !operation) {
      dialog.current?.showModal();
      keep.current?.focus();
    }
  }, [choice, operation]);
  useEffect(() => {
    if (busy || choice || !returnFocus.current) return;
    const requested = returnFocus.current;
    returnFocus.current = null;
    const frame = requestAnimationFrame(() => {
      if (!strip.current?.isConnected) return;
      if (
        document.activeElement !== requested.origin &&
        document.activeElement !== document.body
      )
        return;
      const buttons =
        strip.current.querySelectorAll<HTMLButtonElement>("button");
      const target = buttons[Math.min(requested.index, buttons.length - 1)];
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else heading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, choice, heading]);
  function finish(index: number) {
    dialog.current?.close();
    replacementDialog.current?.close();
    moveDialog.current?.close();
    returnFocus.current = {
      index,
      origin: document.activeElement,
    };
    setChoice(null);
    setOperation(null);
    onEditingChange(false);
  }
  function close() {
    if (sending.current || busy) return;
    finish(choice?.index ?? 0);
  }
  async function submit(
    action:
      | { kind: "remove" }
      | { kind: "replace"; tile: Tile }
      | { kind: "move"; targetIndex: number },
  ) {
    if (!choice || disabled || sending.current) return;
    sending.current = true;
    try {
      if (action.kind === "move")
        await move({ ...choice, targetIndex: action.targetIndex });
      else if (action.kind === "replace")
        await replace({ ...choice, blockId: action.tile.block_id });
      else await remove(choice);
    } finally {
      sending.current = false;
      // Parent reconciliation settles first; never retry an uncertain edit here.
      finish(action.kind === "move" ? action.targetIndex : choice.index);
    }
  }
  return (
    <>
      <div
        ref={strip}
        className="compact-word-strip"
        tabIndex={words.length ? 0 : undefined}
        aria-label="Pictos de mon message"
      >
        {words.length ? (
          words.map((word, index) => (
            <button
              key={index}
              className="compact-word secondary"
              disabled={disabled}
              aria-haspopup="dialog"
              aria-label={`Modifier « ${word.label} », touche ${index + 1} sur ${words.length}`}
              onClick={() => {
                if (!sequence) return;
                stop();
                onEditingChange(true);
                setOperation(null);
                setChoice({
                  sequenceId: sequence.id,
                  blockIds: [...sequence.block_ids],
                  index,
                  word,
                  words: [...words],
                });
              }}
            >
              <TouchContent
                label={word.label}
                representation={word.representation}
              />
            </button>
          ))
        ) : (
          <p>Choisissez vos pictos.</p>
        )}
      </div>
      {choice && !operation && (
        <dialog
          ref={dialog}
          className="message-reset-dialog compact-touch-choice"
          aria-labelledby={`${id}-title`}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <h2 id={`${id}-title`}>Modifier cette touche</h2>
          <TouchContent
            label={choice.word.label}
            representation={choice.word.representation}
          />
          <p>
            Touche {choice.index + 1} sur {choice.blockIds.length}. Les autres
            pictos seront conservés.
          </p>
          <div className="actions">
            <button ref={keep} disabled={busy} onClick={close}>
              Garder cette touche
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => {
                dialog.current?.close();
                setOperation("replace");
              }}
            >
              Remplacer cette touche
            </button>
            <button
              className="secondary"
              disabled={disabled || choice.blockIds.length < 2}
              onClick={() => {
                dialog.current?.close();
                setOperation("move");
              }}
            >
              Déplacer cette touche
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void submit({ kind: "remove" })}
            >
              Retirer cette touche
            </button>
          </div>
        </dialog>
      )}
      {choice && operation === "replace" && (
        <MessageReplaceDialog
          choice={choice}
          profileId={profileId}
          tiles={tiles}
          groups={groups}
          displaySize={displaySize}
          disabled={disabled}
          busy={busy}
          dialogRef={replacementDialog}
          cancel={close}
          confirm={(tile) => void submit({ kind: "replace", tile })}
        />
      )}
      {choice && operation === "move" && (
        <MessageMoveDialog
          choice={choice}
          disabled={disabled}
          busy={busy}
          dialogRef={moveDialog}
          cancel={close}
          confirm={(targetIndex) => void submit({ kind: "move", targetIndex })}
        />
      )}
    </>
  );
}
