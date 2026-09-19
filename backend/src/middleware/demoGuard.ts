import type { NextFunction, Response } from "express";
import { prisma } from "../db";
import { isSharedDemoUser } from "../utils/sharedDemo";
import type { AuthRequest } from "./auth";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Is the caller the shared, publicly-logged-in demo account?
 *
 * Re-exported, not defined here: services ask the same question (see
 * `utils/sharedDemo.ts`), and a service importing a middleware would invert
 * the layering. Existing callers of this name keep working.
 */
export { isSharedDemoUser };

/**
 * The demo account is shared by every visitor of a public instance. What one
 * of them does to its credentials, second factors, tokens, notification
 * address, profile or outbound connections would lock out or endanger all the
 * others, so those routes refuse it. Travel data stays editable; a nightly
 * reseed restores it.
 *
 * The question is `isSharedDemoAccount`, not `isDemo` — see `utils/sharedDemo.ts`
 * for why the flag alone is the wrong one to ask.
 *
 * Mount AFTER `authenticate`: it reads `req.userId`.
 */
export async function rejectDemo(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      next();
      return;
    }
    if (await isSharedDemoUser(req.userId)) {
      res.status(403).json({
        error: "DEMO_ACCOUNT_FORBIDDEN",
        message: "The demo account cannot change this. Use your own account on your own instance.",
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** `rejectDemo` for writes only: the demo account may still read the page. */
export function rejectDemoWrites(req: AuthRequest, res: Response, next: NextFunction): void {
  if (READ_METHODS.has(req.method)) {
    next();
    return;
  }
  void rejectDemo(req, res, next);
}

/**
 * A DIFFERENT question, on purpose: may this account spend the instance's
 * external-API quota?
 *
 * Every `isDemo` account is sample data — the preview's `admin`, `alex` and
 * `claude`, the local dev admin, and the shared `demo` alike. A bulk
 * historical refresh over a hundred seeded flights costs real RapidAPI calls
 * for rows nobody will read, so all of them are refused here, not only the
 * shared one. That is why this is not `rejectDemo` with a different message.
 */
export async function rejectDemoQuota(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      next();
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isDemo: true },
    });
    if (user?.isDemo) {
      res.status(403).json({
        error: "DEMO_ACCOUNT_FORBIDDEN",
        message:
          "Bulk refresh is disabled for the demo account to keep RapidAPI quota intact. Use a real account on a production deployment.",
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
