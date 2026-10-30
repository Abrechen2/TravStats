/**
 * External services (forgejo#392): the admin façade and the account view.
 * Spec: docs/superpowers/specs/2026-10-30-external-services.md.
 */
import { z } from "zod";

import { registry } from "../registry";
import {
  accountExternalServicesResponseSchema,
  accountServiceUpdateSchema,
  accountServiceViewSchema,
  adminExternalServicesResponseSchema,
  adminServiceUpdateSchema,
  adminServiceViewSchema,
  aiConsentBodySchema,
  aiConsentParamsSchema,
  aiConsentResponseSchema,
  connectionAllowedSchema,
  serviceTestResponseSchema,
} from "../../../schemas/externalServices";
import { errorContent } from "./shared";

const adminTags = ["Administration"];
const accountTags = ["Settings"];
const id = z.object({ id: z.string().describe("Catalogue service id, e.g. `airlabs`") });
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

registry.registerPath({
  method: "get",
  path: "/admin/external-services",
  summary: "Every external service, as the instance sees it",
  description:
    "Catalogue order. Secrets are masked (`•••• last4`). `enabled` and `configured` are " +
    "separate: enabled without a needed credential is 'Schlüssel fehlt'. Nothing calls out.",
  tags: adminTags,
  responses: {
    200: {
      description: "Categories and account connections",
      content: json(adminExternalServicesResponseSchema),
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/admin/external-services/{id}",
  summary: "Change a service",
  description:
    "A façade over the stores the per-service pages write. Secrets: empty string removes, " +
    "the masked echo keeps. Switching on a cloud AI provider needs `confirmDataSharing: true` " +
    "(`CONSENT_REQUIRED`). Admin off blocks the service for every account and the ENV fallback.",
  tags: adminTags,
  request: { params: id, body: { content: json(adminServiceUpdateSchema) } },
  responses: {
    200: { description: "The service as it now reads", content: json(adminServiceViewSchema) },
    400: { description: "VALIDATION_FAILED or CONSENT_REQUIRED", content: errorContent },
    404: { description: "SERVICE_NOT_FOUND", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/admin/external-services/connections/{id}",
  summary: "Allow or forbid accounts to connect a service",
  description: "`id` is dawarich, immich, strava or webdav.",
  tags: adminTags,
  request: { params: id, body: { content: json(connectionAllowedSchema) } },
  responses: {
    200: {
      description: "Saved",
      content: json(z.object({ id: z.string(), allowed: z.boolean() })),
    },
    404: { description: "SERVICE_NOT_FOUND", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/external-services/{id}/test",
  summary: "Test a service's instance credential",
  description:
    "Runs the existing tester and persists `lastTest` (reason is a stable code). A switched-off " +
    "service answers 409 `SERVICE_DISABLED` without calling out. `usedQuota` says whether a metered request was spent.",
  tags: adminTags,
  request: { params: id },
  responses: {
    200: { description: "The verdict", content: json(serviceTestResponseSchema) },
    404: { description: "SERVICE_NOT_FOUND", content: errorContent },
    409: { description: "SERVICE_DISABLED", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/external-services",
  summary: "What this account may connect, bring and consent to",
  description:
    "Connections the admin allows, own-key services, cloud-AI consents for admin-allowed " +
    "providers, and what the instance provides. `effectiveSource` says which credential serves a request.",
  tags: accountTags,
  responses: {
    200: { description: "The account view", content: json(accountExternalServicesResponseSchema) },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/external-services/{id}",
  summary: "Save the account's own key or connection, or switch the service off for it",
  description:
    'Saving fields tests them and persists `lastTest`; `fields.<key> = ""` removes a credential ' +
    "(the instance's applies again). `accountDisabled: true` stops every call for this account.",
  tags: accountTags,
  request: { params: id, body: { content: json(accountServiceUpdateSchema) } },
  responses: {
    200: { description: "The service as it now reads", content: json(accountServiceViewSchema) },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: {
      description: "ACCOUNT_KEYS_NOT_ALLOWED or CONNECTION_NOT_ALLOWED",
      content: errorContent,
    },
    404: { description: "SERVICE_NOT_FOUND", content: errorContent },
    409: { description: "SERVICE_DISABLED", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/external-services/ai-consent/{provider}",
  summary: "Grant or withdraw this account's consent to a cloud AI provider",
  description:
    "Per provider (ollama = remote only, openai, anthropic, google, custom). Documents of this " +
    "account go to a provider only after this consent; the admin must have allowed it first (409 otherwise).",
  tags: accountTags,
  request: { params: aiConsentParamsSchema, body: { content: json(aiConsentBodySchema) } },
  responses: {
    200: { description: "The stored consent", content: json(aiConsentResponseSchema) },
    409: { description: "SERVICE_DISABLED", content: errorContent },
  },
});
