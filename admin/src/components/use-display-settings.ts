"use client";
import { useEffect, useState } from "react";
import {
  displayStorageKey,
  parseDisplay,
  serializeDisplay,
  type DisplaySize,
} from "@/lib/display";

export function useDisplaySettings(profileId: string) {
  const [size, setSize] = useState<DisplaySize>("standard");
  const [ready, setReady] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const key = displayStorageKey(profileId);
  useEffect(() => {
    try {
      setSize(parseDisplay(localStorage.getItem(key)));
    } catch {
      setTemporary(true);
    }
    setReady(true);
  }, [key]);

  function change(next: DisplaySize) {
    setSize(next);
    try {
      localStorage.setItem(key, serializeDisplay(next));
      setTemporary(false);
    } catch {
      setTemporary(true);
    }
  }
  return { size, ready, temporary, change };
}
