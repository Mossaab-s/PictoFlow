"use client";
import KeyboardGrid from "./keyboard-grid";
import { useDisplaySettings } from "./use-display-settings";
import { useContrastSetting } from "./use-contrast-setting";
import { displays } from "@/lib/display";
import type { Tile, KeyboardGroup } from "@/lib/keyboard";

export default function KeyboardPreparationPreview({
  profileId,
  tiles,
  groups,
}: {
  profileId: string;
  tiles: Tile[];
  groups: KeyboardGroup[];
}) {
  const display = useDisplaySettings(profileId);
  const contrast = useContrastSetting(profileId);
  return (
    <section
      id="keyboard-preview"
      aria-label="Aperçu du clavier de communication"
      className={`review-section communication-page keyboard-preparation-preview${contrast.enhanced ? " contrast-enhanced" : ""}`}
      tabIndex={-1}
    >
      <h2>Aperçu du clavier</h2>
      <p>
        Seules les touches validées apparaissent. Cet aperçu ne compose pas de
        message et ne parle pas.
      </p>
      {display.ready && contrast.ready ? (
        <>
          <p className="helper">
            Affichage : {displays[display.size].label}. Les pages, les cases
            libres et les repères stables sont conservés.
          </p>
          {tiles.length ? (
            <KeyboardGrid
              profileId={profileId}
              groups={groups}
              tiles={tiles}
              displaySize={display.size}
            />
          ) : (
            <div className="empty">
              <h3>Votre clavier attend ses premières touches</h3>
              <p>Créez une touche puis validez-la pour la retrouver ici.</p>
            </div>
          )}
        </>
      ) : (
        <p role="status">Préparation de l’aperçu…</p>
      )}
    </section>
  );
}
