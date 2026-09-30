import express from "express";
import request from "supertest";
import { z } from "zod";

import { errorHandler } from "../errorHandler";
import { dayFieldSchema, timeFieldSchema } from "../../shared/time/timeInput";

jest.mock("../../services/loggingConfig", () => ({
  isDebugEnabled: jest.fn(async () => false),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/**
 * ADR 0002 phase 2: a time the server may not interpret is a 422 with a code
 * and the field — not the generic 400 "Validation error". A client (the web
 * form, the Companion) turns `TIME_SHAPE_REQUIRED` into "reload the page" and
 * `ZONE_UNKNOWN` into its own sentence; zod's prose would reach the reader raw.
 */
describe("errorHandler — time-model refusals from a schema", () => {
  const body = z.object({
    stop: z.object({ arrival: timeFieldSchema({ impliedPlace: true }).optional() }),
    day: dayFieldSchema().optional(),
    name: z.string().optional(),
  });
  const app = express();
  app.use(express.json());
  app.post("/x", (req, res, next) => {
    try {
      body.parse(req.body);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.use(errorHandler);

  it("answers an offset-less datetime with 422 TIME_SHAPE_REQUIRED and its path", async () => {
    const res = await request(app)
      .post("/x")
      .send({ stop: { arrival: "2027-06-01T08:00" } });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "stop.arrival" });
  });

  it("answers an unknown zone with 422 ZONE_UNKNOWN", async () => {
    const res = await request(app)
      .post("/x")
      .send({ stop: { arrival: { local: "2027-06-01T08:00", zone: "Mars/Olympus" } } });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "ZONE_UNKNOWN", field: "stop.arrival.zone" });
  });

  it("leaves every other validation failure a 400 VALIDATION_FAILED", async () => {
    const res = await request(app).post("/x").send({ stop: {}, name: 42 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });
});
