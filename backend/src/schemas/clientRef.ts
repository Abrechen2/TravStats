import { z } from "./zod";

/**
 * The idempotency key a client may send with a create (forgejo#283). The
 * Companion mints a UUID per queued write; any 1–64 characters from the URL-safe
 * set are accepted, so a client is not bound to one id format.
 */
export const clientRefSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,64}$/, "clientRef must be 1–64 characters of A–Z a–z 0–9 . _ : -")
  .openapi({
    description:
      "Optional idempotency key (forgejo#283), e.g. a UUID the app minted for a queued " +
      "write. A repeat POST with the same key and the same body answers the row the first " +
      "one created — 200 instead of 201, same id, same body shape — and creates nothing. " +
      "Unique per account across every route that takes it; kept 90 days. The same key " +
      "with a different body (or on another route) is refused with 409 `CLIENT_REF_REUSED`; " +
      "a key whose row was deleted since is answered 410 `CLIENT_REF_TARGET_GONE`.",
    example: "5f0c7c1e-8a1b-4d55-9d7e-2b1f4f0e9c3a",
  });

/** The body fragment a create route documents beside its own input. */
export const clientRefBodySchema = z.object({ clientRef: clientRefSchema.optional() });
