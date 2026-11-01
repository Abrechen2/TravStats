import { useEffect, useState } from "react";
import { externalServicesApi } from "../../lib/api/externalServices";
import { useHasLlm } from "../../hooks/useHasLlm";
import { locationProviderApi } from "../../lib/api/locationProvider";
import { logger } from "../../lib/logger";

export interface ServiceReadiness {
  /** Does this account reach an Immich (its own or the server's)? `null`: not known (yet). */
  immich: boolean | null;
  /** Is a text model available to this server and not switched off? `null`: not known (yet). */
  ai: boolean | null;
  /** Has the account chosen where positions come from? `null`: not known (yet). */
  locationSource: boolean | null;
}

/**
 * What the rows that lean on a service need to know before they claim a
 * dependency (B10). Unknown is `null` and never "missing": a row that says
 * "Immich ist nicht verbunden" while the question is still on its way, or after
 * it failed, tells the reader the opposite of what may be true.
 */
export function useServiceReadiness(): ServiceReadiness {
  const llm = useHasLlm();
  const [immich, setImmich] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    externalServicesApi
      .accountOverview()
      .then((overview) => {
        if (!live) return;
        const source = overview.connections.find((c) => c.id === "immich")?.effectiveSource;
        setImmich(source === undefined ? null : source === "account" || source === "instance");
      })
      .catch((error: unknown) => logger.warn("Reading the Immich connection failed:", error));
    return () => {
      live = false;
    };
  }, []);
  const [locationSource, setLocationSource] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    locationProviderApi
      .get()
      .then((provider) => live && setLocationSource(provider.kind !== "none"))
      .catch((error: unknown) => logger.warn("Reading the location source failed:", error));
    return () => {
      live = false;
    };
  }, []);
  return { immich, ai: llm === null ? null : llm === true, locationSource };
}
