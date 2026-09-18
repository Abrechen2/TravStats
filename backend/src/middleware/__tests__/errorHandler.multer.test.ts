import express from "express";
import request from "supertest";
import multer from "multer";

import { errorHandler } from "../errorHandler";

jest.mock("../../services/loggingConfig", () => ({
  isDebugEnabled: jest.fn(async () => false),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/**
 * A multer rejection describes the REQUEST, not this server.
 *
 * Measured 2026-09-18 on the 2.7.0-beta.1 build: `POST /parse-email-file` with
 * the wrong multipart field name answered `500 {"error":"Unexpected file
 * field"}`. multer attaches no `statusCode`, so the handler's `|| 500` default
 * took it. The message was already right; the status said the server had
 * failed, which sends a retrying client into a loop on a request that can
 * never succeed and writes a server fault into the error log that never
 * happened.
 */
describe("errorHandler — a multer rejection is the client's mistake", () => {
  const BOUNDARY = "----travstats-errorhandler-multer-test";

  function bodyWithField(name: string): Buffer {
    return Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="${name}"; filename="x.eml"\r\n` +
        `Content-Type: message/rfc822\r\n\r\nhello\r\n` +
        `--${BOUNDARY}--\r\n`
    );
  }

  function buildApp(limits?: multer.Options["limits"]) {
    const upload = multer({ storage: multer.memoryStorage(), limits });
    const app = express();
    app.post("/upload", upload.single("email"), (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it("answers 400, not 500, when the file arrives under the wrong field name", async () => {
    const res = await request(buildApp())
      .post("/upload")
      .set("Content-Type", `multipart/form-data; boundary=${BOUNDARY}`)
      .send(bodyWithField("file"));

    expect(res.status).toBe(400);
    // The message keeps naming the cause — that half was never the problem.
    expect(res.body.error).toMatch(/Unexpected file field/i);
  });

  it("keeps 413 for a file that is too large — a size limit is its own answer", async () => {
    const res = await request(buildApp({ fileSize: 2 }))
      .post("/upload")
      .set("Content-Type", `multipart/form-data; boundary=${BOUNDARY}`)
      .send(bodyWithField("email"));

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("still lets the request through when the field name is the expected one", async () => {
    const res = await request(buildApp())
      .post("/upload")
      .set("Content-Type", `multipart/form-data; boundary=${BOUNDARY}`)
      .send(bodyWithField("email"));

    expect(res.status).toBe(200);
  });
});
