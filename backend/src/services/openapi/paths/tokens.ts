/**
 * Personal Access Token management.
 */

import { z } from "zod";

import { registry } from "../registry";
import {
  createApiTokenSchema,
  createdApiTokenSchema,
  sanitizedApiTokenSchema,
} from "../../../schemas/apiToken";

registry.registerPath({
  method: "get",
  path: "/settings/tokens",
  summary: "List your API tokens",
  description: "Cookie-authenticated only. PAT-authenticated requests are rejected with 403.",
  tags: ["API Tokens"],
  responses: {
    200: {
      description: "Tokens",
      content: {
        "application/json": {
          schema: z.object({ tokens: z.array(sanitizedApiTokenSchema) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/tokens",
  summary: "Create a new API token",
  description:
    "The plaintext token is returned exactly once in the `plaintext` field — " +
    "it cannot be retrieved later. Cookie-authenticated only.",
  tags: ["API Tokens"],
  request: {
    body: { content: { "application/json": { schema: createApiTokenSchema } } },
  },
  responses: {
    201: {
      description: "Token created",
      content: { "application/json": { schema: createdApiTokenSchema } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/settings/tokens/{id}",
  summary: "Revoke an API token",
  tags: ["API Tokens"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Revoked",
      content: { "application/json": { schema: sanitizedApiTokenSchema } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/settings/tokens/{id}/purge",
  summary: "Permanently remove a revoked or expired API token",
  description:
    "Also drops the paired-phone entry the token carries. An active token is refused with 409 " +
    "`TOKEN_STILL_ACTIVE` (revoke it first); a foreign id answers 404. A calendar feed the token " +
    "issued goes with it — it was already dead once the token was revoked or expired.",
  tags: ["API Tokens"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Removed",
      content: { "application/json": { schema: z.object({ removed: z.number().int() }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/tokens/purge-old",
  summary: "Remove all revoked and expired API tokens of the caller",
  description: "`?devices=1` limits it to paired phones (tokens with a device id).",
  tags: ["API Tokens"],
  request: { query: z.object({ devices: z.literal("1").optional() }) },
  responses: {
    200: {
      description: "Number of tokens removed",
      content: { "application/json": { schema: z.object({ removed: z.number().int() }) } },
    },
  },
});
