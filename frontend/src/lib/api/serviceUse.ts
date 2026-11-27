import { isAxiosError } from "axios";
import { api } from "./client";

/** What the server says it WOULD send, before anything is sent (owner, 2026-11-25). */
export interface ServiceDisclosure {
  serviceId: "aiSuggestionHelp" | "mapMatching" | "publicRouting";
  host: string;
  provider: string;
  location: "cloud" | "lan";
  fields: string[];
  pointCount: number;
  privacyZonesApplied: boolean | null;
}

export interface UseConfirmation {
  mode: "once" | "always";
  /** `provider@host` the confirmation was given for; a changed target asks again. */
  target: string;
}

export const CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED";

/** How often one action may ask before a still-changing target is reported instead. */
const MAX_ASKS = 2;

/** The person closed the confirmation without allowing: nothing was sent. */
export class UseCancelledError extends Error {
  constructor() {
    super("The outbound use was not confirmed");
    this.name = "UseCancelledError";
  }
}

export function disclosureOf(error: unknown): ServiceDisclosure | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as { code?: string; disclosure?: ServiceDisclosure } | undefined;
  return data?.code === CONFIRMATION_REQUIRED && data.disclosure ? data.disclosure : null;
}

/**
 * Run `send` and, when the server asks for a confirmation first, ask the
 * person (`ask`) and send once more with their answer. A cancelled dialog
 * throws `UseCancelledError` and sends nothing further. A second request for
 * confirmation (the target changed between the two calls) asks again.
 */
export async function withUseConsent<T>(
  send: (confirmation?: UseConfirmation) => Promise<T>,
  ask: (disclosure: ServiceDisclosure) => Promise<UseConfirmation | null>
): Promise<T> {
  let confirmation: UseConfirmation | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(confirmation);
    } catch (error) {
      const disclosure = disclosureOf(error);
      // A target that keeps changing under the person is not asked about forever: the third
      // refusal is shown as itself instead of opening a dialog whose answer would be thrown away.
      if (!disclosure || attempt >= MAX_ASKS + 1) throw error;
      const answer = await ask(disclosure);
      if (!answer) throw new UseCancelledError();
      confirmation = answer;
    }
  }
}

export interface UseConsentRow {
  serviceId: string;
  at: string;
  target: string;
}

export const serviceUseApi = {
  list: async (): Promise<UseConsentRow[]> => {
    const { data } = await api.get<{ consents: UseConsentRow[] }>(
      "/settings/external-services/use-consents"
    );
    return data.consents;
  },
  revoke: async (serviceId: string): Promise<void> => {
    await api.delete(`/settings/external-services/use-consents/${serviceId}`);
  },
};
