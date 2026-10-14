import { speechRates, type SpeechRate } from "@/lib/speech";
import type { useLocalSpeech } from "./use-local-speech";
import { useId } from "react";

export default function SpeechSettings({
  speech,
  disabled,
}: {
  speech: ReturnType<typeof useLocalSpeech>;
  disabled: boolean;
}) {
  const voiceId = useId();
  const rateId = useId();
  const missing =
    Boolean(speech.settings.voiceURI) &&
    !speech.voices.some((voice) => voice.voiceURI === speech.settings.voiceURI);
  return (
    <details className="display-settings speech-settings">
      <summary>Réglages de lecture vocale</summary>
      <p>
        La lecture démarre uniquement quand vous la demandez. Seules les voix
        françaises locales de cet appareil sont proposées.
      </p>
      {!speech.available && (
        <p role="status">
          {speech.supported
            ? "Aucune voix française locale disponible pour le moment. Installez une voix française dans les réglages de l’appareil, puis rouvrez le navigateur."
            : "Ce navigateur ne propose pas la lecture vocale. Vos mots restent disponibles à l’écran."}
        </p>
      )}
      <fieldset disabled={disabled || !speech.ready || !speech.available}>
        <legend>Ma voix et son débit</legend>
        <div className="speech-options">
          <div className="speech-field">
            <label htmlFor={voiceId}>Voix française locale</label>
            <select
              id={voiceId}
              value={speech.settings.voiceURI}
              onChange={(event) =>
                speech.change({
                  ...speech.settings,
                  voiceURI: event.target.value,
                })
              }
            >
              <option value="">Voix locale par défaut</option>
              {missing && (
                <option value={speech.settings.voiceURI} disabled>
                  Voix choisie indisponible
                </option>
              )}
              {speech.voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>
          <div className="speech-field">
            <label htmlFor={rateId}>Débit de lecture</label>
            <select
              id={rateId}
              value={speech.settings.rate}
              onChange={(event) =>
                speech.change({
                  ...speech.settings,
                  rate: event.target.value as SpeechRate,
                })
              }
            >
              {Object.entries(speechRates).map(([value, rate]) => (
                <option key={value} value={value}>
                  {rate.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="secondary"
          onClick={() =>
            speech.read("Bonjour, voici ma voix pour communiquer.")
          }
        >
          Essayer cette voix
        </button>
      </fieldset>
      {missing && speech.available && (
        <p role="status">
          La voix choisie n’est plus disponible. La voix française locale par
          défaut sera utilisée.
        </p>
      )}
      <p>
        {speech.temporary
          ? "Ce navigateur ne conserve pas ces réglages. Ils restent actifs jusqu’au départ de cet écran."
          : "La voix et le débit sont conservés pour ce profil dans ce navigateur. Les messages lus ne sont pas enregistrés dans ces réglages."}
      </p>
    </details>
  );
}
