import rateLimit from "express-rate-limit";
import { userOrIpKey } from "./rateLimit";

/**
 * The admin's template repository setting (forgejo#309): "test" fetches the
 * repository's index, "save" re-syncs every template from it. Both go out to
 * a host the admin named — GitHub rate-limits unauthenticated raw fetches by
 * IP, so a hammered button would cost every user their template updates.
 * Looser than the re-sync button's three per hour, because typing a URL,
 * testing it and correcting a typo is a few requests in a row. Its own file:
 * `rateLimit.ts` sits at the file-size limit.
 */
export const TEMPLATE_REPO_WINDOW_MS = 60 * 60 * 1000;
export const TEMPLATE_REPO_MAX = 20;

export const templateRepoLimiter = rateLimit({
  windowMs: TEMPLATE_REPO_WINDOW_MS,
  max: TEMPLATE_REPO_MAX,
  message: "Too many template repository requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
