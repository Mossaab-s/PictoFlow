import DisplaySettings from "./display-settings";
import SpeechSettings from "./speech-settings";
import { TouchContent } from "./pictogram";
import { displays } from "@/lib/display";
import type { Tile } from "@/lib/keyboard";
import type { useDisplaySettings } from "./use-display-settings";
import type { useContrastSetting } from "./use-contrast-setting";
import type { useLocalSpeech } from "./use-local-speech";

export default function CommunicationPreferences({
  display,
  contrast,
  speech,
  tile,
  disabled,
}: {
  display: ReturnType<typeof useDisplaySettings>;
  contrast: ReturnType<typeof useContrastSetting>;
  speech: ReturnType<typeof useLocalSpeech>;
  tile?: Tile;
  disabled: boolean;
}) {
  return (
    <section
      className="communication-preferences"
      aria-label="Affichage et voix"
    >
      <h2>À ma façon</h2>
      <DisplaySettings
        size={display.size}
        onChange={display.change}
        disabled={disabled}
        temporary={display.temporary}
        contrast={contrast}
      />
      {tile && (
        <figure
          className={`display-preview grid-columns-${displays[display.size].columns}`}
        >
          <div className="communication-tile tile-preview">
            <TouchContent
              label={tile.block.label}
              representation={tile.representation}
            />
          </div>
          <figcaption>
            Aperçu de taille. Le dessin, le mot et sa place restent les mêmes.
          </figcaption>
        </figure>
      )}
      <SpeechSettings speech={speech} disabled={disabled} />
      <details className="keyboard-instructions">
        <summary>Utiliser le clavier et la souris</summary>
        <p>
          Tab et Maj+Tab parcourent les commandes. Entrée ou Espace choisit une
          touche. Échap arrête la lecture. Les cases libres sont ignorées.
        </p>
        <p>
          Les liens « Aller au message » et « Aller au clavier » apparaissent à
          la première tabulation. Fermez ces options pour retrouver votre
          message.
        </p>
      </details>
    </section>
  );
}
