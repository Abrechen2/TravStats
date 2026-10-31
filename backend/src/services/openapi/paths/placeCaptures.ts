/**
 * Unnamed positions from the Companion's "Ort jetzt" (companion#90): captured
 * on the phone, held by the server until the user names or dismisses them.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  captureQuerySchema,
  createCaptureSchema,
  resolveCaptureSchema,
} from "../../../schemas/placeCapture";

const placesTag = ["Places"];
const uuid = z.string().uuid();
const errorResponse = (description: string) => ({ description, content: errorContent });

const capture = registry.register(
  "PlaceCapture",
  z
    .object({
      id: uuid,
      clientId: uuid.describe("Minted on the device; unique per user"),
      lat: z.number(),
      lon: z.number(),
      accuracyM: z.number().nullable(),
      capturedAt: z.string().datetime().describe("ISO instant the phone took the position"),
      note: z.string().nullable(),
      status: z.enum(["open", "resolved", "dismissed"]),
      placeId: uuid.nullable().describe("Set once resolved"),
      visitId: uuid.nullable().describe("Set once resolved"),
      createdAt: z.string().datetime(),
    })
    .openapi("PlaceCapture")
);

const envelope = z.object({ success: z.boolean(), data: capture });
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });

registry.registerPath({
  method: "post",
  path: "/places/captures",
  summary: "Upload a position captured without a name",
  description:
    "Idempotent on `clientId`: a repeat answers the existing capture with 200 instead of 201.",
  tags: placesTag,
  request: { body: { content: json(createCaptureSchema) } },
  responses: {
    200: { description: "Already uploaded", content: json(envelope) },
    201: { description: "Stored", content: json(envelope) },
    400: errorResponse("`VALIDATION_FAILED`"),
  },
});

registry.registerPath({
  method: "get",
  path: "/places/captures",
  summary: "List captures",
  description: "Newest first (`capturedAt` desc, id tie-break), at most 200. Default `open`.",
  tags: placesTag,
  request: { query: captureQuerySchema },
  responses: {
    200: {
      description: "Captures",
      content: json(z.object({ success: z.boolean(), data: z.array(capture) })),
    },
    400: errorResponse("`VALIDATION_FAILED`"),
  },
});

registry.registerPath({
  method: "post",
  path: "/places/captures/{id}/resolve",
  summary: "Name a capture",
  description:
    "`{name, category?}` creates a place at the captured position; `{placeId}` uses one the " +
    "caller owns; either way a visit is written at `capturedAt`, in one transaction. " +
    "`{placeId, visitId}` binds a place and visit the phone already wrote and creates " +
    "nothing (400 `VALIDATION_FAILED` when the visit is not that place's or the caller's). " +
    "404 `CAPTURE_NOT_FOUND`, 409 `CAPTURE_ALREADY_RESOLVED`.",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    body: { content: json(resolveCaptureSchema) },
  },
  responses: {
    200: { description: "Resolved", content: json(envelope) },
    400: errorResponse("`VALIDATION_FAILED`"),
    404: errorResponse("`CAPTURE_NOT_FOUND`, or the place is not the caller's"),
    409: errorResponse("`CAPTURE_ALREADY_RESOLVED`"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/places/captures/{id}",
  summary: "Dismiss a capture",
  description: "Sets `dismissed`; the row is kept.",
  tags: placesTag,
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: { description: "Dismissed", content: json(envelope) },
    404: errorResponse("`CAPTURE_NOT_FOUND`"),
    409: errorResponse("`CAPTURE_ALREADY_RESOLVED`"),
  },
});
