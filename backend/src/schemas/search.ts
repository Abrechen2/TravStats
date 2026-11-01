import { z } from "./zod";
import {
  DEFAULT_PER_DOMAIN,
  MAX_PER_DOMAIN,
  MIN_QUERY_LENGTH,
  SEARCH_DOMAINS,
  type SearchDomain,
} from "../services/search/types";

/** `GET /search` query. `domains` is a comma list; an unknown name is a 400, not a silent no-op. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(MIN_QUERY_LENGTH).max(100),
  limit: z.coerce.number().int().min(1).max(MAX_PER_DOMAIN).default(DEFAULT_PER_DOMAIN),
  domains: z
    .string()
    .optional()
    .transform((v, ctx): SearchDomain[] | undefined => {
      if (v === undefined || v.trim() === "") return undefined;
      const names = v.split(",").map((s) => s.trim());
      const bad = names.find((n) => !(SEARCH_DOMAINS as readonly string[]).includes(n));
      if (bad !== undefined) {
        ctx.addIssue({ code: "custom", message: `unknown domain "${bad}"` });
        return z.NEVER;
      }
      return names as SearchDomain[];
    }),
});
