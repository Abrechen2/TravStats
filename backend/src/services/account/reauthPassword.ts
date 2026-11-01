import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { comparePassword } from "../../utils/password";
import { decryptSecret, verifyCode } from "../twoFactor/totpService";
import { consumeRecoveryCode } from "../twoFactor/recoveryCodeService";

export interface PasswordReauthInput {
  password?: string;
  code?: string;
  recoveryCode?: string;
}

/**
 * Fresh re-authentication of the signed-in caller: the password, plus the
 * second factor where the account has one. Used before a step a stolen session
 * cookie must not be able to take alone (registering a passkey, which would
 * otherwise become a way to delete the account).
 *
 * Refusals are 403, never 401: the client signs the user out on every 401.
 */
export async function requirePasswordReauth(
  userId: string,
  input: PasswordReauthInput
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("User not found", 404);
  if (!input.password || !(await comparePassword(input.password, user.passwordHash))) {
    throw new AppError("Password is incorrect", 403, "REAUTH_PASSWORD_INCORRECT");
  }
  if (user.twoFactorEnabledAt && user.twoFactorSecret) {
    if (!input.code && !input.recoveryCode) {
      throw new AppError("A second-factor code is required", 403, "REAUTH_SECOND_FACTOR_REQUIRED");
    }
    const accepted = input.code
      ? verifyCode(decryptSecret(user.twoFactorSecret), input.code.replace(/\s+/g, ""))
      : await consumeRecoveryCode(userId, input.recoveryCode!);
    if (!accepted) {
      throw new AppError("That code is not right", 403, "REAUTH_SECOND_FACTOR_INVALID");
    }
  }
}
