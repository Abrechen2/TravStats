import { useEffect, useState } from "react";

/**
 * Whether the primary input is a finger rather than a mouse.
 *
 * Separate from `useIsPhoneViewport` on purpose: that one answers "is this
 * narrow enough for the sheet layout", which is a question about WIDTH. Touch
 * target size is a question about the INPUT, and the two stopped agreeing the
 * moment iPads became the baseline the web build is drawn for (owner,
 * 2026-09-28: the phone is the Companion's job, the browser targets tablets).
 *
 * Measured before this existed: on every iPad viewport — 768×1024, 1024×768,
 * 820×1180, 1194×834 — the domain filter served the mouse dropdown, whose
 * "Nur" button is 36×21 px and whose rows are 40 px. Both are under the 44 px
 * the design's own phone sheet uses, on a device operated by thumbs. The
 * width test called an iPad a desktop because it is wide, which it is.
 *
 * `(pointer: coarse)` describes the primary pointing device, so a laptop with
 * a touchscreen but a trackpad in use keeps the compact layout, and an iPad
 * gets the large one at any width.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia("(pointer: coarse)");
    } catch {
      return;
    }
    const onChange = (): void => setCoarse(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return coarse;
}
