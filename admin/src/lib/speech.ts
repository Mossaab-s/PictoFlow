export const speechRates = {
  slow: { label: "Lent", value: 0.7 },
  normal: { label: "Normal", value: 1 },
  fast: { label: "Rapide", value: 1.2 },
} as const;
export type SpeechRate = keyof typeof speechRates;
export type SpeechSettings = { voiceURI: string; rate: SpeechRate };
export const defaultSpeech: SpeechSettings = { voiceURI: "", rate: "normal" };
export function speechStorageKey(profileId: string) {
  return `pictoflow:speech:${profileId}`;
}
export function parseSpeech(value: string | null): SpeechSettings {
  try {
    const data = value ? JSON.parse(value) : null;
    if (
      data?.version === 1 &&
      typeof data.voiceURI === "string" &&
      data.voiceURI.length <= 1000 &&
      typeof data.rate === "string" &&
      Object.hasOwn(speechRates, data.rate)
    )
      return { voiceURI: data.voiceURI, rate: data.rate };
  } catch {
    /* Invalid settings cannot prevent communication. */
  }
  return { ...defaultSpeech };
}
export function serializeSpeech(settings: SpeechSettings) {
  return JSON.stringify({
    version: 1,
    voiceURI: settings.voiceURI,
    rate: settings.rate,
  });
}
export function localFrenchVoices(voices: SpeechSynthesisVoice[]) {
  const seen = new Set<string>();
  return voices.filter((voice) => {
    if (
      !voice.localService ||
      !/^fr(?:[-_]|$)/i.test(voice.lang) ||
      seen.has(voice.voiceURI)
    )
      return false;
    seen.add(voice.voiceURI);
    return true;
  });
}
export function chooseVoice(voices: SpeechSynthesisVoice[], voiceURI: string) {
  const local = localFrenchVoices(voices);
  return (
    local.find((voice) => voice.voiceURI === voiceURI) ??
    local.find((voice) => voice.default) ??
    local[0] ??
    null
  );
}

// Keep the utterance alive and ignore late events from canceled readings.
// Every read rechecks the current voice list; no remote/default engine fallback.
export function createLocalReader(
  synthesis: Pick<SpeechSynthesis, "getVoices" | "cancel" | "speak">,
  utterance: (text: string) => SpeechSynthesisUtterance,
  notify: (speaking: boolean, error: string) => void,
) {
  let generation = 0;
  let active: SpeechSynthesisUtterance | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    generation++;
    active = null;
    clearTimeout(timer);
    timer = undefined;
    try {
      synthesis.cancel();
    } catch {
      /* A disappearing engine is already stopped. */
    }
    notify(false, "");
  }
  function read(text: string, settings: SpeechSettings) {
    stop();
    if (!text.trim()) return;
    const current = generation;
    try {
      const voice = chooseVoice(synthesis.getVoices(), settings.voiceURI);
      if (!voice) {
        notify(
          false,
          "Aucune voix française locale n’est disponible. Vérifiez les voix installées sur cet appareil.",
        );
        return;
      }
      const message = utterance(text);
      active = message;
      message.voice = voice;
      message.lang = voice.lang;
      message.rate = speechRates[settings.rate].value;
      function finish(error = "") {
        if (current !== generation || active !== message) return;
        clearTimeout(timer);
        timer = undefined;
        active = null;
        notify(false, error);
      }
      message.onstart = () => {
        if (current !== generation || active !== message) return;
        clearTimeout(timer);
        timer = undefined;
        notify(true, "");
      };
      message.onend = () => finish();
      message.onerror = (event) =>
        finish(
          ["canceled", "interrupted"].includes(event.error)
            ? ""
            : "La lecture n’a pas pu démarrer. Vérifiez le son et la voix installée, puis réessayez.",
        );
      notify(true, "");
      timer = setTimeout(() => {
        if (current !== generation || !active) return;
        stop();
        notify(
          false,
          "La voix ne répond pas. Vérifiez le son et la voix installée, puis réessayez.",
        );
      }, 10000);
      synthesis.speak(message);
    } catch {
      stop();
      notify(
        false,
        "La lecture n’a pas pu démarrer. Vérifiez le son et la voix installée, puis réessayez.",
      );
    }
  }
  return { read, stop };
}
