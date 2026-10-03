import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import { connectionStations } from "../../lib/rail/railConnection";
import type { RailConnectionDetail } from "../../types/rail";

/**
 * On a train's own page: the way up to the ride it is part of (forgejo#187).
 * Drawn only once the server has answered that this train HAS a change — a
 * booking's leg list may also hold the way back, which is another ride. A
 * failed question draws nothing: the booking's legs stay listed above, so
 * nothing the page states depends on this answer.
 */
export function RailConnectionLink({ legId }: { legId: string }): JSX.Element | null {
  const { t } = useTranslation(["rail"]);
  const [connection, setConnection] = useState<RailConnectionDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConnection(null);
    void (async () => {
      try {
        const loaded = await railApi.getConnection(legId);
        if (!cancelled) setConnection(loaded);
      } catch (err: unknown) {
        logger.warn("RailConnectionLink: connection not loaded", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [legId]);

  if (!connection || connection.legs.length < 2) return null;
  return (
    <p className="mt-2 text-sm">
      <Link
        to={`/rail/connection/${connection.id}`}
        className="underline"
        data-testid="rail-connection-link"
      >
        {t("rail:connection.whole", { route: connectionStations(connection.legs).join(" → ") })}
      </Link>
    </p>
  );
}
