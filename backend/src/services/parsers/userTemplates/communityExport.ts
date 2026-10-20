import { workshopEnvelopeSchema, type TemplateEnvelope } from "../templates/v2/envelope";
import { isValidVersion } from "../templates/v2/version";
import type { AnnotationSelection } from "./annotations";

/**
 * A workshop template as a file for the template repository (forgejo#309,
 * spec package 4) — the repository's own v2 envelope, with everything that
 * belongs to the user taken out. Nothing is sent anywhere from here: the
 * client downloads the file and the user proposes it on GitHub, where the
 * owner reviews it.
 *
 * What a workshop template carries that a repository file must not:
 *  - its id (`<domain>:user-<training row id>`) → a slug of the issuer's name;
 *  - the `source: "workshop"` constant → dropped, the repository is the source;
 *  - VALUES OF THE USER'S OWN DOCUMENT. The derivers are built never to write
 *    a marked value into a pattern, but a label line or an anchor is the
 *    document's own text, and a name printed beside a label ("Max Muster
 *    Buchung:") travels with it. So the file is SCANNED for every value the
 *    user marked on the sample (bar the ones naming the issuer, which are the
 *    point of an anchor), for the user's own names and addresses, and for
 *    anything shaped like an e-mail address or a long number. A hit in a
 *    marker, an anchor or a sender domain is removed (and reported); a hit
 *    in the extraction rules or the issuer's name refuses the export — those
 *    cannot be blanked without breaking what the template reads.
 *
 * The file carries no test cases: the only document that proves it is the
 * user's own, which must not travel. The repository requires a match and a
 * decline case, invented, which the reviewer adds (the copy says so).
 */

/**
 * Labels whose marked value names the issuer, its product or a vocabulary
 * word ("EUR", "2. Klasse", "Seetag") — never the traveller. Their values may
 * stand in a template; every other marked value may not.
 */
const NOT_PERSONAL_LABELS = new Set([
  "currency",
  "travelClass",
  "tariff",
  "vehicleClass",
  "seatClass",
  "cabinType",
  "roomCategory",
  "seaDay",
  "operator",
  "provider",
  "cruiseLine",
  "shipName",
  "routeName",
  "airline",
  "vessel",
  "line",
  // A place document's venue (forgejo#124): the museum is the issuer.
  "name",
  "category",
  "address",
  "city",
  "country",
]);

/** The domains whose workshop templates are v2 envelopes — and so can be shared. */
export const EXPORTABLE_DOMAINS = [
  "cruise",
  "place",
  "package",
  "rail",
  "rental",
  "bus",
  "ferry",
] as const;
export type ExportableDomain = (typeof EXPORTABLE_DOMAINS)[number];

export function isExportableDomain(domain: string): domain is ExportableDomain {
  return (EXPORTABLE_DOMAINS as readonly string[]).includes(domain);
}

/** The words the derivers name an issuer by when nothing else names it. */
const PLACEHOLDER_ISSUER_NAMES = new Set([
  "Bahn",
  "Bus",
  "Fähre",
  "Kreuzfahrt",
  "Ort",
  "Reiseveranstalter",
]);

const MIN_LITERAL = 3;
/** Longer for a name: a two- or three-letter username would match ordinary label words. */
const MIN_IDENTITY = 4;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
/** Seven digits in a row: a phone number, an account, a booking number. */
const LONG_NUMBER = /\d{7,}/;

/** A string of the template as the text it matches: regex escapes and whitespace classes undone. */
function literalForm(value: string): string {
  return value
    .replace(/\[ \\t\]\+|\[ \\t\]\*|\\s\+|\\s\*/g, " ")
    .replace(/\\([^A-Za-z0-9])/g, "$1")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const folded = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

/** What must not travel: the user's marked values and identity, folded for comparison. */
export interface PersonalData {
  /** Values the user marked on the sample, with their labels. */
  marked: readonly Pick<AnnotationSelection, "label" | "text">[];
  /** The user's username, names, own addresses — and the sample's sender address. */
  identity: readonly (string | null | undefined)[];
}

export interface PersonalLiteral {
  /** The annotation label, or `identity` / `email` / `number`. */
  kind: string;
  /** Where in the file: `match.anchors[0]`, `extraction.fields.price.patterns[0]`, … */
  path: string;
}

function personalNeedles(data: PersonalData): { kind: string; needle: string }[] {
  const needles: { kind: string; needle: string }[] = [];
  for (const mark of data.marked) {
    if (NOT_PERSONAL_LABELS.has(mark.label)) continue;
    const needle = folded(mark.text);
    if (needle.length >= MIN_LITERAL) needles.push({ kind: mark.label, needle });
  }
  for (const raw of data.identity) {
    if (!raw) continue;
    const value = folded(raw);
    if (value.length >= MIN_IDENTITY) needles.push({ kind: "identity", needle: value });
    // The address's local part is a name as often as not.
    const local = value.includes("@") ? value.slice(0, value.indexOf("@")) : "";
    if (local.length >= MIN_IDENTITY) needles.push({ kind: "identity", needle: local });
  }
  return needles;
}

/** Every personal literal in one string of the file. */
function hitsIn(
  value: string,
  path: string,
  needles: readonly { kind: string; needle: string }[]
): PersonalLiteral[] {
  const text = literalForm(value);
  const hits = needles
    .filter(({ needle }) => text.includes(needle))
    .map(({ kind }) => ({ kind, path }));
  if (EMAIL.test(text)) hits.push({ kind: "email", path });
  if (LONG_NUMBER.test(text)) hits.push({ kind: "number", path });
  return hits;
}

/** Every string leaf of `node`, with its path. */
function* strings(node: unknown, path: string): Generator<[string, string]> {
  if (typeof node === "string") {
    yield [path, node];
  } else if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* strings(item, `${path}[${i}]`);
  } else if (node !== null && typeof node === "object") {
    for (const [key, item] of Object.entries(node)) yield* strings(item, `${path}.${key}`);
  }
}

