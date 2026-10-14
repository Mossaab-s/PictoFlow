"use client";
import { useEffect, useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import {
  decisionLabels,
  evidenceItems,
  humanRoles,
  type Evidence,
  type EvidencePage,
  type EvidenceTarget,
} from "@/lib/memory";

export function memoryDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date non renseignée"
    : date.toLocaleString("fr-FR");
}
export default function MemoryEvidence({
  profileId,
  type,
  targetId,
}: {
  profileId: string;
  type: EvidenceTarget;
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Evidence[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gate = useRef(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function load(before: string | null = null) {
    if (gate.current) return;
    gate.current = true;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        target_type: type,
        target_id: targetId,
        limit: "20",
        ...(before ? { before } : {}),
      });
      const value = await api<EvidencePage>(
        `profiles/${profileId}/feedback?${query}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        const scoped = evidenceItems(profileId, type, targetId, value.items);
        setItems((previous) => [
          ...new Map(
            [...(before ? previous : []), ...scoped].map((item) => [
              item.id,
              item,
            ]),
          ).values(),
        ]);
        setCursor(value.next_cursor);
        setLoaded(true);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof APIError && error.status === 404
            ? "Cet élément n’est plus disponible. Actualisez la mémoire."
            : error instanceof Error
              ? error.message
              : "Décisions indisponibles.",
        );
    } finally {
      gate.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <details
      className="memory-evidence"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open && !loaded && !gate.current) void load();
      }}
    >
      <summary>Voir les décisions humaines</summary>
      {open && (
        <>
          {items.length > 0 && (
            <ol>
              {items.map((event) => (
                <li key={event.id}>
                  <strong>{decisionLabels[event.action]}</strong> ·{" "}
                  {event.actor_role
                    ? humanRoles[event.actor_role]
                    : "Rôle non renseigné"}
                  <time dateTime={event.created_at}>
                    {memoryDate(event.created_at)}
                  </time>
                  {event.action === "correct" && event.corrected_value && (
                    <p>{event.corrected_value}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {loaded && !items.length && !error && (
            <p>
              Aucune décision humaine enregistrée pour cet élément. Son état
              provient du PCL ; aucun rôle n’est déduit.
            </p>
          )}
          {busy && <p role="status">Chargement des décisions…</p>}
          {error && (
            <p className="error" role="alert">
              {error}{" "}
              <button
                className="secondary"
                onClick={() => void load(loaded ? cursor : null)}
                disabled={busy}
              >
                Réessayer
              </button>
            </p>
          )}
          {loaded && cursor && !error && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void load(cursor)}
            >
              Décisions plus anciennes
            </button>
          )}
        </>
      )}
    </details>
  );
}
