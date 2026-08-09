import crypto from "crypto";
import { Router, Response, NextFunction } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { generateToken } from "../../utils/jwt";
import { getAuthCookieOptions } from "../auth";
import { resolveRpConfig, passkeyUnavailableReason } from "../../services/webauthn/rpConfig";
import { putChallenge, takeChallenge } from "../../services/webauthn/challengeStore";
import {
  registerVerifySchema,
  loginVerifySchema,
  renamePasskeySchema,
} from "../../schemas/webauthn";
import logger from "../../utils/logger";

const router = Router();

/**
 * User verification is REQUIRED, not "preferred".
 *
 * This is the hinge the whole design hangs on. A passkey REPLACES the password
 * rather than adding a step to it, and it also satisfies two-factor on its own
 * (see the login/verify handler). Both of those are only honest if the
 * authenticator actually performed a local gesture — a PIN, a fingerprint, a
 * vault unlock. Under "preferred" a bare-possession assertion would be accepted
 * and would then bypass a TOTP factor the user deliberately switched on.
 * Requiring it costs nothing real: every platform authenticator and every
 * password manager that stores passkeys (Bitwarden, 1Password, iCloud) does
 * user verification anyway.
 */
const USER_VERIFICATION = "required" as const;

/** Why the UI may not offer passkeys here. Public: the login page asks before
 *  rendering a button, and the answer reveals nothing an attacker cannot see. */
router.get("/availability", async (_req, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.adminSettings.findFirst({
      select: { webauthnOrigins: true, publicUrl: true },
    });
    const primary = row?.webauthnOrigins?.[0] ?? row?.publicUrl ?? null;
    const reason = passkeyUnavailableReason(primary);
    res.json({ available: reason === null, reason });
  } catch (error) {
    next(error);
  }
});

async function requireRp(): Promise<NonNullable<Awaited<ReturnType<typeof resolveRpConfig>>>> {
  const rp = await resolveRpConfig();
  if (!rp) {
    throw new AppError(
      "Passkeys are not available on this instance — no secure origin is configured",
      409
    );
  }
  return rp;
}

router.post("/register/options", authenticate, authLimiter, async (req: AuthRequest, res, next) => {
  try {
    const rp = await requireRp();
    const userId = req.userId!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (!user) throw new AppError("User not found", 404);

    const existing = await prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpId,
      userName: user.username,
      // Registering the same authenticator twice produces a confusing duplicate
      // in the list; the browser refuses instead when we exclude what we have.
      excludeCredentials: existing.map((entry) => ({
        id: entry.credentialId,
        transports: entry.transports as never,
      })),
      // residentKey "preferred", not "required": a discoverable credential is
      // what makes the username-less sign-in button work, and every syncing
      // password manager creates one — but a hardware key with no storage left
      // should still be allowed to register rather than fail outright.
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: USER_VERIFICATION,
      },
    });

    putChallenge(`reg:${userId}`, options.challenge);
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post("/register/verify", authenticate, authLimiter, async (req: AuthRequest, res, next) => {
  try {
    const rp = await requireRp();
    const userId = req.userId!;
    const { name, response } = registerVerifySchema.parse(req.body);

    const expectedChallenge = takeChallenge(`reg:${userId}`);
    if (!expectedChallenge) throw new AppError("Registration challenge expired", 400);

    const verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new AppError("Passkey registration could not be verified", 400);
    }

    const { credential } = verification.registrationInfo;
    const row = await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        name,
        rpId: rp.rpId,
      },
    });

    logger.info({ operation: "passkey_registered", userId });
    res.json({ id: row.id, name: row.name });
  } catch (error) {
    next(error);
  }
});

