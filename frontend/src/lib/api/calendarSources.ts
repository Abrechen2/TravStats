import { api } from "./client";

/** Calendar sources of the account (spec 2026-11-23-plugins-and-calendar.md, Part A). */
export type CalendarFailureKind =
  "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl";

export interface CalendarCollection {
  href: string;
  name: string;
}

export interface CalendarSource {
  id: string;
  label: string;
  kind: "ics" | "caldav";
  enabled: boolean;
  icsHost: string | null;
  caldavUrl: string | null;
  caldavUsername: string | null;
  credentialSet: boolean;
  collections: CalendarCollection[];
  lastStatus: string | null;
  lastErrorCode: string | null;
  lastCheckedAt: string | null;
}

export interface CalendarSourceList {
  sources: CalendarSource[];
  blocked: "internet_off" | "service_off" | null;
  /** "Kalenderorte zur Zuordnung nachschlagen" — off by default. */
  geocodeLocations: boolean;
}

export interface CalendarTestResult {
  ok: true;
  events: number;
  from: string;
  to: string;
  skippedRules: number;
}

export type CalendarSourceInput =
  | { kind: "ics"; label: string; icsUrl: string }
  | {
      kind: "caldav";
      label: string;
      url: string;
      username: string;
      password: string;
      collections: CalendarCollection[];
    };

const KINDS: readonly string[] = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
];

/** Codes the page names on their own; any other falls back to the kind. */
const CODES: readonly string[] = [
  "PRIVATE_TARGET",
  "CALENDAR_HTTPS_REQUIRED",
  "CALENDAR_TIMEOUT",
  "CALENDAR_TOO_LARGE",
  "CALENDAR_TOO_MANY_EVENTS",
  "CALENDAR_PARSE",
  "CALENDAR_PARSE_TIMEOUT",
  "CALENDAR_UNSAFE_TIMEZONE",
  "CALENDAR_REDIRECT",
  "CALENDAR_XML_TOO_DEEP",
  "CALENDAR_FOREIGN_HREF",
  "CALENDAR_NO_COLLECTIONS",
  "CALENDAR_EGRESS_INTERNET_OFF",
  "CALENDAR_EGRESS_SERVICE_OFF",
  "CALENDAR_SOURCE_LIMIT",
];

/**
 * The i18n key (namespace `suggestionSources`) for a stored status or a failed
 * request: the specific case first, then the fixed kind, then a neutral line —
 * never the server's prose.
 */
export function calendarFailureKey(kind: unknown, code: unknown): string {
  if (typeof code === "string" && CODES.includes(code)) return `calendar.failure.code.${code}`;
  if (typeof kind === "string" && KINDS.includes(kind)) return `calendar.failure.kind.${kind}`;
  return "calendar.failure.unknown";
}

/** The failure key of a rejected request. */
export function calendarRequestFailureKey(error: unknown): string {
  const data = (error as { response?: { data?: { error?: unknown; code?: unknown } } })?.response
    ?.data;
  return calendarFailureKey(data?.error, data?.code);
}

export interface CalendarRule {
  kind: "calendar" | "keyword";
  sourceId: string | null;
  token: string | null;
  matchMode: "contains" | "startsWith";
  purpose: "private" | "business" | null;
  nameTemplate: string | null;
  placeId: string | null;
}

export const calendarSourcesApi = {
  async setGeocodeLocations(geocodeLocations: boolean): Promise<boolean> {
    const { data } = await api.patch("/settings/calendar-sources/preferences", {
      geocodeLocations,
    });
    return data.geocodeLocations;
  },
  async rules(): Promise<CalendarRule[]> {
    const { data } = await api.get("/settings/calendar-sources/rules");
    return data.rules;
  },
  async saveRules(rules: CalendarRule[]): Promise<CalendarRule[]> {
    const { data } = await api.put("/settings/calendar-sources/rules", { rules });
    return data.rules;
  },
  async list(): Promise<CalendarSourceList> {
    const { data } = await api.get("/settings/calendar-sources");
    return data;
  },
  async add(input: CalendarSourceInput): Promise<CalendarSource> {
    const { data } = await api.post("/settings/calendar-sources", input);
    return data;
  },
  async update(
    id: string,
    patch: Partial<{
      label: string;
      enabled: boolean;
      icsUrl: string;
      url: string;
      username: string;
      password: string;
      collections: CalendarCollection[];
    }>
  ): Promise<CalendarSource> {
    const { data } = await api.patch(`/settings/calendar-sources/${id}`, patch);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/settings/calendar-sources/${id}`);
  },
  async test(id: string): Promise<CalendarTestResult> {
    const { data } = await api.post(`/settings/calendar-sources/${id}/test`, {});
    return data;
  },
  async discover(input: {
    url: string;
    username: string;
    password: string;
  }): Promise<CalendarCollection[]> {
    const { data } = await api.post("/settings/calendar-sources/caldav/discover", input);
    return data.collections;
  },
};
