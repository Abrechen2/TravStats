import type {
  AccountAiConsent,
  AccountService,
  AdminService,
  InstanceProvidedService,
  AccountRouting,
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
  | "keyStored"
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
  routing?: AccountRouting;
}

const TONE: Record<CardStatus, CardTone> = {
  viaServer: "good",
  notSetUp: "muted",
  off: "muted",
  on: "good",
  always: "good",
  notConnected: "muted",
  connected: "good",
  keyStored: "muted",
  ready: "good",
  notEnabled: "muted",
  needsConsent: "warn",
  keyRejected: "bad",
  offByAdmin: "warn",
};

/** Cards whose own key only counts once routing resolves to it. */
export const ROUTING_KEY_CARDS: ReadonlySet<string> = new Set(["openrouteservice", "graphhopper"]);

export const toneOf = (status: CardStatus): CardTone => TONE[status];

/**
 * One word for the card, from what the two sides report. The server's switch
 * wins over everything an account chose; "Schlüssel abgelehnt" is only said of
 * a credential the last test really refused.
 */
export function cardStatus(input: CardStatusInput): CardStatus {
  const { card, isAdmin, account, consent, provided, admin, routing } = input;
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
    if (account.effectiveSource === "account") {
      // A routing key is "Verbunden" only while routing really uses it and a test
      // said it works; an unused or untested key is just stored.
      if (ROUTING_KEY_CARDS.has(card.id)) {
        const used = routing?.providerId === card.id && routing.keySource === "account";
        return used && account.lastTest?.ok ? "connected" : "keyStored";
      }
      return "connected";
    }
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