router.post("/login/options", authLimiter, async (req, res, next) => {
  try {
    const rp = await requireRp();
    // No allowCredentials: the sign-in is username-less and relies on the
    // authenticator offering its discoverable credentials.
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      userVerification: USER_VERIFICATION,
    });

    // No session yet, so the challenge is keyed to a cookie we set here. It is
    // an anonymous handle, not a credential: holding it proves nothing.
    const handle = crypto.randomBytes(16).toString("hex");
    putChallenge(`login:${handle}`, options.challenge);
    res.cookie("passkey_handle", handle, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 2 * 60 * 1000,
      path: "/",
    });

    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post("/login/verify", authLimiter, async (req: AuthRequest, res, next) => {
  try {
    const rp = await requireRp();
    const { response } = loginVerifySchema.parse(req.body);

    const handle = req.cookies?.passkey_handle;
    if (typeof handle !== "string") throw new AppError("No passkey login in progress", 401);
    const expectedChallenge = takeChallenge(`login:${handle}`);
    if (!expectedChallenge) throw new AppError("Passkey challenge expired", 401);

    const credentialId = typeof response.id === "string" ? response.id : null;
    if (!credentialId) throw new AppError("Malformed passkey response", 400);

    const stored = await prisma.webAuthnCredential.findUnique({
      where: { credentialId },
      include: { user: true },
    });
    if (!stored) throw new AppError("Unknown passkey", 401);
    // The password path is not the only place account state has to be honoured.
    // A deactivated user must not get a session through a passkey either — and a
    // user owing a password change must still be sent through that flow.
    if (!stored.user.isActive) throw new AppError("Account is deactivated", 403);
    if (stored.user.mustChangePassword) {
      throw new AppError("Set a new password before signing in with a passkey", 403);
    }

    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, "base64url"),
        counter: Number(stored.counter),
        transports: stored.transports as never,
      },
    });

    if (!verification.verified) throw new AppError("Passkey could not be verified", 401);

    // A counter that fails to advance is the documented clone signal. Refuse and
    // say so in the log — silently accepting it defeats the point of the counter.
    //
    // Guarded on `stored.counter > 0n` because syncing authenticators (Bitwarden,
    // iCloud Keychain) legitimately report 0 forever; only a regression from a
    // non-zero value means anything.
    const newCounter = verification.authenticationInfo.newCounter;
    if (stored.counter > 0n && BigInt(newCounter) <= stored.counter) {
      logger.warn({
        operation: "passkey_counter_regression",
        userId: stored.userId,
        credentialId: stored.credentialId,
      });
      throw new AppError("Passkey could not be verified", 401);
    }

    await prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
    });

    // DELIBERATE: a passkey login does NOT go through the TOTP challenge, even
    // when the account has two-factor switched on. The assertion above was
    // verified with `requireUserVerification: true`, so it already proves
    // possession of the authenticator AND a local gesture — asking for a
    // six-digit code on top would be a third factor, not a second. The password
    // path is unchanged and still demands TOTP.
    //
    // This is the reason USER_VERIFICATION may never be relaxed to "preferred":
    // that would turn the line below into a genuine 2FA bypass.
    res.clearCookie("passkey_handle", { path: "/" });
    res.cookie("auth_token", generateToken(stored.userId), getAuthCookieOptions(req));

    logger.info({
      operation: "passkey_login",
      userId: stored.userId,
      twoFactorEnabled: stored.user.twoFactorEnabledAt !== null,
    });
    res.json({
      user: {
        id: stored.user.id,
        username: stored.user.username,
        isAdmin: stored.user.isAdmin,
        firstName: stored.user.firstName,
        lastName: stored.user.lastName,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const passkeys = await prisma.webAuthnCredential.findMany({
      where: { userId: req.userId! },
      select: { id: true, name: true, rpId: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ passkeys });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", authenticate, authLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { name } = renamePasskeySchema.parse(req.body);
    // Scoped by userId for the same reason as the delete below.
    const updated = await prisma.webAuthnCredential.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: { name },
    });
    if (updated.count === 0) throw new AppError("Passkey not found", 404);
    res.json({ id: req.params.id, name });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authenticate, authLimiter, async (req: AuthRequest, res, next) => {
  try {
    // Scoped by userId, not just id: a foreign key proves the row exists, never
    // that it belongs to the caller.
    const deleted = await prisma.webAuthnCredential.deleteMany({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (deleted.count === 0) throw new AppError("Passkey not found", 404);

    logger.info({ operation: "passkey_deleted", userId: req.userId });
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
