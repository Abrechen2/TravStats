import { prisma } from "../db";
import { verifyToken } from "./jwt";

/** Is this session token (by `jti`) one that was signed out? */
export async function isSessionRevoked(jti: string): Promise<boolean> {
  const row = await prisma.revokedSession.findUnique({ where: { jti }, select: { jti: true } });
  return row !== null;
}

/**
 * Sign this one session out server-side (forgejo#412 N4).
 *
 * The jti is kept until the token's own `exp` — after that the signature check
 * refuses the token anyway — and rows past it are pruned here, so the table
 * never outgrows one week of logouts. A token that is invalid, expired or has
 * no `jti` (minted before the claim existed) has nothing to revoke: returns false.
 */
export async function revokeSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  let decoded: ReturnType<typeof verifyToken>;
  try {
    decoded = verifyToken(token);
  } catch {
    // Not a token this server would accept anyway — nothing to revoke.
    return false;
  }
  if (!decoded.jti || !decoded.exp) return false;
  const expiresAt = new Date(decoded.exp * 1000);
  await prisma.revokedSession.upsert({
    where: { jti: decoded.jti },
    create: { jti: decoded.jti, expiresAt },
    update: {},
  });
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return true;
}
