"use client";
import { useId, useRef, useState } from "react";
import type { Concept } from "@/lib/keyboard";
import { pictograms, type PictogramKey } from "@/lib/pictograms";
import { Pictogram } from "./pictogram";
import PictogramPicker from "./pictogram-picker";
import PhotoPicker, { PhotoPreview } from "./photo-picker";

export type TouchDraft = {
  label: string;
  meaning: string;
  conceptId: string;
  pictogramKey: PictogramKey | null;
  visualMode: "drawing" | "photo";
  photo: File | null;
};
const emptyDraft: TouchDraft = {
  label: "",
  meaning: "",
  conceptId: "",
  pictogramKey: null,
  visualMode: "drawing",
  photo: null,
};
const steps = ["L’image", "Le mot", "Vérifier"] as const;

export default function TouchPreparation({
  concepts,
  disabled,
  onCreate,
  acceptedMeaning,
}: {
  concepts: Concept[];
  disabled: boolean;
  onCreate: (draft: TouchDraft) => Promise<boolean>;
  acceptedMeaning?: string;
}) {
  const [draft, setDraft] = useState<TouchDraft>(emptyDraft);
  const [editedWord, setEditedWord] = useState(false);
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const wordId = useId();
  const existingMeaningId = useId();
  const imageReady =
    draft.visualMode === "photo" ? !!draft.photo : !!draft.pictogramKey;
  const wordReady = !!draft.label.trim();
  const meaning =
    acceptedMeaning ??
    concepts.find((c) => c.id === draft.conceptId)?.label ??
    (draft.meaning.trim() || draft.label.trim());
  function go(next: number) {
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <form
      className="touch-preparation"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || !imageReady) return;
        if (step === 0) return go(1);
        if (!wordReady) return;
        if (step === 1) return go(2);
        if (await onCreate(draft)) {
          setDraft(emptyDraft);
          setEditedWord(false);
          setStep(0);
        }
      }}
    >
      <ol
        className="touch-preparation-progress"
        aria-label="Préparer une nouvelle touche"
      >
        {steps.map((name, index) => (
          <li key={name}>
            <button
              type="button"
              className="secondary"
              aria-current={step === index ? "step" : undefined}
              disabled={
                disabled ||
                (index > 0 && !imageReady) ||
                (index > 1 && !wordReady)
              }
              onClick={() => go(index)}
            >
              {index + 1}. {name}
            </button>
          </li>
        ))}
      </ol>
      <section aria-labelledby={headingId}>
        <h3 ref={heading} id={headingId} tabIndex={-1}>
          {step === 0
            ? "Choisir l’image"
            : step === 1
              ? "Écrire le mot"
              : "Vérifier la nouvelle touche"}
        </h3>
        {step === 0 && (
          <>
            <p>Choisissez un dessin simple ou une photo familière.</p>
            <div
              className="actions"
              role="group"
              aria-label="Image de la touche"
            >
              <button
                type="button"
                className="secondary"
                aria-pressed={draft.visualMode === "drawing"}
                disabled={disabled}
                onClick={() => setDraft({ ...draft, visualMode: "drawing" })}
              >
                Dessin
              </button>
              <button
                type="button"
                className="secondary"
                aria-pressed={draft.visualMode === "photo"}
                hidden={acceptedMeaning !== undefined}
                disabled={disabled}
                onClick={() => setDraft({ ...draft, visualMode: "photo" })}
              >
                Photo personnelle
              </button>
            </div>
            {draft.visualMode === "photo" ? (
              <PhotoPicker
                file={draft.photo}
                disabled={disabled}
                onChange={(photo) => setDraft({ ...draft, photo })}
              />
            ) : (
              <PictogramPicker
                value={draft.pictogramKey}
                disabled={disabled}
                onChange={(key) => {
                  setDraft({
                    ...draft,
                    pictogramKey: key,
                    label:
                      !editedWord && !draft.conceptId
                        ? (pictograms.find((p) => p.key === key)?.label ?? "")
                        : draft.label,
                  });
                }}
              />
            )}
            <button type="submit" disabled={disabled || !imageReady}>
              Continuer : le mot
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <label htmlFor={wordId}>Texte affiché sur la touche</label>
            <input
              id={wordId}
              value={draft.label}
              onChange={(event) => {
                setEditedWord(true);
                setDraft({ ...draft, label: event.target.value });
              }}
              required
              maxLength={256}
              placeholder="Boire"
              disabled={disabled}
            />
            <p className="helper">
              Ce mot apparaîtra sous l’image. Vous pouvez adapter le mot
              proposé.
            </p>
            {acceptedMeaning !== undefined ? (
              <p>
                <strong>Sens du besoin accepté :</strong> {acceptedMeaning}
              </p>
            ) : (
              <details className="touch-meaning-options">
                <summary>Préciser le sens (facultatif)</summary>
                {!draft.conceptId && (
                  <label>
                    Ce que cette touche signifie pour moi, facultatif
                    <input
                      value={draft.meaning}
                      onChange={(event) =>
                        setDraft({ ...draft, meaning: event.target.value })
                      }
                      maxLength={256}
                      disabled={disabled}
                      placeholder="Par exemple : mon ours pour me rassurer"
                    />
                    <span className="helper">
                      Sans précision, le mot de la touche sert de sens.
                    </span>
                  </label>
                )}
                <label htmlFor={existingMeaningId}>Sens existant</label>
                <select
                  id={existingMeaningId}
                  value={draft.conceptId}
                  disabled={disabled}
                  onChange={(event) => {
                    const conceptId = event.target.value;
                    setDraft({
                      ...draft,
                      conceptId,
                      label:
                        !editedWord && conceptId
                          ? (concepts.find((c) => c.id === conceptId)?.label ??
                            draft.label)
                          : draft.label,
                    });
                  }}
                >
                  <option value="">Créer un nouveau sens avec mon mot</option>
                  {concepts.map((concept) => (
                    <option key={concept.id} value={concept.id}>
                      {concept.label}
                    </option>
                  ))}
                </select>
                <p className="helper">
                  Choisissez un sens existant seulement si cette touche exprime
                  le même sens personnel.
                </p>
              </details>
            )}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => go(0)}
              >
                Revenir à l’image
              </button>
              <button type="submit" disabled={disabled || !wordReady}>
                Voir la touche à vérifier
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            {draft.visualMode === "photo" ? (
              <PhotoPreview file={draft.photo} label={draft.label.trim()} />
            ) : (
              <div
                className="touch-sample"
                aria-label="Aperçu de la nouvelle touche"
              >
                {draft.pictogramKey && (
                  <Pictogram pictogramKey={draft.pictogramKey} />
                )}
                <strong className="touch-word">{draft.label.trim()}</strong>
              </div>
            )}
            <p className="touch-preparation-meaning">
              <strong>Sens retenu :</strong> {meaning}
            </p>
            <p>
              Après sa création, cette touche restera à valider avant
              d’apparaître dans le clavier.
            </p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => go(0)}
              >
                Changer l’image
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => go(1)}
              >
                Modifier le mot ou le sens
              </button>
            </div>
            <button
              type="submit"
              disabled={disabled || !imageReady || !wordReady}
            >
              Créer la touche à vérifier
            </button>
          </>
        )}
      </section>
    </form>
  );
}
