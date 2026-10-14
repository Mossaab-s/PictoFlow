"use client";
import { useEffect, useRef, useState } from "react";
import {
  chooseVoice,
  createLocalReader,
  defaultSpeech,
  localFrenchVoices,
  parseSpeech,
  serializeSpeech,
  speechStorageKey,
  type SpeechSettings,
} from "@/lib/speech";

export function useLocalSpeech(profileId: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [settings, setSettings] = useState<SpeechSettings>({
    ...defaultSpeech,
  });
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const reader = useRef<ReturnType<typeof createLocalReader> | null>(null);
  const key = speechStorageKey(profileId);
  useEffect(() => {
    setReady(false);
    setTemporary(false);
    try {
      setSettings(parseSpeech(localStorage.getItem(key)));
    } catch {
      setSettings({ ...defaultSpeech });
      setTemporary(true);
    }
    setReady(true);
  }, [key]);
  useEffect(() => {
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof window.SpeechSynthesisUtterance !== "function")
      return;
    setSupported(true);
    let alive = true;
    const local = createLocalReader(
      synthesis,
      (text) => new SpeechSynthesisUtterance(text),
      (reading, failure) => {
        if (alive) {
          setSpeaking(reading);
          setError(failure);
        }
      },
    );
    reader.current = local;
    const update = () => {
      local.stop();
      try {
        setVoices(localFrenchVoices(synthesis.getVoices()));
      } catch {
        setVoices([]);
      }
    };
    const hide = () => {
      if (document.hidden) local.stop();
    };
    update();
    synthesis.addEventListener("voiceschanged", update);
    window.addEventListener("pagehide", local.stop);
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive = false;
      synthesis.removeEventListener("voiceschanged", update);
      window.removeEventListener("pagehide", local.stop);
      document.removeEventListener("visibilitychange", hide);
      local.stop();
      reader.current = null;
    };
  }, [profileId]);
  function stop() {
    reader.current?.stop();
  }
  function change(next: SpeechSettings) {
    stop();
    setSettings(next);
    try {
      localStorage.setItem(key, serializeSpeech(next));
      setTemporary(false);
    } catch {
      setTemporary(true);
    }
  }
  function read(text: string) {
    if (ready) reader.current?.read(text, settings);
  }
  return {
    available: ready && Boolean(chooseVoice(voices, settings.voiceURI)),
    supported,
    ready,
    voices,
    settings,
    temporary,
    speaking,
    error,
    read,
    stop,
    change,
  };
}
