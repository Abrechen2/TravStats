import express from "express";
import request from "supertest";

import { AppError, errorHandler } from "../errorHandler";

jest.mock("../../services/loggingConfig", () => ({
  isDebugEnabled: jest.fn(async () => false),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/**
 * forgejo#88 finding 3 — a failure carries a cause a client can branch on.
 *
 * `err.message` is English prose written for a log. The login form printed it,
 * so a German page answered a mistyped password with "Invalid credentials".
 * The form now reads `code` and says it in the reader's language; this is the
 * half of that contract the server owes.
 *
 * The code is optional on purpose, and that is worth a test of its own: giving
 * every throw site in the tree a code at once would be a rename of the whole
 * error surface, so a route that has no client needing to tell its failures
 * apart keeps the shape it already had. A body that grew an unexpected `code`
 * key would break the response-shape ratchet's frozen families.
 */
describe("errorHandler — AppError's code reaches the client, and only when set", () => {
  const appThrowing = (err: unknown): express.Express => {
    const app = express();
    app.get("/boom", (_req, _res, next) => next(err));
    app.use(errorHandler);
    return app;
  };

  it("sends the code beside the message when the thrower named one", async () => {
    const res = await request(
      appThrowing(new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS"))
    ).get("/boom");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
    // The prose stays — it is what the log and an API consumer read.
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("omits the key entirely when no code was given", async () => {
    const res = await request(appThrowing(new AppError("Something went wrong", 500))).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Something went wrong");
    expect(Object.prototype.hasOwnProperty.call(res.body, "code")).toBe(false);
  });

  it("omits it for an error that is not an AppError at all", async () => {
    const res = await request(appThrowing(new Error("plain"))).get("/boom");

    expect(Object.prototype.hasOwnProperty.call(res.body, "code")).toBe(false);
  });
});
