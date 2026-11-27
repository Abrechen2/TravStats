import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { resolveApiKey } from "../../apiKeyResolver";
import { isServiceDisabledByAdmin } from "../../externalServices/policy";
import { createOpenRouteService } from "./openRouteService";
import { createGraphHopper } from "./graphHopper";
import { createCustomOsrm } from "./customOsrm";
import { createPublicRouting, PUBLIC_ROUTING_BASE } from "./publicRouting";
import { internetAllowed } from "../../internetGate";
import { offReasonFor } from "../../externalServices/policy";
import {
  hostOf,
  requireUseConsent,
  type Disclosure,
  type UseConfirmation,
} from "../../externalServices/useConsent";
import { providerDown, type ProviderDown } from "./providerHealth";
import { ROUTING_OFF, ROUTING_PROVIDER_IDS, RouteProvider, RoutingProviderId } from "./types";

/** Whose credential serves a routing request — decides who pays and who receives the data. */
export type RoutingKeySource = "account" | "instance" | "selfHosted";

/** Why no provider answered; the UI maps it to a concrete setup hint. */
export type RoutingHint = "noProvider" | "selectedUnavailable" | "off";

export interface RoutingResolution {
  provider: RouteProvider | null;
  /** `null` routingProvider is "Automatisch"; "off" is "Aus". */
  mode: "auto" | "explicit" | "off";
  /** The instance's explicit choice, when there is one. */
  selected: RoutingProviderId | null;
  keySource: RoutingKeySource | null;
  hint: RoutingHint | null;
}

const AUTO_ORDER: readonly RoutingProviderId[] = ["openrouteservice", "graphhopper", "custom"];

interface Candidate {
  provider: RouteProvider;
  keySource: RoutingKeySource;
}

async function candidateFor(
  id: RoutingProviderId,
  userId: string | undefined,
  customUrl: string | null,
  ownKeyOnly: boolean
): Promise<Candidate | null> {
  if (id === "custom") {
    if (ownKeyOnly) return null;
    // "Off means off" (forgejo#392): the admin switched self-hosted routing off.
    if (await isServiceDisabledByAdmin("selfHostedRouting")) return null;
    const provider = resolveCustomProvider(customUrl);
    return provider ? { provider, keySource: "selfHosted" } : null;
  }
  // Own key first, then the instance key (apiKeyResolver), with the admin and
  // account locks already applied. A key is resolved ONCE: its source and the
  // provider built from it must agree.
  const resolved = await resolveApiKey(id, userId);
  if (!resolved.key) return null;
  if (ownKeyOnly && resolved.source !== "user") return null;
  const built =
    id === "openrouteservice"
      ? createOpenRouteService(resolved.key)
      : createGraphHopper(resolved.key);
  // An account's own key keeps its health apart from the instance's (providerHealth).
  const provider: RouteProvider =
    resolved.source === "user" && userId ? { ...built, healthScope: `user:${userId}` } : built;
  return { provider, keySource: resolved.source === "user" ? "account" : "instance" };
}

/**
 * Resolves which routing provider, if any, serves THIS user's request, and
 * whose credential it uses.
 *
 * `admin_settings.routing_provider = null` means "Automatisch" (never "Aus"):
 * the first allowed and configured of ORS → GraphHopper → the self-hosted
 * server answers, per request and per user. A personal key therefore works for
 * its owner without any instance key and is never handed to anyone else.
 *
 * An explicit instance provider that is not usable for this user falls back
 * to the user's OWN allowed routing key (never to another provider on the
 * instance's account); with neither, nothing answers and `hint` says why.
 *
 * An EXPLICIT provider has no fallback on its own failure (quota, 401, outage):
 * the failure is reported with its reason instead of silently moving the
 * request — and its bill and data — to someone else. Only "Automatisch" skips
 * a provider that refused the instance lately for the next configured one.
 */
