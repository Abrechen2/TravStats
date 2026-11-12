/**
 * The server connection file (Admin → Server-Verbindungen): this server's identity as a ZIP,
 * and the read-only check of another server's file. Admin-only, bare response family; the
 * rest of the admin federation API stays out of the spec with the `admin` mount.
 */

import { z } from "zod";

import {
  connectionFileInspectionSchema,
  peerPinFromFileSchema,
  peerPinFromQrSchema,
  peerPinSchema,
  adminStepUpFieldsSchema,
} from "../../../schemas/federationAdmin";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Admin", "Federation"];

const inspection = registry.register("ConnectionFileInspection", connectionFileInspectionSchema);

registry.registerPath({
  method: "get",
  path: "/admin/federation/connection-file",
  summary: "This server's address, public key and fingerprint as a connection file",
  description:
    "A ZIP holding `travstats-connection.json` (`format: travstats-federation-connection`, " +
    "`version: 1`, `origin`, `publicKey` as SPKI PEM, `fingerprint`, `createdAt`) and a " +
    "`LIESMICH.txt` in German and English. Carries no secret. Served under an env-held " +
    "identity too.",
  tags,
  responses: {
    200: {
      description: "The connection file",
      content: { "application/zip": { schema: z.string().openapi({ format: "binary" }) } },
    },
    409: {
      description: "No key or no public address yet (`COMPARISON_FEDERATION_OFF`)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/federation/connection-file/inspect",
  summary: "Read another server's connection file without pinning it",
  description:
    "Takes the ZIP or its JSON (at most 64 KB, the entry likewise as inflated), checks format, " +
    "address, key and fingerprint exactly as `POST /admin/federation/peers` would, and answers " +
    "the values plus whether that server is already pinned. Pins nothing. Each refusal has " +
    "its own `COMPARISON_CONNECTION_FILE_*` code.",
  tags,
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.string().openapi({ format: "binary" }).describe("The .zip or .json file"),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "What the file says",
      content: { "application/json": { schema: inspection } },
    },
    413: { description: "The file or its entry is too large", content: errorContent },
    422: {
      description:
        "Unreadable, wrong format, bad address or key, fingerprint mismatch, this server",
      content: errorContent,
    },
  },
});

const pinned = z
  .object({
    peer: z
      .object({
        origin: z.string(),
        fingerprint: z.string(),
        enabled: z.boolean(),
        verifiedAt: z.string().nullable().describe("Null until `POST /peers/verify` succeeds"),
      })
      .nullable(),
    computedFingerprint: z
      .string()
      .describe("SHA-256 the server computed from the key; show it beside the QR's `fp`"),
  })
  .passthrough()
  .describe("The federation state plus `peer` and `computedFingerprint`");

registry.registerPath({
  method: "post",
  path: "/admin/federation/peers",
  summary: "Pin another server: explicit values, a scanned QR, or a connection file",
  description:
    "Admin only; a PAT needs scope `admin`, or scope `write` (a paired Companion) plus the admin's " +
    "step-up in the body: any shape below with `password` and, when the account has two-factor, " +
    "`totp` (also accepted on `/peers/verify` and `/peers/suspend`, and on no other admin route). " +
    "A passkey-only admin has no usable password and pins from the web. Three body shapes: `{origin, publicKey, fingerprint, " +
    "enabled}` (the web form), `{qr, enabled?}` (the scanned payload `{v:1,k:'server',u,key,fp}` " +
    "as string or object) or `{connectionFile, enabled?}` (the file, base64). All are validated " +
    "alike; the pin stays unverified until `POST /admin/federation/peers/verify`. " +
    "Refusals: `COMPARISON_PEER_KEY_INVALID` (400), `COMPARISON_CONNECTION_FILE_*` (413/422); " +
    "step-up: `ADMIN_STEP_UP_TOTP_REQUIRED`, `ADMIN_STEP_UP_FAILED` (403), `ADMIN_STEP_UP_LOCKED` (429).",
  tags,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.union([
            peerPinSchema,
            peerPinFromQrSchema,
            peerPinFromFileSchema,
            peerPinSchema.extend(adminStepUpFieldsSchema.shape),
            peerPinFromQrSchema.extend(adminStepUpFieldsSchema.shape),
            peerPinFromFileSchema.extend(adminStepUpFieldsSchema.shape),
          ]),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Pinned (unverified)",
      content: { "application/json": { schema: pinned } },
    },
    400: {
      description: "Invalid key, mismatching fingerprint, or this server",
      content: errorContent,
    },
    403: {
      description:
        "Not an admin, or step-up refused: `ADMIN_STEP_UP_TOTP_REQUIRED`, `ADMIN_STEP_UP_FAILED`",
      content: errorContent,
    },
    413: { description: "Payload too large", content: errorContent },
    422: { description: "Unreadable or malformed QR / file", content: errorContent },
    429: {
      description: "Rate limited, or step-up locked (`ADMIN_STEP_UP_LOCKED`)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/federation/peers",
  summary: "Stop trusting a pinned server",
  description:
    "Admin only. Deletes the pin of the server named by the query `origin`: nothing is accepted " +
    "from it and nothing is sent to it afterwards. The pairings with its people end, shared trips " +
    "stay on this server as local copies, and the queue towards it is dropped. The other server is " +
    "not told. Unlike `POST /admin/federation/peers/suspend` this is not undone by re-enabling: the " +
    "server has to be pinned and verified again. Refusal: `COMPARISON_PEER_UNKNOWN` (404).",
  tags,
  request: { query: z.object({ origin: z.string().describe("The pinned server's https origin") }) },
  responses: {
    200: {
      description: "Removed",
      content: {
        "application/json": {
          schema: z.object({
            removed: z.literal(true),
            pairings: z.number().int().describe("Pairings with people on that server that ended"),
            trips: z
              .number()
              .int()
              .describe(
                "Trips that were shared through that server (they stay here as local copies)"
              ),
          }),
        },
      },
    },
    400: { description: "Not an https origin", content: errorContent },
    403: { description: "Not an admin", content: errorContent },
    404: {
      description: "No such peer is pinned (`COMPARISON_PEER_UNKNOWN`)",
      content: errorContent,
    },
  },
});
