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
