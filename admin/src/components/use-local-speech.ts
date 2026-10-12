"use client";
import { useEffect, useState } from "react";

export function useLocalSpeech() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const speech = window.speechSynthesis;
    const update = () =>
      setVoice(
        speech
          .getVoices()
          .find(
            (item) =>
              item.localService && item.lang.toLowerCase().startsWith("fr"),
          ) ?? null,
      );
    update();
    speech.addEventListener("voiceschanged", update);
    return () => {
      speech.removeEventListener("voiceschanged", update);
      speech.cancel();
    };
  }, []);
  function read(text: string) {
    if (!voice || !text.trim()) return;
    const speech = window.speechSynthesis;
    speech.cancel();
    setError("");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = (event) => {
      setSpeaking(false);
      if (event.error !== "canceled" && event.error !== "interrupted")
        setError("La lecture n'a pas pu démarrer.");
    };
    speech.speak(utterance);
  }
  function stop() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }
  return { available: Boolean(voice), speaking, error, read, stop };
}
