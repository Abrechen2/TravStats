import { z } from "zod";

/** The browser hands back an opaque credential object; we validate the shape we
 *  actually read and let the library reject the cryptographic details. */
export const registerVerifySchema = z.object({
  name: z.string().min(1).max(60),
  response: z.record(z.unknown()),
});

export const loginVerifySchema = z.object({
  response: z.record(z.unknown()),
});

/** Renaming is the only mutable thing about a stored credential. */
export const renamePasskeySchema = z.object({
  name: z.string().min(1).max(60),
});
