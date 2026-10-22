/**
 * Per-account WebDAV sync of the account's own data export (forgejo#321) —
 * `routes/settings/webdavSync.ts`.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { webdavSyncUpdateSchema } from "../../../routes/settings/webdavSync";
import { WEBDAV_SYNC_ERROR_CODES } from "../../webdavSync/errors";

const tags = ["Settings"];

const codes = WEBDAV_SYNC_ERROR_CODES.join(", ");

const webdavSyncStatus = registry.register(
  "WebdavSyncStatus",
  z
    .object({
      enabled: z.boolean(),
      url: z.string().nullable(),
      username: z.string().nullable(),
      hasPassword: z.boolean().describe("Whether a password is stored; the password never is"),
      remotePath: z.string(),
      schedule: z.enum(["daily", "weekly"]),
      keepVersions: z.number().int(),
      ranAt: z.string().datetime().nullable().describe("When the last run was attempted"),
      completedAt: z.string().datetime().nullable().describe("When a run last succeeded"),
      lastStatus: z
        .enum(["ok", "partial", "failed"])
        .nullable()
        .describe("`partial`: the export was uploaded, deleting older versions failed"),
      lastErrorCode: z.enum(WEBDAV_SYNC_ERROR_CODES).nullable(),
      lastFileName: z.string().nullable(),
      lastSizeBytes: z.number().int().nullable(),
      running: z.boolean(),
      allowPrivateTargets: z
        .boolean()
        .describe("True for an admin account: a LAN share is allowed. Otherwise public https only"),
    })
    .openapi("WebdavSyncStatus")
);

const statusContent = { "application/json": { schema: webdavSyncStatus } };

registry.registerPath({
  method: "get",
  path: "/settings/webdav-sync",
  summary: "Get the account's WebDAV sync",
  description: "Settings and the last result, with its cause. Never the password.",
  tags,
  responses: { 200: { description: "The sync", content: statusContent } },
});

registry.registerPath({
  method: "put",
  path: "/settings/webdav-sync",
  summary: "Set the account's WebDAV sync",
  description:
    "An omitted field is kept; `password: null` removes the stored one. An ordinary " +
    "account may name a public https share only — a private, loopback or link-local " +
    "address is refused (`blockedTarget`), also when a name resolves to one at run " +
    "time. An admin account may name a LAN share. Refusals carry a code in `error`: " +
    "invalidUrl, httpsRequired, blockedTarget, notConfigured (switched on without URL, " +
    "user and password), invalidInput.",
  tags,
  request: { body: { content: { "application/json": { schema: webdavSyncUpdateSchema } } } },
  responses: {
    200: { description: "Saved", content: statusContent },
    400: { description: "Refused, with a code", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/webdav-sync/run",
  summary: "Sync now",
  description:
    "Builds the account's export, uploads it and prunes older versions, as a background " +
    `job: poll \`/jobs/{id}\`. A failed job's \`error.code\` is one of ${codes}.`,
  tags,
  responses: {
    202: {
      description: "Started",
      content: { "application/json": { schema: z.object({ jobId: z.string().uuid() }) } },
    },
    409: { description: "notConfigured or alreadyRunning", content: errorContent },
  },
});
