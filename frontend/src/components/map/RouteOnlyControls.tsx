import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { RouteDomain } from "../../lib/mapRoutes";
import { useRoutesVisible } from "../../store/mapRoutesStore";
import { MUTED_TEXT } from "./controlPanelKit";

/**
 * Wraps the controls that only shape a domain's LINES (shape, colour, width).
 * While that domain's routes are off they would change nothing on the map, so
 * they are greyed out and disabled with the reason under them, instead of
 * looking live (a `<fieldset disabled>` disables every native control inside).
 * Uses the effective switch, so a mode that forces routes on keeps them active.
 */
export function RouteOnlyControls({
  domain,
  children,
}: {
  domain: RouteDomain;
  children: ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const visible = useRoutesVisible(domain);
  if (visible) return <>{children}</>;
  return (
    <>
      <fieldset
        disabled
        aria-disabled="true"
        data-testid={`route-only-${domain}`}
        className="m-0 min-w-0 border-0 p-0"
        style={{ opacity: 0.45 }}
      >
        {children}
      </fieldset>
      <div
        className="mb-1 mt-1 text-[10px] leading-snug"
        style={{ color: MUTED_TEXT }}
        data-testid={`route-only-reason-${domain}`}
      >
        {t("map:globe.panel.routeControlsOff")}
      </div>
    </>
  );
}
