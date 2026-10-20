"use client";
import { useId, useState, type ReactNode } from "react";
import type { Interpretation } from "@/lib/keyboard";

export default function PhraseHypotheses({
  candidates,
  disabled,
  onInspect,
  children,
}: {
  candidates: Interpretation[];
  disabled: boolean;
  onInspect: () => void;
  children: (candidate: Interpretation) => ReactNode;
}) {
  const id = useId();
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const accepted = candidates.find((candidate) =>
    ["confirmed", "corrected"].includes(candidate.status),
  );
  const inspected =
    accepted ??
    candidates.find((candidate) => candidate.id === inspectedId) ??
    candidates[0];
  if (!inspected) return null;
  if (candidates.length === 1) return children(inspected);
  return (
    <div className="phrase-hypotheses">
      <fieldset
        className="hypothesis-choices"
        disabled={disabled || Boolean(accepted)}
        aria-describedby={`${id}-help`}
      >
        <legend>Plusieurs sens sont possibles</legend>
        <p id={`${id}-help`} className="helper">
          {accepted
            ? "Votre phrase validée est affichée ci-dessous. Les autres phrases ne sont pas validées."
            : "Comparez les phrases, puis choisissez celle à vérifier. Changer de phrase ne la valide pas et ne la lit pas à voix haute."}
        </p>
        {candidates.map((candidate, index) => (
          <label key={candidate.id} className="hypothesis-choice">
            <input
              type="radio"
              name={id}
              value={candidate.id}
              checked={inspected.id === candidate.id}
              onChange={() => {
                onInspect();
                setInspectedId(candidate.id);
              }}
              aria-controls={`${id}-review`}
            />
            <span>
              <span className="helper">Phrase {index + 1}</span>
              <strong>{candidate.corrected_text ?? candidate.text}</strong>
              {candidate.status === "rejected" && (
                <span className="helper">Proposition écartée</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <div id={`${id}-review`}>
        <p className="helper" role="status">
          Phrase {candidates.indexOf(inspected) + 1} sur {candidates.length}
        </p>
        {candidates.map((candidate) => (
          <div key={candidate.id} hidden={candidate.id !== inspected.id}>
            {children(candidate)}
          </div>
        ))}
      </div>
    </div>
  );
}
