import type {
  AccountAiConsent,
  AccountService,
  AdminService,
  InstanceProvidedService,
} from "../../lib/api/externalServices";
import type { ServiceCardDef } from "./serviceCards";

/** The pills of the design (§5.4) plus "needsConsent" for a released AI provider. */
export type CardStatus =
  | "viaServer"
  | "notSetUp"
  | "off"
  | "on"
  | "always"
  | "notConnected"
  | "connected"
  | "ready"
  | "notEnabled"
  | "needsConsent"
  | "keyRejected"
  | "offByAdmin";

export type CardTone = "good" | "muted" | "warn" | "bad";

export interface CardStatusInput {
  card: ServiceCardDef;
  isAdmin: boolean;
  account?: AccountService;
  consent?: AccountAiConsent;
  provided?: InstanceProvidedService;
  admin?: AdminService;
}

const TONE: Record<CardStatus, CardTone> = {
  viaServer: "good",
  notSetUp: "muted",
  off: "muted",
  on: "good",
  always: "good",
  notConnected: "muted",
  connected: "good",
  ready: "good",
  notEnabled: "muted",
  needsConsent: "warn",
  keyRejected: "bad",
  offByAdmin: "warn",
};

export const toneOf = (status: CardStatus): CardTone => TONE[status];

/**
 * One word for the card, from what the two sides report. The server's switch
 * wins over everything an account chose; "Schlüssel abgelehnt" is only said of
 * a credential the last test really refused.
 */
export function cardStatus(input: CardStatusInput): CardStatus {
  const { card, isAdmin, account, consent, provided, admin } = input;
  const uses = (t: string): boolean => (card.use as readonly string[]).includes(t);
  if (uses("always")) return "always";

  const tested =
    account?.effectiveSource === "account" ? account.lastTest : (admin?.lastTest ?? null);
  if (tested && !tested.ok && tested.reason === "auth") return "keyRejected";

  const switchedOffByAdmin =
    (isAdmin ? admin !== undefined && !admin.enabled : provided?.enabled === false) ||
    (account?.effectiveSource === "off" && !account.accountDisabled);
  if (switchedOffByAdmin) return isAdmin ? "off" : "offByAdmin";
  if (account?.accountDisabled) return "off";

  if (uses("aiConsent")) {
    if (consent?.consentedAt) return "ready";
    if (isAdmin ? admin?.consent?.allowedByAdmin : consent !== undefined) return "needsConsent";
    return "notEnabled";
  }
  if (account) {
    const connection = uses("allowConn");
    if (account.effectiveSource === "account") return "connected";
    if (account.effectiveSource === "instance") return "viaServer";
    return connection ? "notConnected" : "notSetUp";
  }
  if (admin) {
    if (!admin.configured && !admin.keyless) return "notSetUp";
    return card.id === "ollama" ? "ready" : "on";
  }
  if (provided) return provided.enabled ? (card.id === "ollama" ? "ready" : "on") : "offByAdmin";
  return "notSetUp";
}
