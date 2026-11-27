/**
 * "Name it and ask first" for every outbound use that carries an account's own
 * location data (owner, 2026-11-25, rc46 extras): the AI help for an ambiguous
 * suggestion and the map matching of a track. The catalogue switch is the
 * admin's gate; this is the account's, in front of each request.
 *
 * - Nothing leaves before the account confirmed THIS service at THIS target.
 *   A caller builds the disclosure first (service, host, provider, cloud or
 *   LAN, the fields and the number of points it would send, whether privacy
 *   zones were applied) and asks `requireUseConsent`. Without a confirmation
 *   the answer is `confirmationRequired` with that disclosure, and the caller
 *   answers 409 without sending anything.
 * - A confirmation names the target it was given for. "Einmal erlauben"
 *   (`once`) covers the one request; "Immer erlauben" (`always`) is stored per
 *   account and service, bound to the target. A target that changed since —
 *   the admin moved the router, the AI provider changed — asks again.
 * - "Immer" is revoked in Einstellungen → Dienste; the next use asks again.
 */
import type { Response } from "express";
import { isLocalLlmHost } from "../llm/llmEndpoint";
import { updatePrefs, loadPrefs } from "./policy";

/** The 409 code a client answers with the confirmation dialog. */
export const CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED" as const;

/** Where a target runs: on the LAN (a local name or a private address) or in the cloud. */
export function locationOf(url: string): "cloud" | "lan" {
  try {
    return isLocalLlmHost(new URL(url).hostname) ? "lan" : "cloud";
  } catch {
    return "cloud";
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The answer in place of the request: what WOULD be sent, and nothing sent. */
export function sendConfirmationRequired(res: Response, disclosure: Disclosure): void {
  res.status(409).json({
    error: "Confirm what is sent to this service first",
    code: CONFIRMATION_REQUIRED,
    disclosure,
  });
}

/** Thrown where a use needs the account's confirmation first; the route answers 409 with the disclosure. */
export class ConfirmationRequiredError extends Error {
  constructor(readonly disclosure: Disclosure) {
    super("Confirm what is sent to this service first");
    this.name = "ConfirmationRequiredError";
  }
}

export type UseConsentServiceId = "aiSuggestionHelp" | "mapMatching" | "publicRouting";
export const USE_CONSENT_SERVICES: readonly UseConsentServiceId[] = [
  "aiSuggestionHelp",
  "mapMatching",
  "publicRouting",
];

export type Disclosure = {
  serviceId: UseConsentServiceId;
  /** Host the request goes to. */
  host: string;
  /** Provider or engine, e.g. "ollama", "openai", "valhalla". */
  provider: string;
  location: "cloud" | "lan";
  /** The field names the request carries. */
  fields: string[];
  /** How many positions it carries (0 when only names and figures go). */
  pointCount: number;
  /** True when the account's privacy zones were cut out first; null when no position is sent. */
  privacyZonesApplied: boolean | null;
};

export type UseConfirmation = { mode: "once" | "always"; target: string };

export type UseConsentVerdict =
  { ok: true; by: "always" | "once" } | { ok: false; disclosure: Disclosure };

/** The identity of a target a consent is bound to: provider and host together. */
export const targetOf = (d: Pick<Disclosure, "provider" | "host">): string =>
  `${d.provider}@${d.host.toLowerCase()}`;

export async function requireUseConsent(
  userId: string,
  disclosure: Disclosure,
  confirmation: UseConfirmation | undefined
): Promise<UseConsentVerdict> {
  const target = targetOf(disclosure);
  if (confirmation && confirmation.target === target) {
    if (confirmation.mode === "always") {
      await updatePrefs(userId, (prefs) => ({
        ...prefs,
        useConsent: {
          ...prefs.useConsent,
          [disclosure.serviceId]: { at: new Date().toISOString(), destination: target },
        },
      }));
      return { ok: true, by: "always" };
    }
    return { ok: true, by: "once" };
  }
  const stored = (await loadPrefs(userId)).useConsent[disclosure.serviceId];
  if (stored && stored.destination === target) return { ok: true, by: "always" };
  return { ok: false, disclosure };
}

export async function revokeUseConsent(userId: string, serviceId: UseConsentServiceId) {
  await updatePrefs(userId, (prefs) => {
    const { [serviceId]: _gone, ...rest } = prefs.useConsent;
    void _gone;
    return { ...prefs, useConsent: rest };
  });
}

export async function listUseConsents(
  userId: string
): Promise<Array<{ serviceId: string; at: string; target: string }>> {
  const prefs = await loadPrefs(userId);
  return Object.entries(prefs.useConsent).map(([serviceId, v]) => ({
    serviceId,
    at: v.at,
    target: v.destination,
  }));
}
