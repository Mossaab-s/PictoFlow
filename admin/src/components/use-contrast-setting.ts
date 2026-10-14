"use client";
import { useEffect, useState } from "react";
import {
  contrastStorageKey,
  parseContrast,
  serializeContrast,
} from "@/lib/contrast";

export function useContrastSetting(profileId: string) {
  const [enhanced, setEnhanced] = useState(false);
  const [ready, setReady] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const key = contrastStorageKey(profileId);
  useEffect(() => {
    setTemporary(false);
    try {
      setEnhanced(parseContrast(localStorage.getItem(key)));
    } catch {
      setEnhanced(false);
      setTemporary(true);
    }
    setReady(true);
  }, [key]);
  function change(value: boolean) {
    setEnhanced(value);
    try {
      localStorage.setItem(key, serializeContrast(value));
      setTemporary(false);
    } catch {
      setTemporary(true);
    }
  }
  return { enhanced, ready, temporary, change };
}
