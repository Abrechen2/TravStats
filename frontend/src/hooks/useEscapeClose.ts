import { useEffect, useRef } from "react";

/**
 * Escape closes a panel that is not built on `Modal`/`Dialog`.
 *
 * Those two get Escape from `useDialogChrome`. A hand-rolled overlay, a
 * floating map card or a popover had only its × button, so a keyboard user
 * who opened one had to Tab around to find the way out (owner report
 * 2026-11-23: "things that open have no way to close"). The close-affordance
 * guard (`__tests__/closeAffordance.test.tsx`) fails on a `role="dialog"`
 * that answers neither this hook nor the shared chrome.
 *
 * `busy` blocks the key while an action is in flight, as it does in
 * `useDialogChrome`. A key another handler already claimed
 * (`defaultPrevented`, e.g. a Toggletip inside the panel) is left alone, and
 * only the most recently opened panel answers: a wizard opened over an import
 * preview closes alone, not together with the preview under it.
 */
const stack: symbol[] = [];

export function useEscapeClose(open: boolean, onClose: () => void, busy = false): void {
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const id = Symbol("escape-close");
    stack.push(id);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || busyRef.current) return;
      if (stack[stack.length - 1] !== id) return;
      event.preventDefault();
      onCloseRef.current();
    };
    // On `window`, so it hears the key AFTER `useDialogChrome` (on `document`):
    // a confirmation opened from inside the panel claims Escape and closes alone.
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const index = stack.indexOf(id);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [open]);
}
