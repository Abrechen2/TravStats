/**
 * The instance recovery key, admin side (services/backup/recoveryKey.ts).
 *
 * Backups carry stored credentials encrypted under the instance key and never
 * the key itself; these calls are how an admin is shown that key once, proves
 * they kept it, and how the web app knows whether that proof is still owed.
 * Admin-only, browser session only, bare response family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Admin", "Backup"];

const status = registry.register(
  "RecoveryKeyStatus",
  z.object({
    backupTargetConfigured: z.boolean(),
    confirmed: z.boolean().openapi({ description: "Confirmed for the key now in force." }),
    confirmedAt: z.string().datetime().nullable(),
    confirmedForOtherKey: z
      .boolean()
      .openapi({ description: "A confirmation exists, for a key that has since been replaced." }),
    required: z.boolean().openapi({
      description:
        "A backup target exists and the key is not confirmed: the web app blocks every admin " +
        "page until the confirmation is done.",
    }),
    pinnedByEnv: z.boolean(),
  })
);

const revealed = registry.register(
  "RecoveryKeyRevealed",
  z.object({
    key: z.string().openapi({ description: "Upper-case hex in groups of four. Shown once." }),
    fingerprint: z.string(),
    instanceName: z.string(),
    filename: z.string(),
  })
);

const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });

registry.registerPath({
  method: "get",
  path: "/admin/recovery-key/status",
  summary: "Whether an admin still owes the recovery-key confirmation",
  description: "Never carries the key.",
  tags,
  responses: { 200: { description: "Status", content: json(status) } },
});

registry.registerPath({
  method: "post",
  path: "/admin/recovery-key/reveal",
  summary: "Re-authenticate and read the recovery key, once",
  description:
    "POST only, `Cache-Control: no-store`, strictly rate limited per account. The body re-proves " +
    "the account: `password` (+ `code` or `recoveryCode` with two-factor on), or a " +
    "`passkeyResponse` to a challenge from `POST /auth/passkeys/reauth/options`. The call is " +
    "audit-logged without the value.",
  tags,
  request: {
    body: {
      content: json(
        z.object({
          password: z.string().optional(),
          code: z.string().optional(),
          recoveryCode: z.string().optional(),
          passkeyResponse: z.record(z.string(), z.unknown()).optional(),
        })
      ),
    },
  },
  responses: {
    200: { description: "The key", content: json(revealed) },
    400: {
      description: "No re-authentication (`RECOVERY_KEY_REAUTH_REQUIRED`)",
      content: errorContent,
    },
    403: {
      description:
        "Not an admin, an API token, or the re-authentication failed (`REAUTH_PASSWORD_INCORRECT`, " +
        "`REAUTH_SECOND_FACTOR_REQUIRED`, `REAUTH_SECOND_FACTOR_INVALID`, `DELETE_PASSKEY_INVALID`)",
      content: errorContent,
    },
    429: { description: "Rate limited (`RATE_LIMITED`)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/recovery-key/confirm",
  summary: "Confirm the recovery key with its last four characters",
  description:
    "Accepts only the last four characters, never the key, and compares them in constant time. " +
    "Needs a reveal by the same admin within the last 30 minutes. Records the confirmation for " +
    "the fingerprint of the key now in force.",
  tags,
  request: { body: { content: json(z.object({ lastFour: z.string() })) } },
  responses: {
    200: { description: "Confirmed; the new status", content: json(status) },
    400: {
      description: "Not four characters (`RECOVERY_KEY_CONFIRM_FORMAT`)",
      content: errorContent,
    },
    409: { description: "No recent reveal (`RECOVERY_KEY_NOT_REVEALED`)", content: errorContent },
    422: {
      description: "Not the last four characters (`RECOVERY_KEY_CONFIRM_MISMATCH`)",
      content: errorContent,
    },
    429: { description: "Rate limited (`RATE_LIMITED`)", content: errorContent },
  },
});
