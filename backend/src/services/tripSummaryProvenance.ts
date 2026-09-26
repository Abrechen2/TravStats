/**
 * Who wrote a trip's summary (forgejo#132 item 8). The summarize route and a
 * person both write `Trip.summary`; these three columns say which, and for the
 * model's text when and from how many entries — the design's "maschinell · aus
 * n Einträgen · Datum". NULL in all three is "unknown", which is what every
 * summary written before the columns existed stays: it may have been either.
 */
export interface SummaryProvenance {
  summarySource: "llm" | "user" | null;
  summaryGeneratedAt: Date | null;
  summaryEntryCount: number | null;
}

const NONE: SummaryProvenance = {
  summarySource: null,
  summaryGeneratedAt: null,
  summaryEntryCount: null,
};

/** The model wrote it now, from `entryCount` entries. */
export function llmProvenance(entryCount: number, at: Date = new Date()): SummaryProvenance {
  return { summarySource: "llm", summaryGeneratedAt: at, summaryEntryCount: entryCount };
}

/**
 * The provenance a create or PATCH writes alongside `summary`, or nothing.
 *
 * Only a CHANGED text is a person's: the trip form sends every field on save,
 * so a model's summary sent back untouched with a new trip name must stay the
 * model's — and an unknown one must stay unknown rather than become "user".
 * An emptied summary takes its provenance with it.
 */
export function provenanceForWrite(
  next: string | null | undefined,
  stored: string | null
): Partial<SummaryProvenance> {
  if (next === undefined || next === stored) return {};
  if (next === null || next.trim() === "") return NONE;
  return { ...NONE, summarySource: "user" };
}
