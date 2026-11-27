import { z } from "../../../schemas/zod";

/**
 * What a spoke's membership keeps after its person linked an offer with a trip they already held
 * (forgejo#440, `offerLink.ts`): the trip, and the home's keys that only the home held — entries
 * the link did not create and the home's `entries` must not create either (`serveEntries`).
 */
export const linkedStateSchema = z.object({
  linked: z.object({ tripId: z.string(), skip: z.array(z.string()) }),
});

export type LinkedState = z.infer<typeof linkedStateSchema>;

/** The home keys this spoke must not copy for a membership linked to an existing trip. */
export function linkSkipKeys(offer: unknown): Set<string> {
  const parsed = linkedStateSchema.safeParse(offer);
  return new Set(parsed.success ? parsed.data.linked.skip : []);
}
