"use client";
import { useEffect, useRef, useState, type RefObject } from "react";

export function useAutomaticFormulation({
  enabled,
  selectionKey,
  ready,
  gate,
  generate,
}: {
  enabled: boolean;
  selectionKey: string;
  ready: boolean;
  gate: RefObject<boolean>;
  generate: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>;
}) {
  const run = useRef(generate);
  run.current = generate;
  const latest = useRef(selectionKey);
  latest.current = enabled && ready ? selectionKey : "";
  const attempted = useRef("");
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [requestKey, setRequestKey] = useState("");
  const [error, setError] = useState<{ key: string; text: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!enabled) attempted.current = "";
    if (!enabled || !ready || !selectionKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function attempt() {
      if (cancelled || attempted.current === selectionKey) return;
      if (gate.current || inFlight.current) {
        timer = setTimeout(() => void attempt(), 150);
        return;
      }
      attempted.current = selectionKey;
      inFlight.current = true;
      const request = new AbortController();
      controller.current = request;
      setRequestKey(selectionKey);
      setError(null);
      const isCurrent = () =>
        !cancelled &&
        !request.signal.aborted &&
        latest.current === selectionKey;
      try {
        await run.current(request.signal, isCurrent);
      } catch {
        if (isCurrent())
          setError({
            key: selectionKey,
            text: "La proposition est indisponible. Vous pouvez toujours parler avec vos pictos.",
          });
      } finally {
        inFlight.current = false;
        if (!request.signal.aborted) setRequestKey("");
      }
    }
    timer = setTimeout(() => void attempt(), 1200);
    // Changing selection cancels the timer, not the request. Let the single
    // outstanding call settle before asking for the next snapshot.
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, ready, selectionKey, retry, gate]);
  return {
    pending: requestKey === selectionKey && Boolean(requestKey),
    error: error?.key === selectionKey ? error.text : "",
    retry: () => {
      attempted.current = "";
      setRetry((value) => value + 1);
    },
  };
}
