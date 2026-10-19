"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { literalExplanation } from "@/lib/literal-explanation";

export default function LiteralExplanation({
  profileId,
  interpretationId,
}: {
  profileId: string;
  interpretationId: string;
}) {
  const [result, setResult] = useState<{
    path: string;
    text: string;
    failed: boolean;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const path = `profiles/${profileId}/interpretations/${interpretationId}/ai-context`;
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void api<{ fallback_reason?: unknown }>(path, { signal: controller.signal })
      .then((context) => {
        if (!controller.signal.aborted)
          setResult({
            path,
            text: literalExplanation(context.fallback_reason),
            failed: false,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            path,
            text: "L’explication de cet essai n’a pas pu être chargée.",
            failed: true,
          });
      });
    return () => controller.abort();
  }, [path, refresh]);
  const current = result?.path === path ? result : null;
  return (
    <div className="notice literal-explanation">
      <p>
        Vos mots sont présentés tels quels. Vous pouvez les lire ou les
        reformuler pour préciser votre message.
      </p>
      <p role="status">{current?.text ?? "Chargement de l’explication…"}</p>
      {current?.failed && (
        <button className="secondary" onClick={() => setRefresh((n) => n + 1)}>
          Recharger l’explication
        </button>
      )}
    </div>
  );
}
