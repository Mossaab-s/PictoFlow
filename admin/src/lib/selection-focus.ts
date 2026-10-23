/** Temporary focus intent for one selection; never replays the selection itself. */
export function beginSelectionFocus(button: HTMLButtonElement) {
  const doc = button.ownerDocument;
  const view = doc.defaultView!;
  let cancelled = false;
  let complete = false;
  let afterFrame = false;
  let frame = 0;
  const observer = new MutationObserver(restore);
  function cancel() {
    if (cancelled) return;
    cancelled = true;
    view.cancelAnimationFrame(frame);
    observer.disconnect();
    doc.removeEventListener("focusin", moved, true);
    doc.removeEventListener("pointerdown", pointed, true);
    doc.removeEventListener("keydown", navigating, true);
    doc.removeEventListener("visibilitychange", hidden);
    view.removeEventListener("blur", cancel);
  }
  function restore() {
    if (cancelled) return;
    if (!button.isConnected || doc.hidden) return cancel();
    if (!complete || !afterFrame || button.disabled) return;
    const eligible =
      doc.activeElement === button || doc.activeElement === doc.body;
    cancel();
    if (eligible) button.focus({ preventScroll: true });
  }
  function moved(event: Event) {
    // Disabling a focused button can leave focus on body without user navigation.
    if (event.target !== button && event.target !== doc.body) cancel();
  }
  function pointed(event: Event) {
    if (!button.contains(event.target as Node)) cancel();
  }
  function navigating(event: KeyboardEvent) {
    if (event.key === "Tab" || event.key === "Escape") cancel();
  }
  function hidden() {
    if (doc.hidden) cancel();
  }
  observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
  doc.addEventListener("focusin", moved, true);
  doc.addEventListener("pointerdown", pointed, true);
  doc.addEventListener("keydown", navigating, true);
  doc.addEventListener("visibilitychange", hidden);
  view.addEventListener("blur", cancel);
  return {
    cancel,
    settled() {
      if (cancelled || complete) return;
      complete = true;
      // Preserve the normal next-frame path, but keep observing if React has not
      // committed the enabled state yet. Never poll or repeat the selection.
      frame = view.requestAnimationFrame(() => {
        afterFrame = true;
        restore();
      });
    },
  };
}
