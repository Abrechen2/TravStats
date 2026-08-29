/**
 * The rest of the authentication surface: passkeys, two-factor, password
 * recovery, and device pairing.
 *
 * TWO-FACTOR AND PASSKEYS ARE DIFFERENT TRADES, and a client that treats them
 * as one will get the security wrong.
 *
 * TOTP is a second factor ON TOP OF the password. A correct password answers
 * with `{requiresTwoFactor: true}` and a short-lived cookie, and the session
 * only exists after the code.
 *
 * A passkey is the opposite: it REPLACES the password and satisfies the second
 * factor by itself, so `login/verify` issues the session directly. That is only
 * sound because both ceremonies demand user verification — the assertion proves
 * possession AND a local gesture. Relaxing that would quietly turn the passkey
 * route into a way around two-factor.
 *
 * Sign-in is username-less on purpose: no credential list is sent, which is
 * what lets a syncing password manager offer its own discoverable credential.
 * A credential is bound to one relying-party id forever, so that id is an
 * explicit setting and never taken from the Host header — and a bare IP is not
 * a valid one, nor is plain http outside localhost a secure context at all.
 * `availability` says which of those is in the way, so a client can explain
 * instead of drawing a button that can never work.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const authTag = ["Auth"];
const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const deleted = { description: "Deleted" };

registry.registerPath({
  method: "get",
  path: "/auth/registration-status",
  summary: "Whether this instance accepts new accounts",
  tags: authTag,
  responses: { 200: { description: "Status" } },
});

registry.registerPath({
  method: "get",
  path: "/auth/smtp-status",
  summary: "Whether mail is configured",
  description: "Password recovery needs it; without mail the reset flow cannot start.",
  tags: authTag,
  responses: { 200: { description: "Status" } },
});

registry.registerPath({
  method: "post",
  path: "/auth/force-change-password",
  summary: "Set a new password when the account is flagged to change it",
  description:
    "Consumes the change token from login and nothing else. It is deliberately " +
    "unable to accept the two-factor token: the two must not be interchangeable.",
  tags: authTag,
  responses: { 200: { description: "Changed" }, 400: badInput, 401: { description: "No valid token", content: errorContent } },
});

registry.registerPath({
  method: "post",
  path: "/auth/forgot-password",
  summary: "Start password recovery",
  description:
    "Answers the same way whether or not the address is known. Telling a stranger " +
    "which addresses have accounts is the leak this endpoint exists to avoid.",
  tags: authTag,
  responses: { 200: { description: "Accepted" }, 429: { description: "Too many attempts", content: errorContent } },
});

registry.registerPath({
  method: "post",
  path: "/auth/reset-password",
  summary: "Finish password recovery with the emailed token",
  tags: authTag,
  responses: { 200: { description: "Reset" }, 400: badInput },
});

for (const [path, summary, description] of [
  ["/auth/2fa/status", "Whether two-factor is on", undefined],
  ["/auth/2fa/setup", "Begin two-factor setup", "Returns the secret and its QR payload. Nothing is enabled until it is verified."],
  ["/auth/2fa/verify", "Confirm a code and switch two-factor on", undefined],
  ["/auth/2fa/activate", "Activate after verification", undefined],
  ["/auth/2fa/disable", "Switch two-factor off", "Requires a current code, not just a session — a stolen session must not be able to remove the factor protecting it."],
  ["/auth/2fa/recovery-codes", "Issue fresh recovery codes", "Shown once. They are the way back in when the phone is gone."],
] as const) {
  registry.registerPath({
    method: path.endsWith("status") ? "get" : "post",
    path,
    summary,
    ...(description ? { description } : {}),
    tags: authTag,
    responses: { 200: { description: summary }, 400: badInput, 401: { description: "Not signed in", content: errorContent } },
  });
}

registry.registerPath({
  method: "get",
  path: "/auth/passkeys",
  summary: "The caller's registered passkeys",
  description:
    "Per-user and therefore never cacheable by anything shared. This is one of " +
    "the responses that made the API-wide `no-store` default a security boundary " +
    "rather than a performance tweak.",
  tags: authTag,
  responses: { 200: { description: "Passkeys" } },
});

registry.registerPath({
  method: "get",
  path: "/auth/passkeys/availability",
  summary: "Whether passkeys can work on this instance, and why not",
  description:
    "Names the obstacle — no relying-party id configured, a bare IP, or an " +
    "insecure origin — so a client can say what is wrong instead of offering a " +
    "button that always fails.",
  tags: authTag,
  responses: { 200: { description: "Availability" } },
});

registry.registerPath({
  method: "post",
  path: "/auth/passkeys/register/options",
  summary: "Options for registering a passkey",
  tags: authTag,
  responses: { 200: { description: "Options" }, 401: { description: "Not signed in", content: errorContent } },
});

registry.registerPath({
  method: "post",
  path: "/auth/passkeys/register/verify",
  summary: "Finish registering a passkey",
  tags: authTag,
  responses: { 200: { description: "Registered" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/auth/passkeys/login/options",
  summary: "Options for signing in with a passkey",
  description: "No credential list: sign-in is username-less by design.",
  tags: authTag,
  responses: { 200: { description: "Options" } },
});

registry.registerPath({
  method: "post",
  path: "/auth/passkeys/login/verify",
  summary: "Sign in with a passkey",
  description:
    "Issues the session directly and never consults the two-factor setting — the " +
    "assertion already proves possession and a local gesture.",
  tags: authTag,
  responses: { 200: { description: "Signed in" }, 401: { description: "Rejected", content: errorContent } },
});

registry.registerPath({
  method: "patch",
  path: "/auth/passkeys/{id}",
  summary: "Rename a passkey",
  tags: authTag,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "Renamed" }, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/auth/passkeys/{id}",
  summary: "Remove a passkey",
  tags: authTag,
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: deleted, 404: notFound },
});

// ------------------------------------------------------------- pairing

const pairingTag = ["Pairing"];

registry.registerPath({
  method: "post",
  path: "/pairing/start",
  summary: "Begin pairing a phone",
  description:
    "Returns a short-lived code the phone claims. The token the phone ends up " +
    "with is an API token with its own scopes, not a copy of the browser session.",
  tags: pairingTag,
  responses: { 200: { description: "Pairing started" } },
});

registry.registerPath({
  method: "post",
  path: "/pairing/claim",
  summary: "Claim a pairing code from the phone",
  tags: pairingTag,
  responses: { 200: { description: "Paired" }, 400: badInput, 410: { description: "Code expired", content: errorContent } },
});

registry.registerPath({
  method: "post",
  path: "/pairing/status",
  summary: "Whether a pairing has been claimed yet",
  tags: pairingTag,
  responses: { 200: { description: "Status" } },
});

registry.registerPath({
  method: "post",
  path: "/pairing/unpair",
  summary: "Revoke a paired device",
  tags: pairingTag,
  responses: { 200: { description: "Unpaired" }, 404: notFound },
});
