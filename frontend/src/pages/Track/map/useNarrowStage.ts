import { useEffect, useState } from "react";

/** iPad portrait (820) and below: floating cards fold into pills and a bottom sheet. */
export const NARROW_STAGE_MAX_PX = 900;

/** A tablet held landscape (1024 and wider): the day card docks beside the map. */
export const DOCKED_STAGE_MIN_PX = 1024;

const NARROW_QUERY = `(max-width: ${NARROW_STAGE_MAX_PX - 1}px)`;
const DOCKED_QUERY = `(min-width: ${DOCKED_STAGE_MIN_PX}px) and (orientation: landscape)`;

const supported = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

/** Follows a media query, including a resize or a rotated tablet. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    supported() ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (!supported()) return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Whether the map stage is narrow; follows a resize or a rotated tablet. */
export function useNarrowStage(): boolean {
  return useMedia(NARROW_QUERY);
}

/**
 * Whether the stage is wide AND landscape: the day's legs and stops stay in a column beside
 * the map instead of a card the detail replaces. Portrait and narrow keep today's sheet.
 */
export function useDockedStage(): boolean {
  return useMedia(DOCKED_QUERY);
}
