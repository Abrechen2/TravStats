import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import Banner from "../ui/Banner";

/**
 * A failed save, shown INSIDE the form that failed (not at the top of the
 * page, where nobody looking at the form would see it).
 *
 * `set` on failure, `clear` when the next attempt starts; render `node` next to
 * the submit button. A dialog needs none of this — `reportPageError` already
 * lands inside the top dialog — this is for forms that sit on a page.
 */
export function useFormError(): {
  set: (message: string, tone?: "error" | "warning") => void;
  clear: () => void;
  node: JSX.Element | null;
} {
  const [state, setState] = useState<{ message: string; tone: "error" | "warning" } | null>(null);
  const set = useCallback(
    (message: string, tone: "error" | "warning" = "error") => setState({ message, tone }),
    []
  );
  const clear = useCallback(() => setState(null), []);
  const node = useMemo(
    () =>
      state ? (
        <Banner tone={state.tone} className="mb-3" onDismiss={clear}>
          {state.message}
        </Banner>
      ) : null,
    [state, clear]
  );
  return { set, clear, node };
}
