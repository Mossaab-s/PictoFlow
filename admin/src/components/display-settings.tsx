import { displays, type DisplaySize } from "@/lib/display";

export default function DisplaySettings({
  size,
  onChange,
  disabled,
  temporary,
  contrast,
}: {
  size: DisplaySize;
  onChange: (size: DisplaySize) => void;
  disabled: boolean;
  temporary: boolean;
  contrast: {
    enhanced: boolean;
    temporary: boolean;
    change: (value: boolean) => void;
  };
}) {
  return (
    <details className="display-settings">
      <summary>Réglages d’affichage</summary>
      <fieldset disabled={disabled} aria-describedby="display-help">
        <legend>Taille de mes touches personnelles</legend>
        <div className="display-options">
          {(Object.keys(displays) as DisplaySize[]).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="display-size"
                value={value}
                checked={size === value}
                onChange={() => onChange(value)}
              />
              <span>
                <strong>{displays[value].label}</strong>
                <small>{displays[value].size} cases par écran</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="contrast-option">
        <input
          type="checkbox"
          checked={contrast.enhanced}
          disabled={disabled}
          onChange={(event) => contrast.change(event.target.checked)}
        />
        Contraste renforcé
      </label>
      {contrast.temporary && (
        <p role="status">
          Le contraste reste actif jusqu’au départ de cet écran ; ce navigateur
          ne conserve pas ce réglage.
        </p>
      )}
      <p id="display-help">
        Les repères stables gardent leur grille. Votre message reste en cours.
        {!temporary &&
          " Ce choix est conservé pour ce profil dans ce navigateur."}
      </p>
      {temporary && (
        <p role="status">
          Ce navigateur ne permet pas de conserver le réglage. Il reste actif
          jusqu’au départ de cet écran.
        </p>
      )}
    </details>
  );
}
