"use client";
import { useEffect, useRef } from "react";

export default function MessageResetDialog({
  action,
  cancel,
  confirm,
}: {
  action: "clear" | "new" | null;
  cancel: () => void;
  confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action && !dialog.current?.open) dialog.current?.showModal();
    if (!action && dialog.current?.open) dialog.current.close();
  }, [action]);
  return (
    <dialog
      ref={dialog}
      className="message-reset-dialog"
      aria-labelledby="reset-message-title"
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      <h2 id="reset-message-title">
        {action === "clear"
          ? "Effacer les mots de ce message ?"
          : "Commencer un autre message ?"}
      </h2>
      <p>Vous pouvez garder votre message et continuer à le préparer.</p>
      <div className="actions">
        <button autoFocus onClick={cancel}>
          Garder mon message
        </button>
        <button className="secondary" onClick={confirm}>
          {action === "clear"
            ? "Oui, effacer les mots"
            : "Oui, commencer un autre message"}
        </button>
      </div>
    </dialog>
  );
}
