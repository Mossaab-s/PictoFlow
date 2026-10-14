"use client";
import { useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import type { HumanRole, Interpretation } from "@/lib/keyboard";
import { shortcutChoice } from "@/lib/phrases";

export function phraseError(error: unknown): string {
  return error instanceof APIError &&
    (error.status === 404 || error.status === 409)
    ? "Ce message ou son raccourci a changé. Actualisez vos phrases avant de réessayer."
    : error instanceof Error
      ? error.message
      : "Phrase indisponible.";
}

export default function PhraseShortcut({
  profileId,
  item,
  role,
  disabled = false,
  onChange,
}: {
  profileId: string;
  item: Interpretation;
  role: HumanRole;
  disabled?: boolean;
  onChange: (item: Interpretation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gate = useRef(false);
  const body = shortcutChoice(item, !item.shortcut);
  if (item.profile_id !== profileId || !body) return null;
  async function choose() {
    if (gate.current || !body) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<Interpretation>(
        `profiles/${profileId}/phrases/${item.id}/shortcut`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...body, actor_role: role }),
        },
      );
      if (result.profile_id !== profileId || result.id !== item.id)
        throw new Error("Message indisponible.");
      onChange(result);
    } catch (error) {
      setError(phraseError(error));
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="phrase-shortcut">
      <button
        className="secondary"
        aria-pressed={item.shortcut === true}
        disabled={disabled || busy}
        onClick={() => void choose()}
      >
        {busy
          ? "Enregistrement…"
          : item.shortcut
            ? "Retirer des raccourcis"
            : "Ajouter à mes raccourcis"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
