// Generated once from the designer's settings-data.json (round 2, services page):
// the 31 catalogue entries in their seven groups and the row templates each one
// uses. Copy lives in `settingsRows:services.*` (DE and EN together).

export const SERVICE_GROUPS = ["flug", "ki", "foto", "karte", "sync", "open", "inst"] as const;
export type ServiceGroup = (typeof SERVICE_GROUPS)[number];

/** The row templates of the design (`tpl`). */
export type ServiceTemplate =
  | "ownKey"
  | "mine"
  | "on"
  | "instKey"
  | "allowKeys"
  | "allowConn"
  | "test"
  | "quota"
  | "always"
  | "aiAllow"
  | "aiConsent"
  | "model";

/**
 * Cards the server's page keeps behind the expert level only: what is left of the
 * calls behind "Server darf externe Dienste abfragen" once the master switch took
 * over the exchange-rate fallback, the two rail sources, the operator logos and
 * the update check (settings v3 S6): the rail contact address and the open-data
 * switch, which stays because it is off by default.
 */
export const FOLDED_INTO_INTERNET: ReadonlySet<string> = new Set(["railTimetables", "openData"]);

/** Cards whose "on" switch the master internet switch gates. */
export const INTERNET_GATED_SWITCH_CARDS: ReadonlySet<string> = new Set(["openData"]);

/**
 * Cards that moved to a page of their own (settings v3 S5): E-Mail, Datenschutz,
 * Server-Verbindungen, Eigene Server. They are not on the grid any more.
 */
export const MOVED_TO_OWN_PAGE: ReadonlySet<string> = new Set([
  "smtp",
  "push",
  "usageStats",
  "federation",
  "geocoder",
  "selfHostedRouting",
]);

export interface ServiceCardDef {
  /** The catalogue id. */
  id: string;
  group: ServiceGroup;
  /** Which templates the card has: exactly the capabilities the catalogue gives (R7). */
  use: readonly ServiceTemplate[];
}

export const SERVICE_CARDS: readonly ServiceCardDef[] = [
  {
    id: "airlabs",
    group: "flug",
    use: ["ownKey", "mine", "on", "instKey", "allowKeys", "test", "quota"],
  },
  {
    id: "aviationstack",
    group: "flug",
    use: ["ownKey", "mine", "on", "instKey", "allowKeys", "test", "quota"],
  },
  {
    id: "aerodatabox",
    group: "flug",
    use: ["ownKey", "mine", "on", "instKey", "allowKeys", "test", "quota"],
  },
  {
    id: "aeroapi",
    group: "flug",
    use: ["on", "instKey", "test"],
  },
  {
    id: "opensky",
    group: "flug",
    use: ["mine", "on", "allowKeys", "test", "quota"],
  },
  {
    id: "adsbx",
    group: "flug",
    use: ["on", "instKey", "test", "quota"],
  },
  {
    id: "adsblol",
    group: "flug",
    use: ["on", "instKey", "test", "quota"],
  },
  {
    id: "aisstream",
    group: "flug",
    use: ["on", "instKey"],
  },
  {
    id: "openrouteservice",
    group: "karte",
    use: ["ownKey", "mine", "on", "instKey", "allowKeys", "test"],
  },
  {
    id: "graphhopper",
    group: "karte",
    use: ["ownKey", "mine", "on", "instKey", "allowKeys", "test"],
  },
  {
    id: "railTimetables",
    group: "karte",
    use: [],
  },
  {
    id: "googlePlaces",
    group: "karte",
    use: ["ownKey", "mine", "on", "instKey", "allowKeys", "test"],
  },
  {
    id: "geocoder",
    group: "karte",
    use: ["always"],
  },
  {
    id: "selfHostedRouting",
    group: "karte",
    use: ["on"],
  },
  {
    id: "immich",
    group: "foto",
    use: ["mine", "allowConn", "on"],
  },
  {
    id: "dawarich",
    group: "foto",
    use: ["mine", "allowConn", "on"],
  },
  {
    id: "strava",
    group: "foto",
    use: ["mine", "allowConn", "on"],
  },
  {
    id: "ollama",
    group: "ki",
    use: ["on", "test"],
  },
  {
    id: "openai",
    group: "ki",
    use: ["aiConsent", "ownKey", "aiAllow", "instKey", "allowKeys", "model", "test"],
  },
  {
    id: "anthropic",
    group: "ki",
    use: ["aiConsent", "ownKey", "aiAllow", "instKey", "allowKeys", "model", "test"],
  },
  {
    id: "gemini",
    group: "ki",
    use: ["aiConsent", "ownKey", "aiAllow", "instKey", "allowKeys", "model", "test"],
  },
  {
    id: "customLlm",
    group: "ki",
    use: ["aiConsent", "aiAllow", "instKey", "model", "test"],
  },
  {
    id: "openData",
    group: "open",
    use: ["on"],
  },
  {
    id: "logos",
    group: "karte",
    use: ["on", "instKey", "test"],
  },
  {
    id: "webdav",
    group: "sync",
    use: ["mine", "allowConn", "on"],
  },
  {
    id: "smtp",
    group: "sync",
    use: [],
  },
  {
    id: "push",
    group: "sync",
    use: [],
  },
  {
    id: "federation",
    group: "inst",
    use: [],
  },
  {
    id: "usageStats",
    group: "inst",
    use: [],
  },
];

/** Whether the card has anything for the account itself to do. */
export const hasAccountRows = (card: ServiceCardDef): boolean =>
  (["mine", "ownKey", "aiConsent", "allowConn"] as const).some((u) =>
    (card.use as readonly string[]).includes(u)
  );

/** The cards of the account's page (prototype `own:1`), in catalogue order. */
export const ACCOUNT_CARDS: readonly ServiceCardDef[] = SERVICE_CARDS.filter(hasAccountRows);

/**
 * The cards of the server's page: the grid of the prototype, then — expert
 * only — the cards whose switches the master switch folds.
 */
export const SERVER_CARDS: readonly ServiceCardDef[] = SERVICE_CARDS.filter(
  (c) => !MOVED_TO_OWN_PAGE.has(c.id)
);
