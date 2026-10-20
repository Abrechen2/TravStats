import { z } from "zod";
import { registry } from "../registry";
import { errorContent } from "./shared";
import { STAY_PLACE_TYPES } from "../../dawarich/stays/placeType";

/** The place identification of a stay card (forgejo#305). */
const tags = ["Dawarich"];
const failure = {
  description:
    "Not the caller's finding (404), stay suggestions switched off (409 `STAY_SUGGESTIONS_DISABLED`) or too many requests (429)",
  content: errorContent,
};
const response = (schema: z.ZodTypeAny) => ({
  description: "Account-scoped result",
  content: { "application/json": { schema: z.object({ success: z.literal(true), data: schema }) } },
});
const sourceState = z
  .enum(["ok", "empty", "degraded"])
  .describe("`degraded`: the geocoder failed (429, 5xx, timeout) — not the same as `empty`");
const immichKind = z.enum(["unreachable", "auth", "notFound", "protocol", "invalidUrl"]);

const identity = z.object({
  lat: z.number(),
  lon: z.number(),
  probable: z
    .object({
      name: z.string(),
      source: z.enum(["nearbyPlace", "address", "photos"]),
      photoSupported: z.boolean(),
    })
    .nullable(),
  address: z
    .object({
      address: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  geocoder: sourceState,
  candidates: z.array(
    z.object({
      name: z.string(),
      type: z.string().nullable(),
      address: z.string().nullable(),
      city: z.string().nullable(),
      lat: z.number(),
      lon: z.number(),
      distanceM: z.number().int(),
      photoCount: z.number().int().nullable(),
    })
  ),
  candidatesState: sourceState,
  photos: z.object({
    state: z.union([z.enum(["off", "notConfigured", "ok"]), immichKind]),
    count: z.number().int(),
    cities: z.array(z.object({ name: z.string(), count: z.number().int() })),
    truncated: z.boolean(),
  }),
  placeTypeAvailable: z.boolean(),
});

registry.registerPath({
  method: "get",
  path: "/dawarich-stays/{id}/identity",
  tags,
  summary: "Map position, probable name and nearby places of one finding",
  description:
    "Combines the reverse geocoder at the stay point (Nominatim, as `/geo/reverse`), the named places within 250 m (Photon, as `/geo/reverse-places`) and — with an Immich connection and `staySuggestions.immichEvidence` on — the library photos taken during the stay within 300 m. Each source reports its own state, so a failed geocoder or Immich is never an empty success. The probable place is a nearby place the stay's photos were taken at, else the first one within 150 m, else the address, else the photos' city. Asked per finding, cached for 15 minutes when nothing failed.",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: response(identity), 400: failure, 404: failure, 409: failure, 429: failure },
});

registry.registerPath({
  method: "get",
  path: "/dawarich-stays/{id}/place-type",
  tags,
  summary: "Model-classified kind of place of one finding (opt-in)",
  description:
    "Only with `staySuggestions.llmPlaceClassification` on (`off` otherwise). Sends the nearby place NAMES and categories — no coordinates, address or times — through the instance's model chain: a configured Ollama first, a cloud provider only with that provider's own admin consent. `refused` names the gate (admin switch, consent, configuration, shared demo); `failed` names `timeout`, `unavailable` or `unusable` (an answer outside the vocabulary).",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: response(
      z.object({
        state: z.enum(["off", "noCandidates", "refused", "failed", "ok"]),
        type: z.enum(STAY_PLACE_TYPES).optional(),
        refusal: z
          .enum(["disabled_by_admin", "shared_demo", "cloud_not_consented", "provider_incomplete"])
          .optional(),
        failure: z.enum(["timeout", "unavailable", "unusable"]).optional(),
        provider: z
          .object({ kind: z.string(), isCloud: z.boolean(), host: z.string().nullable() })
          .optional(),
      })
    ),
    400: failure,
    404: failure,
    409: failure,
    429: failure,
  },
});
