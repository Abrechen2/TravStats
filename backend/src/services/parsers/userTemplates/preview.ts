import { applyLodgingTemplate } from "../../lodging/templates/engine";
import { applyUserTemplate } from "./engine";
import { parseLodgingSpec } from "./lodgingTemplates";
import type { TemplateDomain, UserTemplate } from "./types";

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
  body: string
): TemplatePreview {
  if (domain === "flight") {
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

  // cruise and place never reach here: nothing derives a template for them,
  // so there is none to preview. Returning the empty result rather than
  // throwing keeps the route's error vocabulary about the REQUEST.
  return EMPTY;
}
