import { useEffect, useState } from "react";
import {
  PHONE_MAX_WIDTH_PX,
  isPhoneViewport,
} from "../components/Dashboard/tabs/legendInitialState";

/**
 * Reactive version of `isPhoneViewport()` — that helper answers once (it
 * backs an initial-open decision that need not track a live resize). The
 * domain filter has to actually SWITCH between the dropdown and the sheet
 * variant while the window is resized (a devtools viewport change during
 * manual QA, a tablet rotated), so it needs the live answer, not a snapshot.
 */
export function useIsPhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() => isPhoneViewport());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
    } catch {
      return;
    }
    const onChange = (): void => setIsPhone(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isPhone;
}
