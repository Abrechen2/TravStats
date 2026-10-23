/**
 * The server connection file (Admin → Server-Verbindungen): this server's identity as a ZIP,
 * and the read-only check of another server's file. Admin-only, bare response family; the
 * rest of the admin federation API stays out of the spec with the `admin` mount.
 */

import { z } from "zod";

import { connectionFileInspectionSchema } from "../../../schemas/federationAdmin";
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
