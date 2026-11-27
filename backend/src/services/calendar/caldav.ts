/**
 * The CalDAV half of the calendar source (RFC 4791), read-only: find the
 * account's calendar collections, and read the events of one window from a
 * collection with a `time-range` REPORT. The server's answer is untrusted
 * XML: a DOCTYPE is refused outright (no entity tricks), its nesting depth is
 * capped before the parser builds anything, and every href it names must stay
 * on the origin the user configured — a server cannot point the next request
 * at another host.
 */
import { XMLParser } from "fast-xml-parser";
import { boundedFetch, type FetchLike } from "../egress/boundedFetch";
import { plainHttpAllowed, type TargetPolicy } from "../egress/privateTargets";
import { CalendarError, calendarErrorOfStatus } from "./errors";

export const CALDAV_TIMEOUT_MS = 20_000;
export const CALDAV_MAX_BYTES = 5 * 1024 * 1024;
export const XML_MAX_DEPTH = 32;
/** calendar-data texts one REPORT may answer with; more is refused, not cut. */
export const MAX_TEXTS_PER_REPORT = 2_000;
const MAX_COLLECTIONS = 50;

export interface CaldavCredentials {
  url: string;
  username: string;
  password: string;
}

export interface CaldavCollection {
  href: string;
  name: string;
}

