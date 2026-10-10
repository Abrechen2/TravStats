import { useCallback, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";

export const GLOBE_COACHMARK_SEEN_KEY = "globeCoachmarkSeen";

interface GlobeCoachmarkProps {
  /**
   * Something is drawn on the globe — a route, a cruise, a stay or a place.
   * The hint explains how to drag, zoom and click markers; on an empty
   * account there is nothing to click, and the card sat squarely on top of
   * the dashboard's "Willkommen bei TravStats" empty state, hiding the two
   * buttons a new account needs (forgejo#88 acceptance, 2026-10-10). So it
   * waits, unseen, until there is content — and is not marked as seen
   * before it has actually been shown.
   */
  hasContent: boolean;
}

function readSeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(GLOBE_COACHMARK_SEEN_KEY) === "1";
  } catch {
    // Unreadable storage: never shown, since a dismissal could not stick and
    // the card would return on every visit (the behaviour it always had).
    return true;
  }
}

/**
 * First-run coachmark — semi-modal hint, dismissed forever via
 * localStorage. Backdrop is click-through so a missed card does not
 * silently block the basemap; only the card catches pointer. z-40: over
 * the always-on stats card (z-30), under a popup the reader asked for.
 */
export function GlobeCoachmark({ hasContent }: GlobeCoachmarkProps): JSX.Element | null {
  const { t } = useTranslation(["map"]);
  const [seen, setSeen] = useState<boolean>(readSeen);
  const dismiss = useCallback(() => {
    setSeen(true);
    try {
      window.localStorage.setItem(GLOBE_COACHMARK_SEEN_KEY, "1");
    } catch {
      // localStorage may be unavailable in private mode — opt-in only
    }
  }, []);

  if (seen || !hasContent) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="rounded-lg p-5 text-sm"
        style={{
          pointerEvents: "auto",
          maxWidth: 420,
          background: "rgba(13, 17, 23, 0.96)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(240,169,71,0.45)",
          color: "rgba(241,245,249,0.95)",
          fontFamily: "'Inter', sans-serif",
          boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
        }}
      >
        <div className="mb-2 text-base font-semibold">{t("map:globe.coachmark.title")}</div>
        <ul className="mb-4 space-y-1.5 text-[12px] opacity-90">
          <li>🖱️ {t("map:globe.coachmark.pan")}</li>
          <li>🔍 {t("map:globe.coachmark.zoom")}</li>
          <li>📍 {t("map:globe.coachmark.click")}</li>
          <li>🌍 {t("map:globe.coachmark.autoRotate")}</li>
        </ul>
        <button
          type="button"
          onClick={dismiss}
          className="w-full cursor-pointer rounded-sm px-3 py-2 text-[12px] font-medium transition-colors"
          style={{
            background: "rgba(240,169,71,0.22)",
            border: "1px solid rgba(240,169,71,0.55)",
            color: "rgba(255,205,128,1)",
          }}
        >
          {t("map:globe.coachmark.dismiss")}
        </button>
      </div>
    </div>
  );
}
