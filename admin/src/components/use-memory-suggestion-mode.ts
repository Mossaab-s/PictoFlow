"use client";
import { useEffect, useState } from "react";
import {
  suggestionKey,
  suggestionMode,
  type SuggestionMode,
} from "@/lib/memory-suggestions";

export function useMemorySuggestionMode(profileId: string) {
  const [mode, setMode] = useState<SuggestionMode>("off");
  const [ready, setReady] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const key = suggestionKey(profileId);
  useEffect(() => {
    try {
      setMode(suggestionMode(localStorage.getItem(key)));
    } catch {
      setTemporary(true);
    }
    setReady(true);
  }, [key]);
  function change(value: SuggestionMode) {
    setMode(value);
    try {
      localStorage.setItem(key, value);
      setTemporary(false);
    } catch {
      setTemporary(true);
    }
  }
  return { mode, ready, temporary, change };
}