const DAV_HEADERS = (c: CaldavCredentials, depth: "0" | "1") => ({
  Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}`,
  "Content-Type": "application/xml; charset=utf-8",
  Depth: depth,
});

/** Refuse a DOCTYPE and a nesting deeper than the cap, before any tree is built. */
export function assertXmlBounded(xml: string, maxDepth = XML_MAX_DEPTH): void {
  // CDATA is character data: iCloud wraps every calendar-data in it, and an event's
  // description may carry `<mailto:…>` or a whole HTML mail with its own DOCTYPE. Neither is
  // markup, so neither may count as nesting or as a DOCTYPE of the answer itself.
  const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(markup)) throw new CalendarError("protocol", "CALENDAR_PARSE");
  let depth = 0;
  const tag = /<(\/?)([^\s>/!?]+)[^>]*?(\/?)>/g;
  for (let m = tag.exec(markup); m; m = tag.exec(markup)) {
    if (m[1]) depth--;
    else if (!m[3]) {
      depth++;
      if (depth > maxDepth) throw new CalendarError("protocol", "CALENDAR_XML_TOO_DEEP");
    }
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "response" || name === "propstat" || name === "href",
  processEntities: true,
  htmlEntities: false,
});

type Node = Record<string, unknown>;
const asNode = (v: unknown): Node => (v && typeof v === "object" ? (v as Node) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const text = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : typeof v === "number"
      ? String(v)
      : v && typeof v === "object" && "#text" in v
        ? text((v as Node)["#text"])
        : null;

/** The `<response>` elements of a multistatus body, each with its href and OK props. */
function responses(xml: string): Array<{ href: string; prop: Node }> {
  assertXmlBounded(xml);
  let doc: Node;
  try {
    doc = asNode(parser.parse(xml));
  } catch {
    throw new CalendarError("protocol", "CALENDAR_PARSE");
  }
  // An empty collection answers `<multistatus/>`, which parses to "": present, and no responses.
  if (!("multistatus" in doc)) throw new CalendarError("protocol", "CALENDAR_PARSE");
  const multi = asNode(doc.multistatus);
  return list(multi.response).flatMap((r) => {
    const node = asNode(r);
    const href = text(list(node.href)[0]);
    if (!href) return [];
    const ok = list(node.propstat)
      .map(asNode)
      .filter((p) => /\s200\s/.test(` ${text(p.status) ?? "HTTP/1.1 200 OK"} `));
    const prop = Object.assign({}, ...ok.map((p) => asNode(p.prop))) as Node;
    return [{ href, prop }];
  });
}

/** Second-level labels under which the registrable domain has three labels (no PSL dependency). */
const MULTI_PART_SUFFIX_SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu"]);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The registrable domain of a host (`p42-caldav.icloud.com` -> `icloud.com`), or null for an IP/bare label. */
export function registrableDomain(host: string): string | null {
  if (host.includes(":") || IPV4.test(host)) return null;
  const labels = host.toLowerCase().split(".");
  if (labels.length < 2 || labels.some((l) => l === "")) return null;
  const twoLevel = labels.length >= 3 && labels[labels.length - 1].length === 2;
  const take = twoLevel && MULTI_PART_SUFFIX_SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.length < take ? null : labels.slice(-take).join(".");
}

/**
 * An href of the server's answer, absolute — on the configured origin, or on
 * another https host of the same registrable domain (iCloud answers
 * caldav.icloud.com with p42-caldav.icloud.com). Anything else is refused.
 */
export function resolveHref(base: string, href: string, relativeTo: string = base): string {
  let resolved: URL;
  let origin: URL;
  try {
    resolved = new URL(href, relativeTo);
    origin = new URL(base);
  } catch {
    throw new CalendarError("protocol", "CALENDAR_FOREIGN_HREF");
  }
  if (resolved.origin === origin.origin) return resolved.toString();
  const domain = registrableDomain(origin.hostname);
  const sameSite =
    domain !== null &&
    resolved.protocol === "https:" &&
    origin.protocol === "https:" &&
    resolved.port === origin.port &&
    resolved.username === "" &&
    registrableDomain(resolved.hostname) === domain;
  if (!sameSite) throw new CalendarError("protocol", "CALENDAR_FOREIGN_HREF");
  return resolved.toString();
}

async function dav(
  url: string,
  method: "PROPFIND" | "REPORT",
  depth: "0" | "1",
  body: string,
  c: CaldavCredentials,
  policy: TargetPolicy,
  fetchImpl?: FetchLike,
  timeoutMs: number = CALDAV_TIMEOUT_MS
): Promise<string> {
  const res = await boundedFetch(
    url,
    {
      method,
      headers: DAV_HEADERS(c, depth),
      body,
      policy,
      timeoutMs,
      httpsOnly: !plainHttpAllowed(url, policy),
      maxBytes: CALDAV_MAX_BYTES,
    },
    fetchImpl
  );
  const failed = calendarErrorOfStatus(res.status);
  if (failed) throw failed;
  return res.body.toString("utf8");
}

const PROP = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${inner}</d:prop></d:propfind>`;

const hrefIn = (prop: Node, name: string): string | null => text(list(asNode(prop[name]).href)[0]);

const isCalendar = (prop: Node) => "calendar" in asNode(prop.resourcetype);
const takesEvents = (prop: Node) => {
  const set = asNode(prop["supported-calendar-component-set"]);
  // Not announced: a calendar takes events.
  if (!("comp" in set)) return true;
  return list(set.comp).some((c) => text(asNode(c)["@_name"])?.toUpperCase() === "VEVENT");
};

/**
 * The account's calendars: current-user-principal → calendar-home-set → its
 * children. A URL that already names a calendar collection answers itself.
 */
export async function discoverCollections(
  c: CaldavCredentials,
  policy: TargetPolicy,
  fetchImpl?: FetchLike
): Promise<CaldavCollection[]> {
  const self = responses(
    await dav(
      c.url,
      "PROPFIND",
      "0",
      PROP("<d:resourcetype/><d:displayname/><d:current-user-principal/>"),
      c,
      policy,
      fetchImpl
    )
  );
  const own = self[0]?.prop ?? {};
  if (isCalendar(own))
    return [{ href: resolveHref(c.url, self[0].href), name: text(own.displayname) ?? "" }];
  const principalHref = hrefIn(own, "current-user-principal");
  const principal = principalHref ? resolveHref(c.url, principalHref) : c.url;
  const home = responses(
    await dav(principal, "PROPFIND", "0", PROP("<c:calendar-home-set/>"), c, policy, fetchImpl)
  );
  const homeHref = home[0] ? hrefIn(home[0].prop, "calendar-home-set") : null;
  if (!homeHref) throw new CalendarError("notFound", "CALENDAR_NO_COLLECTIONS");
  const homeUrl = resolveHref(c.url, homeHref);
  const children = responses(
    await dav(
      homeUrl,
      "PROPFIND",
      "1",
      PROP("<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>"),
      c,
      policy,
      fetchImpl
    )
  );
  const found = children
    .filter((r) => isCalendar(r.prop) && takesEvents(r.prop))
    .slice(0, MAX_COLLECTIONS)
    .map((r) => ({
      // Relative to the home set: on iCloud that is the switched host.
      href: resolveHref(c.url, r.href, homeUrl),
      name: (text(r.prop.displayname) ?? "").slice(0, 120),
    }));
  if (found.length === 0) throw new CalendarError("notFound", "CALENDAR_NO_COLLECTIONS");
  return found;
}

const caldavTime = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** The iCalendar texts of one collection's events that touch the window. */
export async function queryCollection(
  c: CaldavCredentials,
  collectionHref: string,
  window: { fromMs: number; untilMs: number },
  policy: TargetPolicy,
  fetchImpl?: FetchLike,
  timeoutMs: number = CALDAV_TIMEOUT_MS
): Promise<string[]> {
  const url = resolveHref(c.url, collectionHref);
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
    `<d:prop><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${caldavTime(window.fromMs)}" end="${caldavTime(window.untilMs)}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const xml = await dav(url, "REPORT", "1", body, c, policy, fetchImpl, timeoutMs);
  const texts = responses(xml).flatMap((r) => {
    const data = text(r.prop["calendar-data"]);
    return data ? [data] : [];
  });
  if (texts.length > MAX_TEXTS_PER_REPORT)
    throw new CalendarError("protocol", "CALENDAR_TOO_MANY_EVENTS");
  return texts;
}
