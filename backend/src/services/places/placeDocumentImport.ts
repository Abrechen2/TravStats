import type { PLACE_DOCUMENT_FALLBACKS, PlaceImportCandidate } from "../../schemas/placeImport";
import { templateRegistry } from "../parsers/templates/registry";
import { remainingBudgetMs, withParseBudget } from "../parsers/templates/v2/budget";
import { loadActiveWorkshopTemplates } from "../parsers/userTemplates/v2UserTemplates";
import { readWithV2PlaceTemplates } from "./v2Place";

/**
 * Why a place document produced no candidate — a stable code the client words
 * in German and English, never prose:
 *  - `noTemplate`     no place template is active for this user at all, so
 *                     nothing could have read it (the workshop makes one);
 *  - `notRecognised`  templates ran and none recognised the document;
 *  - `timedOut`       the document's template time budget ran out first.
 */
export type PlaceDocumentFallback = (typeof PLACE_DOCUMENT_FALLBACKS)[number];

export interface PlaceDocumentReading {
  candidates: PlaceImportCandidate[];
  /** The template that read it, when one did. */
  templateId: string | null;
  fallbackCode?: PlaceDocumentFallback;
}

/**
 * Read a place document — a museum ticket, a tour booking — with the place
 * templates there are (forgejo#124): repository templates first, then the
 * user's own active workshop templates. Nothing is written; the candidate goes
 * to the place import preview the user confirms.
 *
 * The subject, where there is one, is the first line, exactly as the parse
 * pipeline joins it for every other domain.
 */
export function readPlaceDocument(
  userId: string,
  text: string,
  subject?: string
): Promise<PlaceDocumentReading> {
  return withParseBudget(async () => {
    const templates = [
      ...templateRegistry.getActiveV2({ domain: "place" }),
      ...(await loadActiveWorkshopTemplates(userId, "place")),
    ];
    if (templates.length === 0) {
      return { candidates: [], templateId: null, fallbackCode: "noTemplate" };
    }
    const documentText = subject ? `${subject}\n\n${text}` : text;
    const hit = readWithV2PlaceTemplates(templates, documentText);
    if (hit) return { candidates: [hit.candidate], templateId: hit.templateId };
    return {
      candidates: [],
      templateId: null,
      fallbackCode: remainingBudgetMs() === 0 ? "timedOut" : "notRecognised",
    };
  });
}
