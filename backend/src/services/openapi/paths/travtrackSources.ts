import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * OwnTracks and Overland into TravTrack, and the owner's ingest tokens
 * (TravTrack plan E9): `routes/travtrack/{ingestSources,ingestTokens}.ts`.
 * Bare. An ingest token opens the two ingest paths and nothing else; it is not
 * a Personal Access Token.
 */

registry.registerComponent("securitySchemes", "IngestBasic", {
  type: "http",
  scheme: "basic",
  description:
    "OwnTracks: HTTP Basic with an OwnTracks ingest token (`tt_ingest_…`) as the password; " +
    "the username is free.",
});

registry.registerComponent("securitySchemes", "IngestBearer", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "tt_ingest_<hex>",
  description:
    "Overland: `Authorization: Bearer tt_ingest_…` with an Overland ingest token. " +
    "Never in the URL: a token in a query string is refused.",
});

const kind = z.enum(["owntracks", "overland"]);

const token = z.object({
  id: z.string(),
  kind,
  label: z.string().describe("The owner's name for the device"),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable().describe("Last accepted post, to the minute"),
});

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

const invalidToken = {
  description:
    "INGEST_TOKEN_INVALID: no token, an unknown or revoked one, the other app's token or " +
    "scheme, or a token in the URL",
  content: errorContent,
};

const ingestRefusals = {
  401: invalidToken,
  403: {
    description:
      "TRAVTRACK_DISABLED (TravTrack is off) or TRAVTRACK_NOT_ACTIVE (this account's location " +
      "provider is not TravTrack): nothing stored, the app keeps its queue",
    content: errorContent,
  },
  413: { description: "TRACK_BODY_TOO_LARGE: over 2 MB", content: errorContent },
  429: {
    description:
      "RATE_LIMITED: 60 posts a minute per token, 180 per account, or too many failed " +
      "authentications from this address",
    content: errorContent,
  },
};

registry.registerPath({
  method: "post",
  path: "/travtrack/ingest/owntracks",
  summary: "Positions from OwnTracks (HTTP mode)",
  description:
    "One OwnTracks message, an array of them, or an empty body. Each `location` becomes a " +
    "point; every other `_type` is ignored. Points go through the same ingest as the " +
    "Companion's: a fix inside a privacy zone or a deleted span is dropped on the server. " +
    "Once authenticated the answer is always `[]`, also for a malformed message.",
  tags: ["TravTrack"],
  security: [{ IngestBasic: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))])
            .describe("An OwnTracks message or an array of messages"),
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      description: "Accepted; OwnTracks reads the array as friends' positions — none",
      content: { "application/json": { schema: z.array(z.object({})).max(0) } },
    },
    ...ingestRefusals,
  },
});

registry.registerPath({
  method: "post",
  path: "/travtrack/ingest/overland",
  summary: "Positions from Overland",
  description:
    "`{ locations: Feature<Point>[] }` as Overland sends it. `result: ok` is answered only " +
    "after the batch was committed — Overland deletes the batch on that answer. A feature " +
    "that cannot be read is counted and skipped; a body without `locations` is 400.",
  tags: ["TravTrack"],
  security: [{ IngestBearer: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ locations: z.array(z.record(z.string(), z.unknown())).max(5000) })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Committed",
      content: { "application/json": { schema: z.object({ result: z.literal("ok") }) } },
    },
    400: { description: "VALIDATION_FAILED: not an Overland batch", content: errorContent },
    ...ingestRefusals,
  },
});

registry.registerPath({
  method: "post",
  path: "/travtrack/ingest-tokens",
  summary: "Create an ingest token for OwnTracks or Overland",
  description:
    "The token is in this answer and never again; the server keeps only keyed digests of it. " +
    "Needs TravTrack as the account's location provider.",
  tags: ["TravTrack"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ kind, label: z.string().min(1).max(60) }),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: token.extend({
            token: z.string().describe("`tt_ingest_…` — shown once"),
            url: z.string().describe("Where the app posts"),
          }),
        },
      },
    },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: disabled,
    409: {
      description:
        "TRAVTRACK_NOT_ACTIVE (the provider is not TravTrack) or INGEST_TOKEN_LIMIT (10 live " +
        "tokens)",
      content: errorContent,
    },
    429: {
      description: "RATE_LIMITED: 20 creates per account in 15 minutes",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/ingest-tokens",
  summary: "The account's live ingest tokens, without secrets",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "Newest first",
      content: { "application/json": { schema: z.object({ tokens: z.array(token) }) } },
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/ingest-tokens/{id}",
  summary: "Revoke an ingest token",
  description: "The token stops at once; the positions it brought stay.",
  tags: ["TravTrack"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Revoked",
      content: { "application/json": { schema: z.object({ revoked: z.literal(true) }) } },
    },
    403: disabled,
    404: { description: "INGEST_TOKEN_NOT_FOUND", content: errorContent },
  },
});
