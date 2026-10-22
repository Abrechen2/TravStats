import { z } from "./zod";

/**
 * POST /rail/share-link — one pasted link (forgejo#204). Only its length is
 * bounded here; what the link IS — a bahn.de share link, a search link, or
 * something else — is answered by `parseShareLink` as an outcome the client
 * words, not as a 400 the user would read as "the app is broken".
 */
export const railShareLinkSchema = z.object({
  url: z.string().trim().min(1).max(2_000),
});

export type RailShareLinkInput = z.infer<typeof railShareLinkSchema>;

/**
 * POST /rail/share-link/connection — the answer the bookmarklet fetched on
 * bahn.de, trimmed to what a connection needs (forgejo#204). Only the outer
 * bounds are held here; whether it IS a connection is the reader's outcome
 * (`unreadable`), not a 400.
 */
export const railBahnHandoffSchema = z.object({
  answer: z
    .object({
      hinfahrtRecon: z.string().max(20_000).optional(),
      klasse: z.string().max(40).optional(),
      verbindungsAbschnitte: z.array(z.unknown()).max(30).optional(),
    })
    .strip(),
});

export type RailBahnHandoffInput = z.infer<typeof railBahnHandoffSchema>;
