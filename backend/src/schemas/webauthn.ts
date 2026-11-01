import { z } from "./zod";

/** The browser hands back an opaque credential object; we validate the shape we
 *  actually read and let the library reject the cryptographic details. */
export const registerVerifySchema = z.object({
  name: z.string().trim().min(1).max(60),
  response: z.record(z.string(), z.unknown()),
});

export const loginVerifySchema = z.object({
  response: z.record(z.string(), z.unknown()),
});

/** Renaming is the only mutable thing about a stored credential. */
export const renamePasskeySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

/** Registering a passkey needs a fresh password (and second factor) re-authentication. */
export const registerOptionsSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  code: z.string().max(16).optional(),
  recoveryCode: z.string().max(64).optional(),
});
