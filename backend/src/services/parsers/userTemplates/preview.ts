import { applyLodgingTemplate } from "../../lodging/templates/engine";
import { applyUserTemplate } from "./engine";
import { matchesFingerprint } from "./matcher";
import { parseLodgingSpec } from "./lodgingTemplates";
import type { TemplateDomain, UserTemplate } from "./types";
import { applyV2CruiseTemplate } from "../../cruise/v2Cruise";
import type { ParsedCruiseStop } from "../../cruiseBookingParser";
import { applyV2PlaceTemplate } from "../../places/v2Place";
import { parsePackageText } from "../../trip/package/parsePackage";
import type { PackageFlight, PackageStay } from "../../trip/package/contract";
import { parseWorkshopEnvelope } from "./v2UserTemplates";

/**
 * Run a derived template against one document and say what it would read.
 *
 * forgejo#124 phase 6, "preview before activation". Until now a template
 * became `active` the moment it was derived, on the strength of its
 * fingerprint having at least one body marker — which says the template
 * MATCHES something, and nothing at all about whether it EXTRACTS anything.
 * That is the plan's §7 trap stated as a default ("a matching template is not
 * an extracting template"), and the result of a bad one is not an error but a
 * proposal a human accepts by habit.
 *
 * So: the same engine the parser would use, against the sample the template
 * came from AND against a held-out sample, with the fields named. Nothing here
 * writes; the caller decides what to do with the answer.
 */

export interface PreviewField {
  name: string;
  /** Rendered for display. A number becomes its own text; nothing is invented. */
  value: string;
}

export interface TemplatePreview {
  /** Did the template claim the document at all? */
  matched: boolean;
  /** What it would propose. Empty on a match that extracted nothing. */
  fields: PreviewField[];
  /** The reader's own confidence, where the domain has one. */
  confidence: number | null;
}

const EMPTY: TemplatePreview = { matched: false, fields: [], confidence: null };

function fieldsOf(source: Record<string, unknown>, skip: readonly string[]): PreviewField[] {
  const fields: PreviewField[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (skip.includes(name)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    fields.push({ name, value: String(value) });
  }
  return fields;
}

/** Bookkeeping the reader adds; it is not something the document said. */
const FLIGHT_SKIP = ["parserTemplate", "parserConfidence", "missing", "fieldSources"];
const LODGING_SKIP = [...FLIGHT_SKIP, "nights"];

export function previewTemplate(
  domain: TemplateDomain,
  template: UserTemplate,
  subject: string,
  body: string,
  /** The address the sample came from, where one is known. */
  fromAddress = ""
): TemplatePreview {
  if (domain === "flight") {
    // The fingerprint FIRST, exactly as `parsers/email.ts` asks it: the
    // parser never applies a template whose fingerprint does not match, so a
    // preview that skipped this would report fields the real parse would
    // never read — a held-out mail from another sender would look like proof
    // the template generalises. The lodging side has always gone through
    // `templateMatches` for the same reason.
    if (!matchesFingerprint(template.fingerprint, fromAddress, subject, body)) return EMPTY;
    const results = applyUserTemplate(template, subject, body);
    const first = results[0];
    if (!first) return EMPTY;
    return {
      matched: true,
      fields: fieldsOf(first as unknown as Record<string, unknown>, FLIGHT_SKIP),
      confidence: first.parserConfidence ?? null,
    };
  }

  if (domain === "lodging") {
    const spec = parseLodgingSpec(template.patterns);
    if (!spec) return EMPTY;
    const hit = applyLodgingTemplate(spec, subject, body);
    // `applyLodgingTemplate` answers null both for "not my sender" and for
    // "mine, but the evidence was not enough". The preview cannot tell those
    // apart and does not pretend to: either way this template would read
    // nothing from this document, which is the thing the user needs to know.
    if (!hit) return EMPTY;
    return {
      matched: true,
      fields: fieldsOf(hit as unknown as Record<string, unknown>, LODGING_SKIP),
      confidence: hit.parserConfidence,
    };
  }

  // Cruise and place templates are v2 envelopes, run by the same consumer the
  // parse uses, on the text the parse builds (subject line first).
  const documentText = subject ? `${subject}\n${body}` : body;
  if (domain === "cruise") {
    const envelope = parseWorkshopEnvelope(template.patterns, "cruise");
    const cruise = envelope ? applyV2CruiseTemplate(envelope, documentText)[0] : undefined;
    if (!cruise) return EMPTY;
    return {
      matched: true,
      fields: [
        ...fieldsOf(cruise as unknown as Record<string, unknown>, CRUISE_SKIP),
        { name: "stops", value: describeStops(cruise.stops) },
      ],
      confidence: cruise.parserConfidence,
    };
  }

  if (domain === "package") {
    // The package reader and its contract, exactly as a parse runs them.
    const envelope = parseWorkshopEnvelope(template.patterns, "package");
    const reading = envelope ? parsePackageText(documentText, [envelope]).reading : null;
    if (!reading) return EMPTY;
    return {
      matched: true,
      fields: [
        ...fieldsOf(reading as unknown as Record<string, unknown>, ["flights", "stays"]),
        { name: "flights", value: describeFlights(reading.flights) },
        { name: "stays", value: describeStays(reading.stays) },
      ],
      confidence: null,
    };
  }

  const envelope = parseWorkshopEnvelope(template.patterns, "place");
  const candidate = envelope ? applyV2PlaceTemplate(envelope, documentText) : null;
  if (!candidate) return EMPTY;
  return {
    matched: true,
    fields: fieldsOf(candidate as unknown as Record<string, unknown>, ["sourceRowIndex"]),
    confidence: null,
  };
}

const CRUISE_SKIP = [...FLIGHT_SKIP, "flights", "stops"];

/** A package's flights as one line: date, number, route. Values only. */
function describeFlights(flights: readonly PackageFlight[]): string {
  return flights
    .map(
      (f) =>
        `${f.date} ${f.flightNumber} ${f.depIata ?? f.depCity ?? "?"}→${f.arrIata ?? f.arrCity ?? "?"}`
    )
    .join(" · ");
}

/** A package's stays as one line: name and nights' span. */
function describeStays(stays: readonly PackageStay[]): string {
  return stays.map((s) => `${s.name} ${s.checkIn}–${s.checkOut}`).join(" · ");
}

/**
 * The stop list as one line: each day's date and port, a dash for a day at
 * sea. Values only — the preview shows what the template read, not copy.
 */
function describeStops(stops: readonly ParsedCruiseStop[]): string {
  return stops
    .map((stop) => [stop.date, stop.isAtSea ? "—" : (stop.portName ?? "?")].join(" "))
    .join(" · ");
}
