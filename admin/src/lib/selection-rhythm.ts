export type InputMethod = "pointer" | "keyboard" | "unknown";
export type SelectionMark = {
  sequenceId: string;
  clickedAt: number;
  releasedAt: number;
};
export function selectionObservation(
  previous: SelectionMark | null,
  sequenceId: string,
  clickedAt: number,
  inputMethod: InputMethod,
) {
  if (!previous || previous.sequenceId !== sequenceId)
    return {
      interval_ms: null,
      blocked_ms: 0,
      input_method: inputMethod,
    };
  const elapsed = Math.round(clickedAt - previous.clickedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86400000)
    return {
      interval_ms: null,
      blocked_ms: 0,
      input_method: inputMethod,
    };
  return {
    interval_ms: elapsed,
    blocked_ms: Math.min(
      elapsed,
      Math.max(0, Math.round(previous.releasedAt - previous.clickedAt)),
    ),
    input_method: inputMethod,
  };
}
