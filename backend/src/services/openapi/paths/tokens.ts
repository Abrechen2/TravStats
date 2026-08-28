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
