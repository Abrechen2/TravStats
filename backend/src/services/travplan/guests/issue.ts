/**
 * The guest's own server (spec 2026-10-17 §6.5 step 3): after the person has agreed on a screen
 * of this server, it signs a short-lived vouch for the host the invitation came from. Only a
 * host this server's admin has admitted gets one, so a forged "go and be vouched for at evil.example"
 * link ends here with a refusal, and the vouch carries a pseudonym that is different for every host.
 */
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { PERSON_SELECT, toPerson } from "../../sharing/people";
import { guestIdentity, requireVerifiedPeer } from "./peers";
import { VOUCH_MAX_LIFETIME_S, signVouch, vouchSubject } from "./vouch";

/** The path on the host that reads the vouch from the URL fragment; fixed, never a parameter. */
export const CALLBACK_PATH = "/plan/join/callback";

/** Whether this server would vouch for `host` at all; the consent screen asks before it shows. */
export async function vouchHostCheck(host: string): Promise<{ host: string }> {
  await guestIdentity();
  await requireVerifiedPeer(host, "PLAN_GUEST_HOST_NOT_ADMITTED");
  return { host };
}

export async function issueVouch(
  userId: string,
  input: { host: string; invite: string; nonce: string },
  nowMs = Date.now()
): Promise<{ redirectUrl: string; expiresAt: string; as: string }> {
  const identity = await guestIdentity();
  await requireVerifiedPeer(input.host, "PLAN_GUEST_HOST_NOT_ADMITTED");
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: PERSON_SELECT,
  });
  if (!user) throw new AppError("Not signed in", 401);
  const person = toPerson(user);
  const iat = Math.floor(nowMs / 1000);
  const token = signVouch(
    {
      v: 1,
      iss: identity.origin,
      aud: input.host,
      sub: vouchSubject(identity.key, input.host, userId),
      name: person.displayName,
      invite: input.invite,
      nonce: input.nonce,
      iat,
      exp: iat + VOUCH_MAX_LIFETIME_S,
    },
    identity.key
  );
  return {
    // In the fragment, so no proxy or access log on the way ever sees the token.
    redirectUrl: `${input.host}${CALLBACK_PATH}#vouch=${token}`,
    expiresAt: new Date((iat + VOUCH_MAX_LIFETIME_S) * 1000).toISOString(),
    as: person.displayName,
  };
}
