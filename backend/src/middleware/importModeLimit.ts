import type { Request } from "express";
import rateLimit, { type Options } from "express-rate-limit";
import { importModeCovers } from "../services/importMode";
import logger from "../utils/logger";

/**
 * Whether import mode (forgejo#304) lets this request past a limiter.
 *
 * Only for a signed-in account, and never for the shared demo: that account is
 * every visitor of a public instance at once, so lifting its limits would hand
 * any visitor an unthrottled upload route. A limiter mounted before
 * `authenticate` sees no user and stays in force, which is the safe answer.
 * A failure to read the setting keeps the limit too.
 */
export async function importModeSkips(req: Request): Promise<boolean> {
  const r = req as { userId?: string; isSharedDemo?: boolean };
  if (!r.userId || r.isSharedDemo) return false;
  try {
    return await importModeCovers(r.userId);
  } catch (error) {
    logger.warn({ operation: "importMode.read", err: error }, "import mode unreadable; limit kept");
    return false;
  }
}

/**
 * `rateLimit` for the upload and import limiters: the same options, plus the
 * import-mode bypass on top of any `skip` of their own. A limiter not built
 * here is never lifted — auth, password reset and the other guards stay.
 */
export function importLimit(options: Partial<Options>) {
  const own = options.skip;
  return rateLimit({
    ...options,
    skip: async (req, res) => (own ? await own(req, res) : false) || importModeSkips(req),
  });
}
