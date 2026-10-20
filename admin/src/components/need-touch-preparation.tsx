"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { profileToolPath } from "@/lib/access";
import {
  blockRepresentation,
  type Block,
  type Representation,
} from "@/lib/keyboard";
import {
  needExamples,
  needTouch,
  type VocabularyNeed,
  type NeedEvidence,
} from "@/lib/vocabulary-needs";
import { useAuthentication } from "./authentication";
import TouchPreparation, { type TouchDraft } from "./touch-preparation";
import { TouchContent } from "./pictogram";

export default function NeedTouchPreparation({
  profileId,
  needId,
  blocks,
  visuals,
  disabled,
  onCreate,
}: {
  profileId: string;
  needId: string;
  blocks: Block[];
  visuals: Representation[];
  disabled: boolean;
  onCreate: (need: VocabularyNeed, draft: TouchDraft) => Promise<boolean>;
}) {
  const session = useAuthentication();
  const [state, setState] = useState<{
    need: VocabularyNeed;
    evidence: NeedEvidence;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      if (!needId) throw new Error("invalid need");
      const base = `profiles/${profileId}/suggestions`;
      const [needs, evidence] = await Promise.all([
        api<VocabularyNeed[]>(base, { signal: controller.signal }),
        api<NeedEvidence>(`${base}/${needId}/evidence`, {
          signal: controller.signal,
        }),
      ]);
      const need = needs.find(
        (n) => n.profile_id === profileId && n.id === needId,
      );
      if (!need) throw new Error("missing need");
      needExamples(profileId, need, evidence);
      if (!controller.signal.aborted) setState({ need, evidence });
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Ce besoin ne peut pas être vérifié. Rechargez-le avant de préparer une touche.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [needId, profileId]);
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load, blocks]);
  const existing = needTouch(profileId, needId, blocks);
  const needsPath = profileToolPath(session, profileId, "suggestions");
  return (
    <section className="panel need-touch-preparation">
      <h2>Préparer la touche de ce besoin</h2>
      <Link href={needsPath}>Revenir aux besoins de vocabulaire</Link>
      {loading && <p role="status">Vérification du besoin accepté…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={disabled || loading}
        onClick={() => void load()}
      >
        Recharger le besoin
      </button>
      {state && (
        <>
          <p>
            <strong>Expression de référence :</strong>{" "}
            {state.need.validated_intent}
          </p>
          <p>
            Choisissez un dessin simple et un mot court. La touche conservera le
            sens de cette expression personnelle.
          </p>
          {existing ? (
            <>
              <div className="touch-sample">
                <TouchContent
                  label={existing.label}
                  representation={blockRepresentation(
                    profileId,
                    existing,
                    visuals,
                    true,
                  )}
                />
              </div>
              <p>
                {existing.status === "validated"
                  ? "Cette touche est validée. Vous pouvez choisir sa place dans le clavier."
                  : existing.status === "rejected"
                    ? "Cette touche a été écartée. Vous pouvez la revoir sans créer de doublon."
                    : "La touche est déjà préparée. Vérifiez le dessin et le mot avant de la valider."}
              </p>
              <a
                className="button-link"
                href={`#${existing.status === "validated" ? "touch" : "prepared"}-${existing.id}`}
              >
                {existing.status === "validated"
                  ? "Choisir la place de cette touche"
                  : "Revoir cette touche"}
              </a>
            </>
          ) : state.need.status === "approved" &&
            state.evidence.eligible &&
            state.need.validated_intent.length <= 512 &&
            !state.evidence.existing_block_match ? (
            <TouchPreparation
              key={`${profileId}:${needId}`}
              concepts={[]}
              disabled={disabled || loading || !!error}
              acceptedMeaning={state.need.validated_intent}
              onCreate={(draft) => onCreate(state.need, draft)}
            />
          ) : (
            <p>
              {state.need.validated_intent.length > 512
                ? "Cette expression dépasse la limite de 512 caractères pour le sens d’une touche. Elle reste conservée dans la mémoire."
                : "Ce besoin n’est pas disponible pour une nouvelle touche : il doit être accepté et conserver suffisamment d’exemples validés."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