export async function resolveRouting(userId?: string): Promise<RoutingResolution> {
  const adminSettings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { routingProvider: true, routingCustomUrl: true },
  });
  const customUrl = adminSettings?.routingCustomUrl ?? null;
  const raw = adminSettings?.routingProvider ?? null;
  const none = (
    mode: RoutingResolution["mode"],
    selected: RoutingProviderId | null,
    hint: RoutingHint
  ): RoutingResolution => ({ provider: null, mode, selected, keySource: null, hint });

  if (raw === null) {
    // Only providers with a usable key or URL are candidates at all (never ORS
    // without a key). One that refused this instance lately (providerHealth:
    // 401/403/410 or a run of errors) yields to the next configured one — the
    // admin chose "Automatisch", not that provider (#411). With every candidate
    // down, the first answers anyway so its refusal is reported, not hidden.
    let firstDown: Candidate | null = null;
    for (const id of AUTO_ORDER) {
      const c = await candidateFor(id, userId, customUrl, false);
      if (!c) continue;
      if (providerDown(c.provider.id, undefined, c.provider.healthScope) === null) {
        return { provider: c.provider, mode: "auto", selected: null, ...pick(c) };
      }
      firstDown ??= c;
    }
    if (firstDown)
      return { provider: firstDown.provider, mode: "auto", selected: null, ...pick(firstDown) };
    return none("auto", null, "noProvider");
  }

  // "Aus": the admin switched routing off on purpose — distinct from null (Automatisch).
  if (raw === ROUTING_OFF) return none("off", null, "off");

  if (!isRoutingProviderId(raw)) {
    logger.warn(
      { routingProvider: raw },
      "admin_settings.routing_provider holds a value outside the current provider set; treating routing as unconfigured"
    );
    return none("explicit", null, "selectedUnavailable");
  }

  const chosen = await candidateFor(raw, userId, customUrl, false);
  if (chosen)
    return { provider: chosen.provider, mode: "explicit", selected: raw, ...pick(chosen) };

  for (const id of AUTO_ORDER) {
    if (id === raw) continue;
    const own = await candidateFor(id, userId, customUrl, true);
    if (own) return { provider: own.provider, mode: "explicit", selected: raw, ...pick(own) };
  }
  logger.warn(
    { routingProvider: raw },
    "routing_provider is selected but is not usable for this user (checked own key, instance key, URL); treating routing as unconfigured"
  );
  return none("explicit", raw, "selectedUnavailable");
}

function pick(c: Candidate): Pick<RoutingResolution, "keySource" | "hint"> {
  return { keySource: c.keySource, hint: null };
}

/** What the public fallback would send, named before it is used (the stage or leg endpoints). */
export function publicRoutingDisclosure(pointCount = 2): Disclosure {
  return {
    serviceId: "publicRouting",
    host: hostOf(PUBLIC_ROUTING_BASE),
    provider: "osrm",
    location: "cloud",
    fields: ["points"],
    pointCount,
    privacyZonesApplied: null,
  };
}

export type RoutingChoice =
  | { kind: "provider"; provider: RouteProvider }
  | { kind: "none" }
  | { kind: "confirm"; disclosure: Disclosure };

/**
 * The provider that serves this request, or what is missing. Only when NO
 * routing provider is configured (automatic mode, nothing usable) does the
 * public FOSSGIS router come in, and then only after the account confirmed it:
 * without a confirmation (or a stored "Immer") the answer is `confirm` and
 * nothing is sent. An explicit choice, "Aus", the catalogue switch, the account
 * switch and the internet master switch all keep it out.
 */
export async function resolveRouteChoice(
  userId: string | undefined,
  confirmation?: UseConfirmation,
  pointCount = 2
): Promise<RoutingChoice> {
  const r = await resolveRouting(userId);
  if (r.provider) return { kind: "provider", provider: r.provider };
  if (!userId || r.mode !== "auto" || r.hint !== "noProvider") return { kind: "none" };
  if ((await offReasonFor("publicRouting", userId)) !== null) return { kind: "none" };
  if (!(await internetAllowed())) return { kind: "none" };
  const disclosure = publicRoutingDisclosure(pointCount);
  const verdict = await requireUseConsent(userId, disclosure, confirmation);
  if (!verdict.ok) return { kind: "confirm", disclosure: verdict.disclosure };
  return { kind: "provider", provider: createPublicRouting() };
}

/**
 * For callers with nobody to ask (background routing, imports): the configured
 * provider, or the public one only where the account already said "Immer".
 */
export async function resolveRouteProvider(userId?: string): Promise<RouteProvider | null> {
  const choice = await resolveRouteChoice(userId);
  return choice.kind === "provider" ? choice.provider : null;
}

function resolveCustomProvider(baseUrl: string | null): RouteProvider | null {
  if (!baseUrl) {
    // Quiet: in automatic mode an unset URL is the normal case, not a fault.
    return null;
  }

  try {
    return createCustomOsrm(baseUrl);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "admin_settings.routing_custom_url is not a valid URL; treating routing as unconfigured"
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
export async function describeRoutingAvailability(userId?: string): Promise<{
  configured: boolean;
  providerId: RoutingProviderId | null;
  /** The answering provider refuses requests right now (#411): legs fall back to straight. */
  failing: Pick<ProviderDown, "providerId" | "reason"> | null;
}> {
  try {
    const provider = await resolveRouteProvider(userId);
    if (!provider) return { configured: false, providerId: null, failing: null };
    const down = providerDown(provider.id, undefined, provider.healthScope);
    return {
      configured: true,
      providerId: provider.id,
      failing: down ? { providerId: down.providerId, reason: down.reason } : null,
    };
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "failed to determine tour routing availability; reporting unconfigured"
    );
    return { configured: false, providerId: null, failing: null };
  }
}
