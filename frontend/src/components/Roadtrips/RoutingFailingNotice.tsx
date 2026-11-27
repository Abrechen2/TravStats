import { useEffect, type JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { useAuthStore } from "../../store/authStore";
import type { RoutingFailing } from "../../types/roadtrip";
import Banner from "../ui/Banner";

const PROVIDER_NAMES: Record<string, string> = {
  openrouteservice: "OpenRouteService",
  graphhopper: "GraphHopper",
};

/**
 * The routing provider refuses this instance right now (#411): every leg it
 * was asked for became a straight chord, and the only trace used to be a log
 * line. Said on the page, with a console warning, and — for an admin — a link
 * to the provider choice.
 */
export default function RoutingFailingNotice({
  failing,
}: {
  failing: RoutingFailing | null | undefined;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  useEffect(() => {
    if (failing) logger.warn("Routing provider refuses requests; legs are straight lines", failing);
  }, [failing]);
  if (!failing) return null;
  return (
    <Banner tone="error" testId="routing-failing-notice">
      {t("trips:tours.routing.providerFailing", {
        provider: PROVIDER_NAMES[failing.providerId] ?? t("trips:tours.routing.providerCustom"),
      })}
      {isAdmin && (
        <>
          {" "}
          <Link
            to="/settings/dienste?service=openrouteservice&match=routingProvider"
            className="underline"
          >
            {t("trips:tours.routing.providerFailingAction")}
          </Link>
        </>
      )}
    </Banner>
  );
}
