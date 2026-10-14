"use client";
import { useState } from "react";
import {
  blockRepresentation,
  zones,
  type Representation,
} from "@/lib/keyboard";
import {
  scopedPreview,
  type KeyboardChangePreview,
} from "@/lib/keyboard-organization";
import { TouchContent } from "./pictogram";

export default function KeyboardChangeReview({
  profileId,
  preview,
  visuals,
  removing = false,
  busy,
  apply,
  cancel,
}: {
  profileId: string;
  preview: KeyboardChangePreview;
  visuals: Representation[];
  removing?: boolean;
  busy: boolean;
  apply: () => Promise<void>;
  cancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  if (!scopedPreview(profileId, preview))
    return (
      <p className="error" role="alert">
        Cet aperçu n’est plus disponible.
      </p>
    );
  const destination = preview.destination_page?.label ?? "Accueil";
  return (
    <section
      className="panel keyboard-change-review"
      aria-label={
        removing ? "Aperçu du retrait de page" : "Aperçu du déplacement"
      }
    >
      <h3>
        {removing
          ? `Retirer la page « ${preview.source_page?.label} »`
          : "Vérifier le déplacement"}
      </h3>
      <p>
        {removing
          ? `Les ${preview.moves.length} touches seront transférées vers « ${destination} ». La page disparaîtra de la navigation ; son historique sera conservé.`
          : "Le mot, le dessin et le sens de la touche seront conservés."}
      </p>
      <p>Les autres touches et les repères stables restent à leurs places.</p>
      <ul className="keyboard-move-list">
        {preview.moves.map((move) => (
          <li key={move.block.id}>
            <div className="keyboard-move-touch">
              <TouchContent
                label={move.block.label}
                representation={blockRepresentation(
                  profileId,
                  move.block,
                  visuals,
                )}
              />
            </div>
            <span>
              {preview.source_page?.label ?? "Accueil"} ·{" "}
              {zones[move.before.zone]} · place {move.before.position + 1} →{" "}
              {destination} · place {move.after.position + 1}
              {move.block.status !== "validated" && (
                <small>
                  {" "}
                  Touche conservée hors du clavier ; ce transfert ne la valide
                  pas.
                </small>
              )}
            </span>
          </li>
        ))}
      </ul>
      {!preview.moves.length && (
        <p>Cette page est vide. Aucune touche ne sera déplacée.</p>
      )}
      {removing && (
        <label className="removal-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Je confirme le retrait de cette page et le transfert affiché.
        </label>
      )}
      <div className="actions">
        <button
          disabled={busy || (removing && !confirmed)}
          onClick={() => void apply()}
        >
          {removing
            ? "Confirmer le retrait de la page"
            : "Confirmer le déplacement"}
        </button>
        <button className="secondary" disabled={busy} onClick={cancel}>
          Annuler cet aperçu
        </button>
      </div>
    </section>
  );
}
