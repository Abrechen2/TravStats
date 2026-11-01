// Generated once from the designer's settings-data.json (round 2, services page):
// the 31 catalogue entries in their seven groups and the row templates each one
// uses. Copy lives in `settingsRows:services.*` (DE and EN together).

export const SERVICE_GROUPS = ["flug", "karte", "foto", "ki", "open", "sync", "inst"] as const;
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
    id: "adsblol",
    group: "flug",
    use: ["on", "instKey", "test", "quota"],
  },
  {
    id: "adsbx",
    group: "flug",
    use: ["on", "instKey", "test", "quota"],
  },
  {
    id: "aisstream",
    group: "karte",
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
    use: ["on", "instKey", "test"],
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
    use: ["aiConsent", "aiAllow", "instKey", "model", "test"],
  },
  {
    id: "anthropic",
    group: "ki",
    use: ["aiConsent", "aiAllow", "instKey", "model", "test"],
  },
  {
    id: "gemini",
    group: "ki",
    use: ["aiConsent", "aiAllow", "instKey", "model", "test"],
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
    group: "open",
    use: ["on", "instKey", "test"],
  },
  {
    id: "fx",
    group: "open",
    use: ["always"],
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
  {
    id: "updatesTemplates",
    group: "inst",
    use: [],
  },
];
