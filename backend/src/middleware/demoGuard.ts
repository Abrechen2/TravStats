import type { NextFunction, Response } from "express";
import { prisma } from "../db";
import type { AuthRequest } from "./auth";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The demo account is shared by every visitor of a public instance. What one
 * of them does to its credentials, second factors, tokens or outbound
 * connections would lock out or endanger all the others, so those routes
 * refuse it. Travel data stays editable; a nightly reseed restores it.
 *
 * Mount AFTER `authenticate`: it reads `req.userId`.
 */
export async function rejectDemo(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
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
