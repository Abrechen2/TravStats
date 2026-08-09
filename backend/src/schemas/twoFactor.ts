import { z } from "zod";

const sixDigits = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => /^\d{6}$/.test(value), "Code must be six digits");

export const activateTwoFactorSchema = z.object({ code: sixDigits });

/**
 * At login either factor is acceptable: the app's code, or one recovery code
 * off the sheet. Requiring at least one of them here means the route handler
 * never has to answer "what if both are missing".
 */
export const verifyTwoFactorSchema = z
  .object({
    code: sixDigits.optional(),
    recoveryCode: z.string().min(1).max(64).optional(),
  })
  .refine(
    (value) => value.code !== undefined || value.recoveryCode !== undefined,
    "Provide either a code or a recovery code",
  );

/** Switching it off is a security decision, so it costs the password. */
export const disableTwoFactorSchema = z.object({ password: z.string().min(1).max(200) });