/** `Probe Fernbus GmbH` → `probe-fernbus-gmbh`; the repository's id and file name. */
export function templateSlug(name: string, domain: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : `${domain}-template`;
}

export type CommunityExportRefusal = "containsPersonalData" | "notExportable";

export type CommunityExport =
  | {
      ok: true;
      template: TemplateEnvelope;
      filename: string;
      /** What was taken out because it held personal data. */
      removed: PersonalLiteral[];
    }
  | { ok: false; refusal: CommunityExportRefusal; found: PersonalLiteral[] };

export interface CommunityExportInput {
  envelope: TemplateEnvelope;
  personal: PersonalData;
  /** The running app's version: the file needs at least it (its domain may be new). */
  appVersion: string;
  /** `YYYY-MM-DD` (UTC) — the file's version, as the repository dates its own. */
  today: string;
}

/** Drop the entries of `list` that hold personal data, and say which they were. */
function scrubList(
  list: readonly string[],
  path: string,
  needles: readonly { kind: string; needle: string }[]
): { kept: string[]; removed: PersonalLiteral[] } {
  const kept: string[] = [];
  const removed: PersonalLiteral[] = [];
  list.forEach((value, i) => {
    const hits = hitsIn(value, `${path}[${i}]`, needles);
    if (hits.length === 0) kept.push(value);
    else removed.push(...hits);
  });
  return { kept, removed };
}

/** Build the repository file, or say why it cannot be built. Pure. */
export function buildCommunityExport(input: CommunityExportInput): CommunityExport {
  const { envelope } = input;
  const needles = personalNeedles(input.personal);

  // What reads the document, and the issuer's name, cannot be blanked.
  const { source: _source, ...fields } = envelope.extraction.fields ?? {};
  const extraction = { ...envelope.extraction, fields };
  const fixed = [
    ...strings(extraction, "extraction"),
    ...strings(envelope.issuer.name, "issuer.name"),
    ...strings(envelope.match.allOf ?? [], "match.allOf"),
    ...strings(envelope.match.anyOf ?? [], "match.anyOf"),
    ...strings(envelope.match.noneOf ?? [], "match.noneOf"),
    ...strings(envelope.match.notBookingIf ?? [], "match.notBookingIf"),
    ...strings(envelope.output ?? {}, "output"),
  ].flatMap(([path, value]) => hitsIn(value, path, needles));
  if (fixed.length > 0) return { ok: false, refusal: "containsPersonalData", found: fixed };

  const markers = scrubList(envelope.match.markers, "match.markers", needles);
  const anchors = scrubList(envelope.match.anchors, "match.anchors", needles);
  const senderDomains = scrubList(
    envelope.issuer.keys?.senderDomains ?? [],
    "issuer.keys.senderDomains",
    needles
  );
  const removed = [...markers.removed, ...anchors.removed, ...senderDomains.removed];
  // Without an anchor the template would claim every document of its domain.
  if (anchors.kept.length + (envelope.match.anyOf?.length ?? 0) === 0) {
    return { ok: false, refusal: "containsPersonalData", found: removed };
  }

  // A deriver that knew no issuer name wrote its domain's word ("Fähre");
  // the issuer's first anchor names the sender better than that.
  const issuerName =
    PLACEHOLDER_ISSUER_NAMES.has(envelope.issuer.name) && anchors.kept[0]
      ? anchors.kept[0]
      : envelope.issuer.name;
  const slug = templateSlug(issuerName, envelope.domain);
  const raw = {
    id: `${envelope.domain}:${slug}`,
    domain: envelope.domain,
    version: input.today.replace(/-/g, "."),
    issuer: {
      name: issuerName,
      kind: envelope.issuer.kind,
      ...(senderDomains.kept.length > 0 ? { keys: { senderDomains: senderDomains.kept } } : {}),
    },
    markets: envelope.markets,
    match: { ...envelope.match, markers: markers.kept, anchors: anchors.kept },
    extraction,
    ...(envelope.output ? { output: envelope.output } : {}),
    testCases: [],
    ...(isValidVersion(input.appVersion) ? { minAppVersion: input.appVersion } : {}),
  };
  const parsed = workshopEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, refusal: "notExportable", found: [] };
  return { ok: true, template: parsed.data, filename: `${slug}.json`, removed };
}

/** Where the user proposes the file: GitHub's "new file" page in the domain's folder. */
export const TEMPLATE_REPO_GITHUB = "https://github.com/Abrechen2/travstats-templates";

export function githubNewFileUrl(domain: string, filename: string): string {
  return `${TEMPLATE_REPO_GITHUB}/new/main/${encodeURIComponent(domain)}?filename=${encodeURIComponent(filename)}`;
}

// ------------------------------------------------------------------ loading

export type CommunityExportOutcome =
  | (Extract<CommunityExport, { ok: true }> & { domain: ExportableDomain; githubUrl: string })
  | {
      ok: false;
      refusal: CommunityExportRefusal | "notFound" | "notActive" | "domainNotExportable";
      found: PersonalLiteral[];
    };
