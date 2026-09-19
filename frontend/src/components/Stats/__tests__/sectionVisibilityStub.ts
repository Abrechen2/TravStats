import type { SectionVisibility } from "../../../hooks/useSectionVisibility";

/**
 * A visibility for rendering a statistics tab in a test, without the
 * localStorage behind the real hook. Everything shows unless named.
 */
export function hiding(...keys: string[]): SectionVisibility {
  return {
    isVisible: (section) => !keys.includes(section),
    toggle: () => {},
    reset: () => {},
    hiddenCount: keys.length,
  };
}

export const ALL_VISIBLE = hiding();
