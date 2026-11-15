/**
 * Setup & readiness (spec 2026-11-14 §11): what is missing now, what an update
 * changed. Bare response family. Evaluated from stored state only.
 */
import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  publicUrlCheckResponseSchema,
  readinessIdParamsSchema,
  readinessResponseSchema,
  snoozeBodySchema,
} from "../../../schemas/readiness";

const tags = ["Readiness"];
const demoRefused = { description: "The shared demo account may not write", content: errorContent };

registry.registerPath({
  method: "get",
  path: "/readiness",
  summary: "What is missing for this account, and what the last updates changed",
  description:
    "Every check that applies to the caller, with its status (`ready`, `needsAction`, `unknown`) " +
    "and the evidence time of the stored result it rests on, plus the update notes between the " +
    "account's last acknowledged version and the running one. Admin items reach admins only. " +
    "Nothing is probed per request: a check with no stored result, or one older than its own " +
    "limit, is `unknown`. A user item waiting on an admin item carries `blockedBy` (the id) and no " +
    "`action`. Copy is by key (namespace `readiness`). No secret value is ever included.",
  tags,
  responses: {
    200: {
      description: "The readiness view",
      content: { "application/json": { schema: readinessResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/readiness/items/{id}/snooze",
  summary: "Snooze one item until a later time",
  description:
    "`until` defaults to one day from now and may be at most 30 days away. The snooze belongs to " +
    "this account and the item's current revision; a raised revision ignores it.",
  tags,
  request: {
    params: readinessIdParamsSchema,
    body: { content: { "application/json": { schema: snoozeBodySchema } } },
  },
  responses: {
    204: { description: "Snoozed" },
    400: { description: "`until` is in the past or more than 30 days away", content: errorContent },
    403: demoRefused,
    404: {
      description: "READINESS_ITEM_NOT_FOUND: unknown, or not applicable to this account",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/readiness/items/{id}/opt-out",
  summary: 'Mark an optional item "nutze ich nicht"',
  description: "Refused for every `required` item (`optOutAllowed` is false).",
  tags,
  request: { params: readinessIdParamsSchema },
  responses: {
    204: { description: "Opted out" },
    403: demoRefused,
    404: { description: "READINESS_ITEM_NOT_FOUND", content: errorContent },
    409: { description: "READINESS_OPT_OUT_NOT_ALLOWED", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/readiness/items/{id}/state",
  summary: "Clear a snooze or an opt-out",
  tags,
  request: { params: readinessIdParamsSchema },
  responses: {
    204: { description: "Cleared (also when nothing was set)" },
    403: demoRefused,
    404: { description: "READINESS_ITEM_NOT_FOUND", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/readiness/notes/{id}/ack",
  summary: "Mark one update note as read",
  description:
    "A note backed by a check stays `open` until that check is ready, whatever was acknowledged.",
  tags,
  request: { params: readinessIdParamsSchema },
  responses: {
    204: { description: "Acknowledged" },
    403: demoRefused,
    404: { description: "READINESS_NOTE_NOT_FOUND", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/readiness/invitation/seen",
  summary: "Mark what the invitation card showed as seen",
  description:
    "Stores the current invitation keys (open notes, required items that need action) as seen, " +
    "replacing the earlier set. The page calls it once per open.",
  tags,
  responses: { 204: { description: "Stored" }, 403: demoRefused },
});

registry.registerPath({
  method: "post",
  path: "/readiness/invitation/snooze",
  summary: "Hide the invitation card for one day",
  tags,
  responses: { 204: { description: "Snoozed for one day" }, 403: demoRefused },
});

registry.registerPath({
  method: "post",
  path: "/admin/public-url/check",
  summary: "Probe the instance's own public URL now",
  description:
    "Requests `<publicUrl>/health` with a one-time nonce (10 s timeout, redirects not followed). " +
    "It is ok only for a 2xx answer with `status: ok` that echoes the nonce, so a public name " +
    "pointing at another instance reads `NOT_THIS_INSTANCE`. `NO_PUBLIC_URL` and " +
    "`OUTBOUND_DISABLED` store nothing; every other outcome is stored and feeds the " +
    "`admin.publicUrl` readiness item. Always 200: a probe that could not run says why in `errorCode`.",
  tags: ["Admin"],
  responses: {
    200: {
      description: "The probe's outcome",
      content: { "application/json": { schema: publicUrlCheckResponseSchema } },
    },
    403: { description: "Not an admin", content: errorContent },
  },
});
