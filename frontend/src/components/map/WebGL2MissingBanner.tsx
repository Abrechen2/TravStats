import { useEffect, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

/**
 * The flat map's notice for a page whose WebGL2 probe said no at load.
 *
 * The map itself still runs then (MapLibre gets its own context later), so the
 * page LOOKS fine while every deck.gl layer — rail, bus, ferry, tours,
 * roadtrips, their stations — is simply absent and flights fall back to native
 * lines. Until 2026-11-18 the only trace was an 11 px English line in the
 * bottom-left corner, under the map panel's "Karte" button, and nothing in the
 * console: a tester reported "no routes in rc.35" and had no way to see why.
 * Owner rule from that report: every error is visible and obvious. Hence a
 * banner at the top of the map, in the reader's language, with the one action
 * that can help, and a console warning a bug report can quote.
 */
export function WebGL2MissingBanner(): JSX.Element {
  const { t } = useTranslation(["map"]);
  useEffect(() => {
    logger.warn(
      "WebGL2 was unavailable when the page loaded: rail, bus, ferry, tour and roadtrip lines are not drawn on this page"
    );
  }, []);
  return (
    <div
      role="alert"
      data-testid="webgl2-missing"
      className="absolute left-1/2 z-30 flex -translate-x-1/2 items-center rounded-md border text-sm"
      style={{
        top: "var(--ts-space-md)",
        maxWidth: "min(560px, calc(100% - 2 * var(--ts-space-lg)))",
        gap: "var(--ts-space-md)",
        padding: "var(--ts-space-sm) var(--ts-space-md)",
        background: "var(--ts-surface)",
        borderColor: "var(--ts-warn)",
        color: "var(--ts-text)",
        pointerEvents: "auto",
      }}
    >
      <span>{t("map:webgl2Missing")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 cursor-pointer rounded-sm border px-3 py-1 text-xs"
        style={{ borderColor: "var(--ts-border-button)", color: "var(--ts-text)" }}
      >
        {t("map:webgl2MissingReload")}
      </button>
    </div>
  );
}
