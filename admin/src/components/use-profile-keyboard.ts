"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Block, Concept, Position } from "@/lib/keyboard";

export function useProfileKeyboard(profileId: string) {
  const [data, setData] = useState<{
    concepts: Concept[];
    blocks: Block[];
    positions: Position[];
  }>({ concepts: [], blocks: [], positions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try {
      const base = `profiles/${profileId}`;
      const [concepts, blocks, positions] = await Promise.all([
        api<Concept[]>(`${base}/concepts`, { signal: request.signal }),
        api<Block[]>(`${base}/blocks`, { signal: request.signal }),
        api<Position[]>(`${base}/keyboard`, { signal: request.signal }),
      ]);
      if (!request.signal.aborted && alive.current)
        setData({ concepts, blocks, positions });
    } catch (error) {
      if (!request.signal.aborted && alive.current)
        setError(
          error instanceof Error ? error.message : "Chargement impossible.",
        );
    } finally {
      if (!request.signal.aborted && alive.current) setLoading(false);
    }
  }, [profileId]);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, [reload]);
  return { ...data, loading, error, setError, reload };
}
