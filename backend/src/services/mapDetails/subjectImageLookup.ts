/**
 * A picture of what a journey travelled IN, for the map's hover profile
 * (owner, 2026-10-21): a ferry's vessel, a rental's car model, a train
 * category. From Wikidata and Wikimedia Commons, server side, through the same
 * polite queue and the same licence rule as the operator logos
 * (`operatorLogos/wikidataOperator.ts`):
 *
 * 1. Items whose label or alias IS the name — never the first fuzzy hit.
 * 2. Of those, only an item whose description says it is the right KIND of
 *    thing. "ICE" is also a US agency and "Golf" a sport; a wrong picture is
 *    worse than none.
 * 3. Its image (P18), honouring ranks; Commons file with a FREE licence only,
 *    credited; Commons' own raster thumbnail, never the original file.
 *
 * Every miss says why; the caller turns any miss into "no picture".
 */
import { z } from "zod";
import { getBytes, getJson } from "../operatorLogos/wikimedia";
import {
  RASTER_TYPES,
  WIKIDATA_API,
  bestStringClaim,
  commonsFile,
  exactItems,
  url,
  type OperatorMarkCredit,
  type OperatorMarkImage,
  type OperatorMarkMiss,
} from "../operatorLogos/wikidataOperator";

export const SUBJECT_KINDS = ["vessel", "vehicle", "train"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** Whom to credit — the operator-logo credit without a brand colour. */
export type SubjectImageCredit = Omit<OperatorMarkCredit, "colour">;

export type SubjectImageLookup =
  | { ok: true; credit: SubjectImageCredit; image: OperatorMarkImage }
  | { ok: false; reason: OperatorMarkMiss | "wrongKind" };

/** A 320 px thumbnail: a tooltip draws it at ~140 px, a card at 2×. */
export const SUBJECT_THUMB_WIDTH = 320;

/** What an item's description must say for each kind (EN or DE). */
const KIND_WORDS: Record<SubjectKind, RegExp> = {
  vessel:
    /\b(ship|ferry|vessel|cruiseferry|ro-?pax|catamaran|hovercraft|schiff|fähre|fährschiff|fahrgastschiff|katamaran)/i,
  vehicle:
    /\b(automobile|car|cars|vehicle|suv|hatchback|sedan|saloon|minivan|automobil|pkw|kleinwagen|kompaktwagen|automodell|fahrzeug|kombi|limousine)\b/i,
  train:
    /\b(train|trains|railway|rail service|railcar|multiple unit|locomotive|high-speed rail|zug|züge|zuggattung|triebzug|triebwagen|lokomotive|hochgeschwindigkeitszug|fernverkehr)/i,
};

/** Rental vouchers say "VW Golf or similar"; the model is the part before. */
const SIMILAR =
  /\s*(\bor similar\b|\boder ähnlich\b|\bo\.\s?ä\.?|\bor equivalent\b|\bo similar\b).*$/i;
const BRAND_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/^vw\s+/i, "Volkswagen "],
  [/^mercedes\s+(?!-benz)/i, "Mercedes-Benz "],
];

/** The name to search for: the model alone for a car, trimmed, at most 80 characters. */
export function subjectSearchName(kind: SubjectKind, raw: string): string {
  let name = raw.replace(/\([^)]*\)/g, " ").trim();
  if (kind === "vehicle") {
    name = name.replace(SIMILAR, "").trim();
    for (const [pattern, brand] of BRAND_ALIASES) name = name.replace(pattern, brand);
  }
  return name.replace(/\s+/g, " ").slice(0, 80).trim();
}

/** Whether a description (EN or DE) names the kind of thing asked for. */
export function describesKind(kind: SubjectKind, descriptions: readonly string[]): boolean {
  return descriptions.some((d) => KIND_WORDS[kind].test(d));
}

const entitiesSchema = z.object({
  entities: z
    .record(
      z.string(),
      z
        .object({
          claims: z
            .record(
              z.string(),
              z
                .array(
                  z.object({
                    rank: z.string().optional(),
                    mainsnak: z
                      .object({
                        datavalue: z.object({ value: z.unknown() }).partial().optional(),
                      })
                      .optional(),
                  })
                )
                .optional()
            )
            .optional(),
          descriptions: z
            .record(z.string(), z.object({ value: z.string() }).partial().optional())
            .optional(),
        })
        .nullable()
    )
    .optional(),
});

export async function lookupSubjectImage(
  kind: SubjectKind,
  rawName: string
): Promise<SubjectImageLookup> {
  const name = subjectSearchName(kind, rawName);
  if (name === "") return { ok: false, reason: "noItem" };
  const items = await exactItems(name);
  if (!items.ok) return items;

  const entities = await getJson(
    url(WIKIDATA_API, {
      action: "wbgetentities",
      ids: items.ids.slice(0, 10).join("|"),
      props: "claims|descriptions",
      languages: "en|de",
    })
  );
  if (!entities.ok) return entities;
  const parsed = entitiesSchema.safeParse(entities.value);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const byId = parsed.data.entities ?? {};

  let lastMiss: OperatorMarkMiss | "wrongKind" = "wrongKind";
  for (const qid of items.ids.slice(0, 10)) {
    const entity = byId[qid];
    const descriptions = Object.values(entity?.descriptions ?? {}).flatMap((d) =>
      typeof d?.value === "string" ? [d.value.slice(0, 200)] : []
    );
    if (!describesKind(kind, descriptions)) continue;
    const file = bestStringClaim(entity?.claims, "P18");
    if (!file) {
      lastMiss = "noLogo";
      continue;
    }
    const found = await commonsFile(file, SUBJECT_THUMB_WIDTH);
    if (!found.ok) {
      lastMiss = found.reason;
      if (found.reason === "licence" || found.reason === "noLogo") continue;
      return found;
    }
    const image = await getBytes(found.info.thumbUrl);
    if (!image.ok) return image;
    const { body, contentType } = image.value;
    if (!RASTER_TYPES.has(contentType) || body.length === 0) {
      return { ok: false, reason: "badImage" };
    }
    return { ok: true, credit: { ...found.info.credit, qid }, image: { body, contentType } };
  }
  return { ok: false, reason: lastMiss };
}
