import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";

import { errorHandler } from "../errorHandler";
import { uploadEmailFile, getEmailUploadDir } from "../upload";

jest.mock("../../services/loggingConfig", () => ({
  isDebugEnabled: jest.fn(async () => false),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/**
 * A file type this endpoint does not accept is the CLIENT's mistake.
 *
 * Measured 2026-09-20 on 2.7.0-beta.13 (audit SRV-UPLOAD-TYPE-001): .ics,
 * .mbox and .zip sent to `/parse-email-file` under their own correct MIME
 * types answered `500 {"error":"Invalid file type…"}`, because the multer
 * filter rejected with a bare `Error` and the global handler's `|| 500`
 * default took it. The same zip bytes declared as `application/octet-stream`
 * passed the filter and were refused with 400 further inside the route, so the
 * status depended on what the client CLAIMED the file was — and one of the two
 * answers blamed a server that had done nothing wrong.
 */
describe("upload file filter — an unsupported type is a 4xx, not a server fault", () => {
  const BOUNDARY = "----travstats-upload-type-test";

  function multipartBody(filename: string, contentType: string): Buffer {
    return Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="email"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\nPK\u0003\u0004payload\r\n` +
        `--${BOUNDARY}--\r\n`
    );
  }

  // The handler unlinks what multer wrote, exactly as the real route does:
  // a test that leaves uploads behind makes the next run's directory listing
  // a different one.
  function buildApp() {
    const app = express();
    app.post("/parse-email-file", uploadEmailFile.single("email"), (req, res) => {
      if (req.file) {
        const written = path.join(getEmailUploadDir(), path.basename(req.file.filename));
        if (fs.existsSync(written)) fs.unlinkSync(written);
      }
      res.status(200).json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it.each([
    ["calendar.ics", "text/calendar"],
    ["mailbox.mbox", "application/mbox"],
    ["archive.zip", "application/zip"],
  ])("answers 400, not 500, for %s declared as %s", async (filename, contentType) => {
    const res = await request(buildApp())
      .post("/parse-email-file")
      .set("Content-Type", `multipart/form-data; boundary=${BOUNDARY}`)
      .send(multipartBody(filename, contentType));

    expect(res.status).toBe(400);
    // The message named the cause before this fix too — only the status lied.
    expect(res.body.error).toMatch(/Invalid file type/i);
  });

  it("still accepts an .eml", async () => {
    const res = await request(buildApp())
      .post("/parse-email-file")
      .set("Content-Type", `multipart/form-data; boundary=${BOUNDARY}`)
      .send(multipartBody("booking.eml", "message/rfc822"));

    expect(res.status).toBe(200);
  });
});
