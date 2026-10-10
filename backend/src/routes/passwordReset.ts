import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  resetTokenCheckSchema,
  forceChangePasswordSchema,
} from "../schemas/auth";
import { passwordResetCheckLimiter, passwordResetLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { SMTP_CONFIG_ID } from "./admin/smtp";
import { sendPasswordResetEmail } from "../services/emailService";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { isSharedDemoAccount } from "../utils/sharedDemo";

/**
 * The shared demo account's password is not its holder's to change: the login
 * is published on the front page, so every visitor is "the holder", and the
 * first one to set a password locks out all the others.
 *
 * 403 rather than the 400 the surrounding token errors use — the token may be
 * perfectly valid; it is the ACCOUNT that is out of bounds, and saying
 * "invalid token" for a valid one would send an administrator hunting the
 * wrong thing.
 */
function assertNotSharedDemo(user: { isDemo: boolean; username: string }): void {
  if (isSharedDemoAccount(user)) {
    throw new AppError("The shared demo account's password cannot be changed", 403);
  }
}
import { recordPasswordResetRequest } from "../services/passwordResetRequestService";
import logger from "../utils/logger";

const router = Router();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// GET /smtp-status — public, no auth
router.get("/smtp-status", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
    // Best-effort admin contact for the "no SMTP" fallback message.
    // Returns the notificationEmail of any active admin if one is set,
    // otherwise null. Used by the forgot-password modal to render a
    // real mailto: link instead of plain text.
    const adminUser = await prisma.user.findFirst({
      where: { isAdmin: true, isActive: true, notificationEmail: { not: null } },
      select: { notificationEmail: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      smtpEnabled: !!config?.enabled,
      adminContactEmail: adminUser?.notificationEmail ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// GET /registration-status — public, no auth
// Lets the frontend hide / disable the register form before submit when the
// instance has registration disabled and no user limit slot is open. The
// first user is always allowed (bootstrap).
router.get("/registration-status", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const userCount = await prisma.user.count();
    const { allowRegistration, maxUsers } = await getInstanceSettings();
    const isFirstUser = userCount === 0;
    const limitReached = !isFirstUser && userCount >= maxUsers;
    const enabled = isFirstUser || (allowRegistration && !limitReached);
    res.json({
      registrationEnabled: enabled,
      requiresInvitation: !isFirstUser && !allowRegistration,
      limitReached,
    });
  } catch (error) {
    next(error);
  }
});

// POST /forgot-password — always 200 to prevent user enumeration
router.post(
  "/forgot-password",
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username } = forgotPasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { username } });

      // Read unconditionally, before the branch below cares whether the user
      // exists: the answer is a property of the INSTANCE, not of the account,
      // and reading it only for known usernames made the handler's work — and
      // so its timing — depend on whether the name was real.
      const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
      const mailEnabled = !!config?.enabled;

      // No mail delivery, but a real account: tell an administrator instead of
      // telling nobody (forgejo#88, point 2). Before this, the dialog said
      // "contact an administrator" and the administrator never heard that
      // anyone had.
      //
      // This is the one unauthenticated write on the route, and it is bounded
      // by construction: `PasswordResetRequest.userId` is unique, so a repeat
      // is an UPDATE, and a username that matches no account writes nothing —
      // the table can never hold more rows than there are users, whatever is
      // thrown at it. The existing `passwordResetLimiter` still guards the
      // door; no new one is needed, because no new door was opened.
      //
      // The upsert runs only for a real account, so the handler does measurably
      // more work for a name that exists — measured and accepted, 2026-09-19.
      // It is no worse than the SMTP path above, which does an UPDATE and an
      // SMTP send on the same condition, and `passwordResetLimiter` bounds how
      // often the difference can be sampled. Closing it would mean a decoy
      // write, which is a worse thing to have in the tree than a millisecond.
      //
      // The shared demo account is deliberately NOT excluded here. What the
      // SMTP branch refuses it is a reset LINK sent to a stale address; an
      // administrator reading a row and deciding for themselves is not that.
      // An instance that hosts the demo has an admin who can ignore it.
      if (user && user.isActive && !mailEnabled) {
        await recordPasswordResetRequest(user.id);
        logger.info({
          operation: "password_reset_request_recorded",
          message: "Password reset requested on an instance without mail delivery",
          context: { userId: user.id },
        });
      }

      // The shared demo account never gets a reset link. Its login is
      // published, so whoever asks for one is not its owner — and whoever
      // received it would set a password of their own and lock every other
      // visitor out of the account the front page advertises (finding C3).
      // The address it would go to is refused at /settings/notifications now,
      // but a row upgraded from before that guard can still carry a stale one.
      //
      // The answer below is the same sentence an unknown username gets, on
      // purpose: a distinct refusal would be an enumeration oracle, and there
      // is nothing to hide about an account whose name is on the login page.
      if (user && user.isActive && user.notificationEmail && !isSharedDemoAccount(user)) {
        if (mailEnabled) {
          const plainToken = crypto.randomBytes(32).toString("hex");
          const hashedToken = hashToken(plainToken);
          const expiry = new Date(Date.now() + 30 * 60 * 1000); // 30 min

          await prisma.user.update({
            where: { id: user.id },
            data: { resetToken: hashedToken, resetTokenExpiry: expiry },
          });

          const { frontendUrl } = await getInstanceSettings();
          const baseUrl = frontendUrl ?? "http://localhost:3000";
          const resetUrl = `${baseUrl}/reset-password?token=${plainToken}`;

          try {
            await sendPasswordResetEmail(user.notificationEmail, resetUrl, user.username);
          } catch (emailError) {
            logger.error({
              operation: "forgot_password_email_failed",
              error: {
                message: emailError instanceof Error ? emailError.message : "Unknown error",
              },
            });
            // Don't fail the request — return 200 regardless
          }
        }
      }

      res.json({
        message: "If the username exists and has an email configured, a reset link has been sent.",
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /reset-password/check — is this link still good? Asked when the reset
// page opens, so an expired link says so BEFORE the reader types a new
// password twice (forgejo#88 acceptance, 2026-10-10). POST, not GET: the token
// is a secret and a query string lands in access logs. The answer is one
// boolean about the token the caller already holds — no username, no
// account — so it tells nothing about who has an account. The shared demo is
// "not valid" here because the reset itself refuses it.
router.post(
  "/reset-password/check",
  passwordResetCheckLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = resetTokenCheckSchema.parse(req.body);
      const user = await prisma.user.findFirst({
        where: { resetToken: hashToken(token), resetTokenExpiry: { gt: new Date() } },
        select: { isDemo: true, username: true },
      });
      res.json({ valid: user !== null && !isSharedDemoAccount(user) });
    } catch (error) {
      next(error);
    }
  }
);

// POST /reset-password
router.post(
  "/reset-password",
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      const hashedToken = hashToken(token);

      const user = await prisma.user.findFirst({
        where: {
          resetToken: hashedToken,
          resetTokenExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        throw new AppError("Invalid or expired reset token", 400);
      }

      // Belt and braces with the `/forgot-password` guard above, which already
      // refuses to SEND the shared demo a link. This one refuses to honour a
      // token that exists anyway — one issued before that guard, or one that
      // leaked. Measured on the public preview on 2026-09-28: the demo
      // account's `sessionEpoch` stood at 22, i.e. its password had been
      // changed twenty-two times, and every change signs every other visitor
      // out of the account the front page advertises.
      assertNotSharedDemo(user);

      const newHash = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          resetToken: null,
          resetTokenExpiry: null,
          mustChangePassword: false,
          // Recovering an account has to remove whoever you are recovering it
          // from — every session older than this instant stops working.
          sessionEpoch: { increment: 1 },
        },
      });

      logger.info({ operation: "password_reset_completed", userId: user.id });

      res.json({ message: "Password has been reset successfully." });
    } catch (error) {
      next(error);
    }
  }
);

// POST /force-change-password — used after login with mustChangePassword=true
router.post(
  "/force-change-password",
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { newPassword } = forceChangePasswordSchema.parse(req.body);
      // Read changeToken exclusively from HttpOnly cookie (set during login)
      const changeToken: string | undefined = req.cookies?.change_token;
      if (!changeToken) {
        throw new AppError("Change token is required", 400);
      }
      const hashedToken = hashToken(changeToken);

      const user = await prisma.user.findFirst({
        where: {
          changeToken: hashedToken,
          changeTokenExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        throw new AppError("Invalid or expired change token", 400);
      }

      // Same rule as the reset route. This one matters more: the change token
      // is handed out at LOGIN to anyone whose account carries
      // `mustChangePassword`, and the shared demo's login is published — so
      // setting that flag on it would let any visitor take the account over.
      assertNotSharedDemo(user);

      const newHash = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          changeToken: null,
          changeTokenExpiry: null,
          mustChangePassword: false,
          sessionEpoch: { increment: 1 },
        },
      });

      logger.info({ operation: "force_password_change_completed", userId: user.id });

      // Clear the change_token cookie
      res.clearCookie("change_token", { path: "/" });
      res.json({ message: "Password changed successfully." });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
