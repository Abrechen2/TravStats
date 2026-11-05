import { useEffect, useState } from "react";

/** iPad portrait (820) and below: floating cards fold into pills and a bottom sheet. */
export const NARROW_STAGE_MAX_PX = 900;

const query = `(max-width: ${NARROW_STAGE_MAX_PX - 1}px)`;

const matches = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

/** Whether the map stage is narrow; follows a resize or a rotated tablet. */
export function useNarrowStage(): boolean {
  const [narrow, setNarrow] = useState<boolean>(matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
