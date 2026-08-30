import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { getApiKey } from "../../apiKeyResolver";
import { createOpenRouteService } from "./openRouteService";
import { createGraphHopper } from "./graphHopper";
import { createCustomOsrm } from "./customOsrm";
import { ROUTING_PROVIDER_IDS, RouteProvider, RoutingProviderId } from "./types";

/**
 * Resolves which routing provider, if any, is actually usable right now.
 *
 * The rule this module exists to enforce: a provider that is SELECTED in
 * `admin_settings.routing_provider` but not USABLE must read as
 * unconfigured. `routingProvider = "openrouteservice"` with no key anywhere
 * (user, admin global, or ENV — see `apiKeyResolver.getApiKey`) is NOT
 * configured: handing back a provider that will 401 on every call would
 * offer the UI a control whose only outcome is an error. Likewise
 * `routingProvider = "custom"` with no URL, or a URL `createCustomOsrm`
 * rejects, is not configured — that factory throws at construction on a
 * malformed base URL by design, so this resolver MUST catch it and return
 * `null` rather than let it escape as an unhandled rejection.
 *
 * There is deliberately no per-user `routingProvider`/`routingCustomUrl` —
 * both live only on `AdminSettings` (see `prisma/schema.prisma`); only the
 * API keys resolve per-user via `getApiKey`. `userId` is accepted here only
 * to thread through to that per-user key lookup.
 */
export async function resolveRouteProvider(userId?: string): Promise<RouteProvider | null> {
  const adminSettings = await prisma.adminSettings.findFirst({
    select: { routingProvider: true, routingCustomUrl: true },
  });

  const selected = adminSettings?.routingProvider ?? null;
  if (selected === null) {
    return null;
  }

  if (!isRoutingProviderId(selected)) {
    logger.warn(
      { routingProvider: selected },
      "admin_settings.routing_provider holds a value outside the current provider set; treating routing as unconfigured",
    );
    return null;
  }

  if (selected === "custom") {
    return resolveCustomProvider(adminSettings?.routingCustomUrl ?? null);
  }

  // Narrowed to "openrouteservice" | "graphhopper" by the branch above.
  const apiKey = await getApiKey(selected, userId);
  if (!apiKey) {
    logger.warn(
      { routingProvider: selected },
      "routing_provider is selected but no API key is configured for it (checked user, admin global, and ENV); treating routing as unconfigured",
    );
    return null;
  }

  return selected === "openrouteservice"
    ? createOpenRouteService(apiKey)
    : createGraphHopper(apiKey);
}

function resolveCustomProvider(baseUrl: string | null): RouteProvider | null {
  if (!baseUrl) {
    logger.warn(
      "routing_provider is \"custom\" but admin_settings.routing_custom_url is not set; treating routing as unconfigured",
    );
    return null;
  }

  try {
    return createCustomOsrm(baseUrl);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "admin_settings.routing_custom_url is not a valid URL; treating routing as unconfigured",
    );
    return null;
  }
}

function isRoutingProviderId(value: string): value is RoutingProviderId {
  return (ROUTING_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * What the UI asks to decide whether to offer routing at all. Must never
 * throw and must never leak a key or a URL — only whether routing works and
 * which provider answers it.
 */
export async function describeRoutingAvailability(
  userId?: string,
): Promise<{ configured: boolean; providerId: RoutingProviderId | null }> {
  try {
    const provider = await resolveRouteProvider(userId);
    return provider
      ? { configured: true, providerId: provider.id }
      : { configured: false, providerId: null };
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "failed to determine tour routing availability; reporting unconfigured",
    );
    return { configured: false, providerId: null };
  }
}
